'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_LOCK_TIMEOUT_SEC,
    withMySqlAdvisoryLock
} = require('../lib/distributed-lock');

describe('lib/distributed-lock (MySQL GET_LOCK advisory lock)', () => {
    it('adquiere GET_LOCK y libera RELEASE_LOCK en la misma conexión y siempre llama release()', async () => {
        const events = [];
        const conn = {
            id: 'conn-1',
            query(sql, params, cb) {
                events.push({ connId: this.id, sql, params });
                if (sql.includes('GET_LOCK')) {
                    return process.nextTick(() => cb(null, [{ acquired: 1 }]));
                }
                if (sql.includes('RELEASE_LOCK')) {
                    return process.nextTick(() => cb(null, [{ released: 1 }]));
                }
                return process.nextTick(() => cb(null, []));
            },
            release() {
                events.push({ connId: this.id, releasedPoolConn: true });
            }
        };
        const pool = {
            getConnection(cb) {
                process.nextTick(() => cb(null, conn));
            }
        };

        const out = await withMySqlAdvisoryLock({
            pool,
            lockName: 'pdh_docx_english',
            timeoutSec: 15,
            taskFn: async () => {
                events.push({ insideTask: true });
                return 'done-ok';
            }
        });

        assert.equal(out, 'done-ok');
        assert.deepEqual(events, [
            { connId: 'conn-1', sql: 'SELECT GET_LOCK(?, ?) AS acquired', params: ['pdh_docx_english', 15] },
            { insideTask: true },
            { connId: 'conn-1', sql: 'SELECT RELEASE_LOCK(?) AS released', params: ['pdh_docx_english'] },
            { connId: 'conn-1', releasedPoolConn: true }
        ]);
    });

    it('rechaza con LOCK_TIMEOUT (HTTP 503) sin ejecutar taskFn si GET_LOCK devuelve 0 y libera conexión', async () => {
        const events = [];
        let taskExecuted = false;
        const conn = {
            query(sql, params, cb) {
                events.push(sql);
                return process.nextTick(() => cb(null, [{ acquired: 0 }]));
            },
            release() {
                events.push('conn.release');
            }
        };
        const pool = {
            getConnection(cb) {
                process.nextTick(() => cb(null, conn));
            }
        };

        await assert.rejects(
            () => withMySqlAdvisoryLock({
                pool,
                lockName: 'pdh_docx_journal',
                taskFn: async () => {
                    taskExecuted = true;
                    return 'should-not-run';
                }
            }),
            (err) => err && err.code === 'LOCK_TIMEOUT' && err.status === 503
        );

        assert.equal(taskExecuted, false);
        assert.deepEqual(events, ['SELECT GET_LOCK(?, ?) AS acquired', 'conn.release']);
    });

    it('libera RELEASE_LOCK y conn.release() incluso cuando taskFn lanza una excepción', async () => {
        const events = [];
        const conn = {
            query(sql, params, cb) {
                events.push(sql);
                if (sql.includes('GET_LOCK')) return process.nextTick(() => cb(null, [{ acquired: 1 }]));
                if (sql.includes('RELEASE_LOCK')) return process.nextTick(() => cb(null, [{ released: 1 }]));
                return process.nextTick(() => cb(null, []));
            },
            release() {
                events.push('conn.release');
            }
        };
        const pool = {
            getConnection(cb) {
                process.nextTick(() => cb(null, conn));
            }
        };

        await assert.rejects(
            () => withMySqlAdvisoryLock({
                pool,
                lockName: 'pdh_docx_english',
                taskFn: async () => {
                    throw new Error('python docx failure');
                }
            }),
            /python docx failure/
        );

        assert.deepEqual(events, [
            'SELECT GET_LOCK(?, ?) AS acquired',
            'SELECT RELEASE_LOCK(?) AS released',
            'conn.release'
        ]);
    });

    it('soporta pool ausente o conexión mínima en mocks y valida lockName', async () => {
        assert.equal(DEFAULT_LOCK_TIMEOUT_SEC, 25);

        const direct = await withMySqlAdvisoryLock({
            pool: null,
            lockName: 'pdh_test',
            taskFn: async () => 42
        });
        assert.equal(direct, 42);

        let releasedMinimal = false;
        const minimal = await withMySqlAdvisoryLock({
            pool: {
                getConnection(cb) {
                    cb(null, { release() { releasedMinimal = true; } });
                }
            },
            lockName: 'pdh_test',
            taskFn: async () => 'minimal-ok'
        });
        assert.equal(minimal, 'minimal-ok');
        assert.equal(releasedMinimal, true);

        await assert.rejects(
            () => withMySqlAdvisoryLock({ pool: null, lockName: '   ', taskFn: async () => 1 }),
            /lockName/
        );
        await assert.rejects(
            () => withMySqlAdvisoryLock({ pool: null, lockName: 'a'.repeat(65), taskFn: async () => 1 }),
            /lockName/
        );

        const warns = [];
        await assert.rejects(
            () => withMySqlAdvisoryLock({
                pool: {
                    getConnection(cb) {
                        cb(new Error('pool exhausted'));
                    }
                },
                lockName: 'pdh_test',
                taskFn: async () => 1,
                onWarn: (m) => warns.push(m)
            }),
            /pool exhausted/
        );
        assert.equal(warns.length, 1);
    });
});
