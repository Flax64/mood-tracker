/* ============================================================================
   Simulated HTTPS Hybrid Transport Layer (Client Engine)
   - Key Exchange: Ephemeral X25519 (Curve25519 ECDH) + HKDF-SHA256
   - Bulk Cipher: AES-256-CTR + HMAC-SHA256 (Encrypt-then-MAC, OpenSSL compatible)
   - Works over plain HTTP without window.crypto.subtle (uses CSPRNG getRandomValues)
   ============================================================================ */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(root);
    } else {
        root.TransportCrypto = factory(root);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    const TRANSPORT_PROTOCOL = 'x25519-aes256ctr-hmac-v1';
    const P = (1n << 255n) - 19n;
    const A24 = 121665n;

    function getRandomBytes(length) {
        const out = new Uint8Array(length);
        if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
            root.crypto.getRandomValues(out);
            return out;
        }
        if (typeof require === 'function') {
            return new Uint8Array(require('crypto').randomBytes(length));
        }
        throw new Error('Secure random generator unavailable.');
    }

    function bytesToBase64(bytes) {
        if (typeof Buffer !== 'undefined' && typeof btoa !== 'function') {
            return Buffer.from(bytes).toString('base64');
        }
        let binary = '';
        const chunkSize = 0x4000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    }

    function base64ToBytes(b64) {
        if (typeof Buffer !== 'undefined' && typeof atob !== 'function') {
            return new Uint8Array(Buffer.from(b64, 'base64'));
        }
        const binary = atob(b64);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            out[i] = binary.charCodeAt(i);
        }
        return out;
    }

    function utf8Encode(str) {
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(str);
        }
        return new Uint8Array(Buffer.from(String(str), 'utf8'));
    }

    function utf8Decode(bytes) {
        if (typeof TextDecoder !== 'undefined') {
            return new TextDecoder('utf-8').decode(bytes);
        }
        return Buffer.from(bytes).toString('utf8');
    }

    function bytesToWordArray(bytes, CryptoJSRef) {
        const words = [];
        for (let i = 0; i < bytes.length; i += 1) {
            words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
        }
        return CryptoJSRef.lib.WordArray.create(words, bytes.length);
    }

    function wordArrayToBytes(wordArray) {
        const words = wordArray.words;
        const sigBytes = wordArray.sigBytes;
        const out = new Uint8Array(sigBytes);
        for (let i = 0; i < sigBytes; i += 1) {
            out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
        }
        return out;
    }

    // ---- RFC 7748 Curve25519 (X25519) Pure BigInt Implementation ----
    function mod(n) {
        const r = n % P;
        return r >= 0n ? r : r + P;
    }

    function modPow(base, exp) {
        let result = 1n;
        let b = mod(base);
        let e = exp;
        while (e > 0n) {
            if (e & 1n) result = (result * b) % P;
            b = (b * b) % P;
            e >>= 1n;
        }
        return result;
    }

    function decodeLittleEndian(bytes) {
        let n = 0n;
        for (let i = 0; i < bytes.length; i += 1) {
            n += BigInt(bytes[i]) << BigInt(8 * i);
        }
        return n;
    }

    function encodeUCoordinate(u) {
        const v = mod(u);
        const out = new Uint8Array(32);
        for (let i = 0; i < 32; i += 1) {
            out[i] = Number((v >> BigInt(8 * i)) & 0xffn);
        }
        return out;
    }

    function clampScalar(raw32) {
        const k = new Uint8Array(raw32);
        k[0] &= 248;
        k[31] &= 127;
        k[31] |= 64;
        return decodeLittleEndian(k);
    }

    function decodeUCoordinate(raw32) {
        const u = new Uint8Array(raw32);
        u[31] &= 127;
        return decodeLittleEndian(u);
    }

    function x25519(scalarBytes, uBytes) {
        const k = clampScalar(scalarBytes);
        const x1 = decodeUCoordinate(uBytes);
        let x2 = 1n;
        let z2 = 0n;
        let x3 = x1;
        let z3 = 1n;
        let swap = 0n;

        for (let t = 254n; t >= 0n; t -= 1n) {
            const kt = (k >> t) & 1n;
            swap ^= kt;
            if (swap) {
                let tmp = x2; x2 = x3; x3 = tmp;
                tmp = z2; z2 = z3; z3 = tmp;
            }
            swap = kt;

            const A = (x2 + z2) % P;
            const AA = (A * A) % P;
            const B = mod(x2 - z2);
            const BB = (B * B) % P;
            const E = mod(AA - BB);
            const C = (x3 + z3) % P;
            const D = mod(x3 - z3);
            const DA = (D * A) % P;
            const CB = (C * B) % P;

            const sum = (DA + CB) % P;
            x3 = (sum * sum) % P;
            const diff = mod(DA - CB);
            z3 = (x1 * ((diff * diff) % P)) % P;
            x2 = (AA * BB) % P;
            z2 = (E * ((AA + ((A24 * E) % P)) % P)) % P;
        }

        if (swap) {
            let tmp = x2; x2 = x3; x3 = tmp;
            tmp = z2; z2 = z3; z3 = tmp;
        }

        const shared = (x2 * modPow(z2, P - 2n)) % P;
        return encodeUCoordinate(shared);
    }

    function generateX25519KeyPair() {
        const priv = getRandomBytes(32);
        const basepoint = new Uint8Array(32);
        basepoint[0] = 9;
        const pub = x25519(priv, basepoint);
        return { privateKey: priv, publicKey: pub };
    }

    // ---- RFC 5869 HKDF-SHA256 & OpenSSL-Matched AES-256-CTR + HMAC-SHA256 ----
    function hmacSha256Bytes(keyBytes, dataBytes, CryptoJSRef) {
        if (CryptoJSRef) {
            const macWa = CryptoJSRef.HmacSHA256(
                bytesToWordArray(dataBytes, CryptoJSRef),
                bytesToWordArray(keyBytes, CryptoJSRef)
            );
            return wordArrayToBytes(macWa);
        }
        if (typeof require === 'function') {
            return new Uint8Array(
                require('crypto').createHmac('sha256', Buffer.from(keyBytes)).update(Buffer.from(dataBytes)).digest()
            );
        }
        throw new Error('CryptoJS library is required for browser transport HMAC.');
    }

    function hkdfSha256(ikmBytes, saltBytes, infoBytes, outLen, CryptoJSRef) {
        const prk = hmacSha256Bytes(saltBytes, ikmBytes, CryptoJSRef);
        const okm = new Uint8Array(outLen);
        let prev = new Uint8Array(0);
        let offset = 0;
        let counter = 1;
        while (offset < outLen) {
            const input = new Uint8Array(prev.length + infoBytes.length + 1);
            input.set(prev, 0);
            input.set(infoBytes, prev.length);
            input[input.length - 1] = counter;
            prev = hmacSha256Bytes(prk, input, CryptoJSRef);
            const take = Math.min(prev.length, outLen - offset);
            okm.set(prev.subarray(0, take), offset);
            offset += take;
            counter += 1;
        }
        return okm;
    }

    function aes256CtrTransform(keyBytes, ivBytes, inputBytes, CryptoJSRef) {
        if (CryptoJSRef && CryptoJSRef.algo && CryptoJSRef.algo.AES) {
            const keyWa = bytesToWordArray(keyBytes, CryptoJSRef);
            const encryptor = CryptoJSRef.algo.AES.createEncryptor(keyWa);
            const out = new Uint8Array(inputBytes.length);
            const counter = new Uint8Array(ivBytes);
            const blockWords = [0, 0, 0, 0];

            for (let offset = 0; offset < inputBytes.length; offset += 16) {
                blockWords[0] = (counter[0] << 24) | (counter[1] << 16) | (counter[2] << 8) | counter[3];
                blockWords[1] = (counter[4] << 24) | (counter[5] << 16) | (counter[6] << 8) | counter[7];
                blockWords[2] = (counter[8] << 24) | (counter[9] << 16) | (counter[10] << 8) | counter[11];
                blockWords[3] = (counter[12] << 24) | (counter[13] << 16) | (counter[14] << 8) | counter[15];

                encryptor.encryptBlock(blockWords, 0);

                const remaining = Math.min(16, inputBytes.length - offset);
                for (let j = 0; j < remaining; j += 1) {
                    const ksByte = (blockWords[j >>> 2] >>> (24 - (j % 4) * 8)) & 0xff;
                    out[offset + j] = inputBytes[offset + j] ^ ksByte;
                }

                // 128-bit big-endian counter increment matching OpenSSL aes-256-ctr
                for (let b = 15; b >= 0; b -= 1) {
                    counter[b] = (counter[b] + 1) & 0xff;
                    if (counter[b] !== 0) break;
                }
            }
            return out;
        }
        if (typeof require === 'function') {
            const crypto = require('crypto');
            const cipher = crypto.createCipheriv('aes-256-ctr', Buffer.from(keyBytes), Buffer.from(ivBytes));
            return new Uint8Array(Buffer.concat([cipher.update(Buffer.from(inputBytes)), cipher.final()]));
        }
        throw new Error('CryptoJS AES engine unavailable.');
    }

    function constantTimeEqual(a, b) {
        if (a.length !== b.length) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i += 1) {
            diff |= a[i] ^ b[i];
        }
        return diff === 0;
    }

    function buildMacInput(protocol, kid, dir, seq, ts, ivB64, ctB64) {
        return `${protocol}|${kid}|${dir}|${seq}|${ts}|${ivB64}|${ctB64}`;
    }

    function createClientTunnel(options) {
        const opts = options || {};
        const CryptoJSRef = opts.CryptoJS || root.CryptoJS || null;
        let session = null;
        let seqCounter = 0;
        let clockOffsetMs = 0;
        let handshakePromise = null;
        const metrics = {
            handshakes: 0,
            lastHandshakeMs: 0,
            lastEncryptMs: 0,
            lastDecryptMs: 0,
            encryptedRequests: 0,
            decryptedResponses: 0,
            totalBytesEncrypted: 0,
            totalBytesDecrypted: 0
        };

        function deriveSessionFromHandshake(clientPrivKey, handshakeJson) {
            if (!handshakeJson || handshakeJson.protocol !== TRANSPORT_PROTOCOL) {
                throw new Error('Unsupported transport protocol returned by server.');
            }
            const serverPubBytes = base64ToBytes(handshakeJson.serverPub);
            const saltBytes = base64ToBytes(handshakeJson.salt);
            if (serverPubBytes.length !== 32 || saltBytes.length !== 16) {
                throw new Error('Invalid server handshake cryptographic parameters.');
            }
            const shared = x25519(clientPrivKey, serverPubBytes);
            let nonZero = 0;
            for (let i = 0; i < shared.length; i += 1) nonZero |= shared[i];
            if (nonZero === 0) {
                throw new Error('Server X25519 public key produced invalid shared secret.');
            }

            const infoBytes = utf8Encode(`${TRANSPORT_PROTOCOL}:${handshakeJson.kid}`);
            const okm = hkdfSha256(shared, saltBytes, infoBytes, 64, CryptoJSRef);
            shared.fill(0);
            clientPrivKey.fill(0);

            const encKey = okm.slice(0, 32);
            const macKey = okm.slice(32, 64);
            okm.fill(0);

            if (typeof handshakeJson.serverTs === 'number') {
                clockOffsetMs = handshakeJson.serverTs - Date.now();
            }
            seqCounter = 0;
            session = {
                kid: handshakeJson.kid,
                encKey,
                macKey,
                kex: handshakeJson.kex,
                cipher: handshakeJson.cipher,
                createdAt: Date.now(),
                expiresAt: Date.now() + ((handshakeJson.expiresInSec || 43200) * 1000)
            };
            return session;
        }

        function isReady() {
            return Boolean(session && Date.now() < session.expiresAt - 60000);
        }

        async function establishSession(rawFetchFn, force = false) {
            if (!force && isReady()) return session;
            if (!force && handshakePromise) return handshakePromise;

            handshakePromise = (async () => {
                const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
                const kp = generateX25519KeyPair();
                const res = await rawFetchFn('/api/transport/handshake', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientPub: bytesToBase64(kp.publicKey) })
                });
                if (!res.ok) {
                    kp.privateKey.fill(0);
                    throw new Error(`Transport handshake failed (HTTP ${res.status})`);
                }
                const json = await res.json();
                deriveSessionFromHandshake(kp.privateKey, json);
                const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
                metrics.handshakes += 1;
                metrics.lastHandshakeMs = Number((t1 - t0).toFixed(2));
                return session;
            })();

            try {
                return await handshakePromise;
            } finally {
                handshakePromise = null;
            }
        }

        function encryptText(plaintextStr) {
            if (!session) throw new Error('Transport session not initialized.');
            const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const iv = getRandomBytes(16);
            const plainBytes = utf8Encode(String(plaintextStr ?? ''));
            const ctBytes = aes256CtrTransform(session.encKey, iv, plainBytes, CryptoJSRef);
            const ivB64 = bytesToBase64(iv);
            const ctB64 = bytesToBase64(ctBytes);
            seqCounter += 1;
            const seq = seqCounter;
            const ts = Date.now() + clockOffsetMs;
            const macInput = utf8Encode(buildMacInput(TRANSPORT_PROTOCOL, session.kid, 'c2s', seq, ts, ivB64, ctB64));
            const macBytes = hmacSha256Bytes(session.macKey, macInput, CryptoJSRef);
            const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

            metrics.lastEncryptMs = Number((t1 - t0).toFixed(2));
            metrics.encryptedRequests += 1;
            metrics.totalBytesEncrypted += plainBytes.length;

            return {
                __enc: TRANSPORT_PROTOCOL,
                kid: session.kid,
                dir: 'c2s',
                seq,
                ts,
                iv: ivB64,
                ct: ctB64,
                mac: bytesToBase64(macBytes)
            };
        }

        function decryptEnvelope(envelope, expectedDir = 's2c') {
            if (!session) throw new Error('Transport session not initialized.');
            if (!envelope || envelope.__enc !== TRANSPORT_PROTOCOL || envelope.kid !== session.kid) {
                throw new Error('Unexpected encrypted transport envelope.');
            }
            if (envelope.dir !== expectedDir) {
                throw new Error('Encrypted transport direction mismatch.');
            }
            const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const macInput = utf8Encode(
                buildMacInput(TRANSPORT_PROTOCOL, envelope.kid, envelope.dir, envelope.seq, envelope.ts, envelope.iv, envelope.ct)
            );
            const expectedMac = hmacSha256Bytes(session.macKey, macInput, CryptoJSRef);
            const providedMac = base64ToBytes(envelope.mac);
            if (!constantTimeEqual(expectedMac, providedMac)) {
                throw new Error('Server response HMAC verification failed.');
            }
            const ivBytes = base64ToBytes(envelope.iv);
            const ctBytes = base64ToBytes(envelope.ct);
            const plainBytes = aes256CtrTransform(session.encKey, ivBytes, ctBytes, CryptoJSRef);
            const plaintext = utf8Decode(plainBytes);
            const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

            metrics.lastDecryptMs = Number((t1 - t0).toFixed(2));
            metrics.decryptedResponses += 1;
            metrics.totalBytesDecrypted += plainBytes.length;
            return plaintext;
        }

        function getDiagnostics() {
            return {
                ready: isReady(),
                protocol: TRANSPORT_PROTOCOL,
                kid: session ? session.kid : null,
                kex: session ? session.kex : 'X25519 (Curve25519 ECDH) + HKDF-SHA256',
                cipher: session ? session.cipher : 'AES-256-CTR + HMAC-SHA256',
                expiresAt: session ? session.expiresAt : null,
                metrics: { ...metrics }
            };
        }

        function resetSession() {
            if (session) {
                session.encKey.fill(0);
                session.macKey.fill(0);
                session = null;
            }
            seqCounter = 0;
        }

        return {
            TRANSPORT_PROTOCOL,
            isReady,
            establishSession,
            deriveSessionFromHandshake,
            encryptText,
            decryptEnvelope,
            getDiagnostics,
            resetSession
        };
    }

    return {
        TRANSPORT_PROTOCOL,
        x25519,
        generateX25519KeyPair,
        hkdfSha256,
        aes256CtrTransform,
        createClientTunnel
    };
}));
