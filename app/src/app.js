'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { createStore } = require('./store');
const { createMetrics } = require('./metrics');

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function sendText(res, status, body, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left.length ? left : Buffer.from([0]), left.length ? left : Buffer.from([0]));
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function authorize(req, config) {
  if (!config.apiKey) return false;
  const header = req.headers['x-api-key'] || '';
  return safeEqual(header, config.apiKey);
}

function normalizePath(pathname) {
  if (pathname === '/api/reservations' || pathname === '/api/resources' || pathname === '/api/info') {
    return pathname;
  }
  if (/^\/api\/reservations\/[^/]+$/.test(pathname)) return '/api/reservations/:id';
  return pathname;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

function createApp(config, deps = {}) {
  const store = deps.store || createStore();
  const metrics = deps.metrics || createMetrics({ app: config.appName });
  const random = deps.random || Math.random;
  const status = deps.status || {
    started: config.startupDelayMs <= 0,
    ready: true,
    shuttingDown: false,
  };

  if (!status.started && config.startupDelayMs > 0) {
    setTimeout(() => {
      status.started = true;
    }, config.startupDelayMs).unref();
  }

  async function handler(req, res) {
    const started = process.hrtime.bigint();
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const metricPath = normalizePath(path);
    let code = 500;

    const finish = () => {
      const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
      metrics.request(req.method, metricPath, code, elapsed);
    };
    res.on('finish', finish);

    try {
      if (path === '/startupz') {
        code = status.started ? 200 : 503;
        return sendJson(res, code, { status: status.started ? 'started' : 'starting' });
      }
      if (path === '/healthz') {
        code = 200;
        return sendJson(res, 200, { status: 'ok' });
      }
      if (path === '/readyz') {
        const ready = status.started && status.ready && !status.shuttingDown;
        code = ready ? 200 : 503;
        return sendJson(res, code, { status: ready ? 'ready' : 'not-ready' });
      }
      if (path === '/metrics') {
        code = 200;
        return sendText(res, 200, metrics.render(), 'text/plain; version=0.0.4; charset=utf-8');
      }

      const isApi = path === '/' || path.startsWith('/api/');
      if (isApi && config.extraLatencyMs > 0) {
        await sleep(config.extraLatencyMs);
      }
      if (isApi && path !== '/' && config.errorRate > 0 && random() < config.errorRate) {
        metrics.inc('injected_failures_total', { app: config.appName });
        code = 500;
        return sendJson(res, 500, { error: 'injected failure' });
      }

      if (path === '/' && req.method === 'GET') {
        code = 200;
        return sendJson(res, 200, {
          service: config.appName,
          message: 'Reservations API',
          environment: config.appEnv,
          version: config.version,
        });
      }

      if (path === '/version' && req.method === 'GET') {
        code = 200;
        return sendJson(res, 200, {
          service: config.appName,
          version: config.version,
          gitSha: config.gitSha,
          environment: config.appEnv,
        });
      }

      if (path === '/api/info' && req.method === 'GET') {
        code = 200;
        return sendJson(res, 200, {
          service: config.appName,
          environment: config.appEnv,
          version: config.version,
          gitSha: config.gitSha,
          logLevel: config.logLevel,
          errorRate: config.errorRate,
          extraLatencyMs: config.extraLatencyMs,
          apiKeyConfigured: Boolean(config.apiKey),
          pod: {
            name: config.podName,
            namespace: config.podNamespace,
            node: config.nodeName,
          },
        });
      }

      if (path === '/api/resources' && req.method === 'GET') {
        code = 200;
        return sendJson(res, 200, { resources: store.resources() });
      }

      if (path === '/api/reservations' && req.method === 'GET') {
        code = 200;
        return sendJson(res, 200, { reservations: store.list(url.searchParams.get('resource') || '') });
      }

      if (path === '/api/reservations' && req.method === 'POST') {
        if (!authorize(req, config)) {
          code = 401;
          return sendJson(res, 401, { error: 'invalid or missing API key' });
        }
        let parsed;
        try {
          const raw = await readBody(req);
          parsed = raw ? JSON.parse(raw) : {};
        } catch (err) {
          if (err.status === 413) {
            code = 413;
            return sendJson(res, 413, { error: 'payload too large' });
          }
          code = 400;
          return sendJson(res, 400, { error: 'invalid JSON' });
        }
        const result = store.create(parsed);
        if (result.error) {
          code = result.status;
          if (result.status === 409) {
            metrics.inc('reservations_conflicts_total', { app: config.appName });
          }
          return sendJson(res, result.status, { error: result.error });
        }
        metrics.inc('reservations_created_total', { app: config.appName });
        code = 201;
        return sendJson(res, 201, result.value);
      }

      const match = path.match(/^\/api\/reservations\/([^/]+)$/);
      if (match && req.method === 'GET') {
        const found = store.get(match[1]);
        if (!found) {
          code = 404;
          return sendJson(res, 404, { error: 'reservation not found' });
        }
        code = 200;
        return sendJson(res, 200, found);
      }
      if (match && req.method === 'DELETE') {
        if (!authorize(req, config)) {
          code = 401;
          return sendJson(res, 401, { error: 'invalid or missing API key' });
        }
        const deleted = store.remove(match[1]);
        if (!deleted) {
          code = 404;
          return sendJson(res, 404, { error: 'reservation not found' });
        }
        code = 200;
        return sendJson(res, 200, deleted);
      }

      code = 404;
      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      code = err.status || 500;
      return sendJson(res, code, { error: code === 413 ? 'payload too large' : 'internal error' });
    }
  }

  const server = http.createServer(handler);
  return { server, status, store, metrics, handler };
}

module.exports = { createApp, normalizePath, sendJson, safeEqual };
