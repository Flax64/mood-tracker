'use strict';

const crypto = require('crypto');

const TRANSPORT_PROTOCOL = 'x25519-aes256ctr-hmac-v1';
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_SESSIONS = 250; // Bounded for t3.micro 128 MB heap
const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000; // ±15 minutes after handshake clock sync
const MAX_SEEN_IVS_PER_SESSION = 512;
const MAX_DECRYPTED_BYTES = 384 * 1024; // 384 KB plaintext guard

function createTransportError(message, status = 400, code = 'TRANSPORT_ERROR') {
    const err = new Error(message);
    err.status = status;
    err.code = code;
    return err;
}

function buildMacInput(protocol, kid, dir, seq, ts, ivB64, ctB64) {
    return `${protocol}|${kid}|${dir}|${seq}|${ts}|${ivB64}|${ctB64}`;
}

function createTransportManager() {
    const sessions = new Map();
    const stats = {
        handshakesCompleted: 0,
        requestsDecrypted: 0,
        responsesEncrypted: 0,
        tamperedRejected: 0,
        replaysRejected: 0
    };

    function purgeExpired(now = Date.now()) {
        for (const [kid, session] of sessions.entries()) {
            if (now - session.lastUsedAt > SESSION_TTL_MS) {
                session.encKey.fill(0);
                session.macKey.fill(0);
                sessions.delete(kid);
            }
        }
        while (sessions.size > MAX_SESSIONS) {
            const oldestKid = sessions.keys().next().value;
            if (!oldestKid) break;
            const oldest = sessions.get(oldestKid);
            if (oldest) {
                oldest.encKey.fill(0);
                oldest.macKey.fill(0);
            }
            sessions.delete(oldestKid);
        }
    }

    function createHandshakeResponse(clientPubB64) {
        if (typeof clientPubB64 !== 'string' || clientPubB64.length < 32 || clientPubB64.length > 96) {
            throw createTransportError('Invalid client X25519 public key payload.', 400, 'TRANSPORT_BAD_PUBKEY');
        }

        const clientPubBuf = Buffer.from(clientPubB64.trim(), 'base64');
        if (clientPubBuf.length !== 32) {
            throw createTransportError('Client X25519 public key must decode to 32 bytes.', 400, 'TRANSPORT_BAD_PUBKEY_LEN');
        }

        const clientPubKey = crypto.createPublicKey({
            key: Buffer.concat([X25519_SPKI_PREFIX, clientPubBuf]),
            format: 'der',
            type: 'spki'
        });

        const { publicKey: serverPubKey, privateKey: serverPrivKey } = crypto.generateKeyPairSync('x25519');
        const sharedSecret = crypto.diffieHellman({
            privateKey: serverPrivKey,
            publicKey: clientPubKey
        });

        // RFC 7748 low-order / all-zero shared secret rejection
        let nonZero = 0;
        for (let i = 0; i < sharedSecret.length; i += 1) {
            nonZero |= sharedSecret[i];
        }
        if (nonZero === 0) {
            sharedSecret.fill(0);
            throw createTransportError('Weak or contributory X25519 public key rejected.', 400, 'TRANSPORT_WEAK_PUBKEY');
        }

        const kid = crypto.randomBytes(12).toString('hex');
        const salt = crypto.randomBytes(16);
        const info = Buffer.from(`${TRANSPORT_PROTOCOL}:${kid}`, 'utf8');
        const okm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, salt, info, 64));
        sharedSecret.fill(0);

        const encKey = Buffer.from(okm.subarray(0, 32));
        const macKey = Buffer.from(okm.subarray(32, 64));
        okm.fill(0);

        const now = Date.now();
        purgeExpired(now);
        sessions.set(kid, {
            kid,
            encKey,
            macKey,
            createdAt: now,
            lastUsedAt: now,
            seenIvs: new Set(),
            reqCount: 0,
            resCount: 0,
            bytesIn: 0,
            bytesOut: 0
        });
        stats.handshakesCompleted += 1;

        const serverPubRaw = serverPubKey.export({ format: 'der', type: 'spki' }).subarray(-32);
        return {
            protocol: TRANSPORT_PROTOCOL,
            kid,
            serverPub: serverPubRaw.toString('base64'),
            salt: salt.toString('base64'),
            expiresInSec: Math.floor(SESSION_TTL_MS / 1000),
            serverTs: now,
            cipher: 'AES-256-CTR + HMAC-SHA256',
            kex: 'X25519 (Curve25519 ECDH) + HKDF-SHA256'
        };
    }

    function getActiveSession(kid, { touch = true } = {}) {
        if (typeof kid !== 'string' || !/^[a-f0-9]{24}$/.test(kid)) {
            throw createTransportError('Transport session ID is missing or invalid.', 428, 'TRANSPORT_SESSION_EXPIRED');
        }
        const session = sessions.get(kid);
        const now = Date.now();
        if (!session || now - session.lastUsedAt > SESSION_TTL_MS) {
            if (session) {
                session.encKey.fill(0);
                session.macKey.fill(0);
                sessions.delete(kid);
            }
            throw createTransportError('Transport session expired. Re-handshake required.', 428, 'TRANSPORT_SESSION_EXPIRED');
        }
        if (touch) {
            session.lastUsedAt = now;
        }
        return session;
    }

    function decryptEnvelope(envelope, expectedDir = 'c2s') {
        if (!envelope || typeof envelope !== 'object' || envelope.__enc !== TRANSPORT_PROTOCOL) {
            throw createTransportError('Unsupported encrypted transport envelope.', 400, 'TRANSPORT_BAD_ENVELOPE');
        }
        const { kid, dir, seq, ts, iv, ct, mac } = envelope;
        if (dir !== expectedDir) {
            throw createTransportError('Transport direction mismatch.', 400, 'TRANSPORT_BAD_DIR');
        }
        if (!Number.isSafeInteger(seq) || seq < 0) {
            throw createTransportError('Invalid transport sequence number.', 400, 'TRANSPORT_BAD_SEQ');
        }
        if (typeof ts !== 'number' || !Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
            throw createTransportError('Encrypted transport packet timestamp is stale.', 428, 'TRANSPORT_SESSION_EXPIRED');
        }
        if (typeof iv !== 'string' || typeof ct !== 'string' || typeof mac !== 'string') {
            throw createTransportError('Malformed encrypted transport fields.', 400, 'TRANSPORT_BAD_FIELDS');
        }

        const session = getActiveSession(kid, { touch: false });

        const ivBuf = Buffer.from(iv, 'base64');
        const ctBuf = Buffer.from(ct, 'base64');
        const macBuf = Buffer.from(mac, 'base64');
        if (ivBuf.length !== 16 || macBuf.length !== 32) {
            throw createTransportError('Invalid transport IV or MAC length.', 400, 'TRANSPORT_BAD_CRYPTO_PARAMS');
        }
        if (ctBuf.length > MAX_DECRYPTED_BYTES) {
            throw createTransportError('Encrypted transport payload exceeds maximum limit.', 413, 'TRANSPORT_PAYLOAD_TOO_LARGE');
        }

        // Encrypt-then-MAC verification in constant time BEFORE decrypting ciphertext
        const macInput = buildMacInput(TRANSPORT_PROTOCOL, kid, dir, seq, ts, iv, ct);
        const expectedMac = crypto.createHmac('sha256', session.macKey).update(macInput, 'utf8').digest();
        if (!crypto.timingSafeEqual(macBuf, expectedMac)) {
            stats.tamperedRejected += 1;
            throw createTransportError('Transport HMAC verification failed (packet altered or corrupted).', 400, 'TRANSPORT_MAC_INVALID');
        }

        if (session.seenIvs.has(iv)) {
            stats.replaysRejected += 1;
            throw createTransportError('Replay attack blocked: duplicate transport IV.', 409, 'TRANSPORT_REPLAY');
        }
        session.seenIvs.add(iv);
        if (session.seenIvs.size > MAX_SEEN_IVS_PER_SESSION) {
            const oldestIv = session.seenIvs.values().next().value;
            session.seenIvs.delete(oldestIv);
        }

        const decipher = crypto.createDecipheriv('aes-256-ctr', session.encKey, ivBuf);
        const plainBuf = Buffer.concat([decipher.update(ctBuf), decipher.final()]);
        const plaintext = plainBuf.toString('utf8');

        session.lastUsedAt = Date.now();
        session.reqCount += 1;
        session.bytesIn += ctBuf.length;
        stats.requestsDecrypted += 1;

        return {
            session,
            seq,
            plaintext,
            ciphertextBytes: ctBuf.length,
            plaintextBytes: plainBuf.length
        };
    }

    function encryptPayload(kid, plaintextStr, dir = 's2c', seq = 0) {
        const session = getActiveSession(kid, { touch: true });
        const iv = crypto.randomBytes(16);
        const plainBuf = Buffer.isBuffer(plaintextStr)
            ? plaintextStr
            : Buffer.from(String(plaintextStr ?? ''), 'utf8');

        const cipher = crypto.createCipheriv('aes-256-ctr', session.encKey, iv);
        const ctBuf = Buffer.concat([cipher.update(plainBuf), cipher.final()]);

        const ivB64 = iv.toString('base64');
        const ctB64 = ctBuf.toString('base64');
        const ts = Date.now();
        const macInput = buildMacInput(TRANSPORT_PROTOCOL, kid, dir, seq, ts, ivB64, ctB64);
        const macB64 = crypto.createHmac('sha256', session.macKey).update(macInput, 'utf8').digest('base64');

        session.resCount += 1;
        session.bytesOut += ctBuf.length;
        stats.responsesEncrypted += 1;

        return {
            __enc: TRANSPORT_PROTOCOL,
            kid,
            dir,
            seq,
            ts,
            iv: ivB64,
            ct: ctB64,
            mac: macB64
        };
    }

    function getStatusSnapshot(kid = null) {
        purgeExpired();
        const active = kid && sessions.has(kid) ? sessions.get(kid) : null;
        return {
            protocol: TRANSPORT_PROTOCOL,
            kex: 'X25519 (Curve25519 ECDH) + HKDF-SHA256',
            cipher: 'AES-256-CTR + HMAC-SHA256 (Encrypt-then-MAC)',
            activeSessions: sessions.size,
            maxSessions: MAX_SESSIONS,
            sessionTtlHours: SESSION_TTL_MS / (60 * 60 * 1000),
            stats: { ...stats },
            currentSession: active ? {
                kid: active.kid,
                createdAt: active.createdAt,
                lastUsedAt: active.lastUsedAt,
                reqCount: active.reqCount,
                resCount: active.resCount,
                bytesIn: active.bytesIn,
                bytesOut: active.bytesOut
            } : null
        };
    }

    return {
        TRANSPORT_PROTOCOL,
        createHandshakeResponse,
        getActiveSession,
        decryptEnvelope,
        encryptPayload,
        getStatusSnapshot
    };
}

module.exports = {
    TRANSPORT_PROTOCOL,
    createTransportError,
    createTransportManager
};
