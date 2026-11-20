/**
 * Pot × Hy-MT2 本地中继 (127.0.0.1:18766)
 *
 * 背景：Pot 的插件通过 Tauri/reqwest 发请求，Windows 上会读取系统代理。
 * 这台机器的系统代理是 mihomo(127.0.0.1:9674)，它没有正确绕过 10.200.8.204，
 * 导致内网请求被代理转发后返回 502。
 *
 * 这个中继让插件请求 http://127.0.0.1:18766/...，本机地址不会进系统代理；
 * 再由 Node 用 http.request 直连 10.200.8.204:9090。
 */

'use strict';

const http = require('http');

const PORT = Number(process.env.HYMT2_RELAY_PORT || 18766);
const TARGET_HOST = process.env.HYMT2_TARGET_HOST || '10.200.8.204';
const TARGET_PORT = Number(process.env.HYMT2_TARGET_PORT || 9090);
const UPSTREAM_TIMEOUT_MS = Number(process.env.HYMT2_RELAY_TIMEOUT_MS || 120000);
const LOG_FILE = require('path').join(__dirname, 'relay-hymt2.log');

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': '*',
};

function log(...args) {
    const line = `${new Date().toISOString()} ${args.join(' ')}`;
    console.log(line);
    try {
        require('fs').appendFileSync(LOG_FILE, `${line}\n`);
    } catch (error) {
        // 日志失败不影响转发
    }
}

const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        return res.end();
    }

    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, target: `${TARGET_HOST}:${TARGET_PORT}` }));
    }

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', (error) => log('client error', error.message));

    req.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers = { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` };
        delete headers.origin;
        delete headers.referer;
        delete headers.connection;
        delete headers['proxy-connection'];
        delete headers['accept-encoding'];

        const startedAt = Date.now();
        let firstByteAt = 0;

        const upstream = http.request(
            {
                host: TARGET_HOST,
                port: TARGET_PORT,
                path: req.url,
                method: req.method,
                headers,
                timeout: UPSTREAM_TIMEOUT_MS,
            },
            (up) => {
                const outHeaders = { ...CORS };
                for (const [key, value] of Object.entries(up.headers)) {
                    if (
                        ![
                            'connection',
                            'keep-alive',
                            'proxy-authenticate',
                            'proxy-authorization',
                            'te',
                            'trailer',
                            'trailers',
                            'transfer-encoding',
                            'upgrade',
                        ].includes(key.toLowerCase())
                    ) {
                        outHeaders[key] = value;
                    }
                }
                res.writeHead(up.statusCode || 502, outHeaders);

                up.on('data', (chunk) => {
                    if (!firstByteAt) {
                        firstByteAt = Date.now();
                        log(
                            `up ${up.statusCode} ${req.method} ${req.url} firstByte=${
                                firstByteAt - startedAt
                            }ms`
                        );
                    }
                    res.write(chunk);
                });
                up.on('end', () => {
                    res.end();
                    log(`done ${up.statusCode} ${req.method} ${req.url} total=${Date.now() - startedAt}ms`);
                });
                up.on('error', (error) => {
                    log('upstream stream error', error.message);
                    res.end();
                });
            }
        );

        upstream.on('timeout', () => {
            upstream.destroy(new Error('upstream timeout'));
        });
        upstream.on('error', (error) => {
            log('upstream error', req.method, req.url, error.message);
            if (!res.headersSent) {
                res.writeHead(502, { ...CORS, 'Content-Type': 'application/json' });
            }
            res.end(JSON.stringify({ error: 'relay upstream error', message: error.message }));
        });

        upstream.end(body);
    });
});

server.on('error', (error) => {
    log('listen error', error.message);
    process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
    log(`hymt2-relay listening on http://127.0.0.1:${PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`);
});
