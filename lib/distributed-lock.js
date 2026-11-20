'use strict';

const DEFAULT_LOCK_TIMEOUT_SEC = 25;

function getConnectionAsync(pool) {
    return new Promise((resolve, reject) => {
        try {
            pool.getConnection((err, conn) => {
                if (err) return reject(err);
                return resolve(conn);
            });
        } catch (err) {
            reject(err);
        }
    });
}

function queryConnectionAsync(conn, sql, params = []) {
    return new Promise((resolve, reject) => {
        try {
            conn.query(sql, params, (err, rows) => {
                if (err) return reject(err);
                return resolve(rows);
            });
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Coordinates critical shared-disk operations (such as .docx OOXML writes)
 * across multiple Node.js replicas using a connection-scoped MySQL GET_LOCK.
 */
async function withMySqlAdvisoryLock({
    pool,
    lockName,
    timeoutSec = DEFAULT_LOCK_TIMEOUT_SEC,
    taskFn,
    onWarn = null
} = {}) {
    if (typeof taskFn !== 'function') {
        throw new TypeError('taskFn must be a function.');
    }

    const safeLockName = typeof lockName === 'string' ? lockName.trim() : '';
    if (!safeLockName || safeLockName.length > 64) {
        throw new Error('lockName must be a non-empty string of at most 64 characters.');
    }

    const parsedTimeout = Number(timeoutSec);
    const safeTimeoutSec = Number.isFinite(parsedTimeout) && parsedTimeout >= 0
        ? Math.floor(parsedTimeout)
        : DEFAULT_LOCK_TIMEOUT_SEC;

    if (!pool || typeof pool.getConnection !== 'function') {
        return await taskFn();
    }

    let conn;
    try {
        conn = await getConnectionAsync(pool);
    } catch (err) {
        if (typeof onWarn === 'function') {
            try {
                onWarn(`Could not obtain MySQL connection for advisory lock (${safeLockName}): ${err.message}`);
            } catch (_) {}
        }
        throw err;
    }

    if (!conn || typeof conn.query !== 'function') {
        try {
            if (conn && typeof conn.release === 'function') {
                conn.release();
            }
        } catch (_) {}
        return await taskFn();
    }

    let acquired = false;
    try {
        const rows = await queryConnectionAsync(conn, 'SELECT GET_LOCK(?, ?) AS acquired', [
            safeLockName,
            safeTimeoutSec
        ]);

        if (Array.isArray(rows) && rows.length > 0 && rows[0] && typeof rows[0] === 'object') {
            const firstRow = rows[0];
            const val = Object.prototype.hasOwnProperty.call(firstRow, 'acquired')
                ? firstRow.acquired
                : Object.values(firstRow)[0];

            if (val === null) {
                const lockErr = new Error(`Failed to acquire MySQL advisory lock (${safeLockName}).`);
                lockErr.code = 'LOCK_ERROR';
                throw lockErr;
            }
            if (val !== undefined) {
                const numericVal = Number(val);
                if (numericVal === 0) {
                    const timeoutErr = new Error(`Concurrent file write busy (${safeLockName}); please retry shortly.`);
                    timeoutErr.code = 'LOCK_TIMEOUT';
                    timeoutErr.status = 503;
                    throw timeoutErr;
                }
                if (numericVal === 1) {
                    acquired = true;
                }
            }
        }

        return await taskFn();
    } finally {
        try {
            if (acquired) {
                await queryConnectionAsync(conn, 'SELECT RELEASE_LOCK(?) AS released', [safeLockName]);
            }
        } catch (relErr) {
            if (typeof onWarn === 'function') {
                try {
                    onWarn(`Failed to release MySQL advisory lock (${safeLockName}): ${relErr.message}`);
                } catch (_) {}
            }
        } finally {
            try {
                if (typeof conn.release === 'function') {
                    conn.release();
                }
            } catch (_) {}
        }
    }
}

module.exports = {
    DEFAULT_LOCK_TIMEOUT_SEC,
    withMySqlAdvisoryLock
};
