'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');

const API_KEY = 'example-api-key-change-me';

function baseConfig(overrides = {}) {
  return {
    port: 0,
    appEnv: 'test',
    appName: 'reservations-api',
    version: '1.0.0',
    gitSha: 'testdeadbeef',
    logLevel: 'info',
    apiKey: API_KEY,
    startupDelayMs: 0,
    extraLatencyMs: 0,
    errorRate: 0,
    podName: 'pod-test',
    podNamespace: 'reservations-test',
    nodeName: 'node-test',
    ...overrides,
  };
}

async function startApp(configOverrides = {}, deps = {}) {
  const app = createApp(baseConfig(configOverrides), {
    store: createStore({ seed: deps.seed }),
    random: deps.random,
    ...deps,
  });
  await new Promise((resolve) => {
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = app.server.address();
  return { app, base: `http://127.0.0.1:${port}` };
}

const running = [];

beforeEach(() => {
  running.length = 0;
});

afterEach(async () => {
  await Promise.all(running.map(({ app }) => new Promise((resolve) => {
    app.server.close(() => resolve());
  })));
});

async function launch(configOverrides, deps) {
  const started = await startApp(configOverrides, deps);
  running.push(started);
  return started;
}

test('GET / returns service metadata', async () => {
  const { base } = await launch();
  const res = await fetch(base);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.service, 'reservations-api');
  assert.equal(body.environment, 'test');
  assert.equal(body.version, '1.0.0');
});

test('probe endpoints report liveness and readiness', async () => {
  const { base } = await launch();
  const live = await fetch(`${base}/healthz`);
  const ready = await fetch(`${base}/readyz`);
  const start = await fetch(`${base}/startupz`);
  assert.equal(live.status, 200);
  assert.equal(ready.status, 200);
  assert.equal(start.status, 200);
  assert.deepEqual(await live.json(), { status: 'ok' });
  assert.deepEqual(await ready.json(), { status: 'ready' });
});

test('readiness fails while shutting down', async () => {
  const { app, base } = await launch();
  app.status.shuttingDown = true;
  const res = await fetch(`${base}/readyz`);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { status: 'not-ready' });
});

test('startup probe stays 503 until warm-up completes', async () => {
  const { app, base } = await launch({ startupDelayMs: 30_000 }, {
    status: { started: false, ready: true, shuttingDown: false },
  });
  const res = await fetch(`${base}/startupz`);
  assert.equal(res.status, 503);
  app.status.started = true;
  const after = await fetch(`${base}/startupz`);
  assert.equal(after.status, 200);
});

test('GET /version and /api/info hide secret values', async () => {
  const { base } = await launch();
  const version = await (await fetch(`${base}/version`)).json();
  assert.equal(version.gitSha, 'testdeadbeef');
  assert.equal(version.environment, 'test');
  const info = await (await fetch(`${base}/api/info`)).json();
  assert.equal(info.apiKeyConfigured, true);
  assert.equal(info.pod.name, 'pod-test');
  assert.equal(JSON.stringify(info).includes(API_KEY), false);
});

test('GET /api/reservations returns seed data and supports filtering', async () => {
  const { base } = await launch();
  const all = await (await fetch(`${base}/api/reservations`)).json();
  assert.equal(all.reservations.length, 2);
  const filtered = await (await fetch(`${base}/api/reservations?resource=room-a`)).json();
  assert.equal(filtered.reservations.length, 1);
  assert.equal(filtered.reservations[0].resource, 'room-a');
});

test('GET /api/reservations/:id returns one reservation or 404', async () => {
  const { base } = await launch();
  const found = await fetch(`${base}/api/reservations/r-1001`);
  assert.equal(found.status, 200);
  assert.equal((await found.json()).requester, 'alex');
  const missing = await fetch(`${base}/api/reservations/r-missing`);
  assert.equal(missing.status, 404);
});

test('GET /api/resources lists booked resources', async () => {
  const { base } = await launch();
  const body = await (await fetch(`${base}/api/resources`)).json();
  assert.deepEqual(body.resources, ['room-a', 'room-b']);
});

test('POST /api/reservations requires a valid API key', async () => {
  const { base } = await launch();
  const payload = {
    resource: 'room-c',
    requester: 'casey',
    start: '2026-11-08T15:00:00.000Z',
    end: '2026-11-08T16:00:00.000Z',
  };
  const missing = await fetch(`${base}/api/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(missing.status, 401);
  const wrong = await fetch(`${base}/api/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'nope' },
    body: JSON.stringify(payload),
  });
  assert.equal(wrong.status, 401);
});

test('POST /api/reservations creates a booking and rejects overlaps', async () => {
  const { base } = await launch();
  const created = await fetch(`${base}/api/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({
      resource: 'room-a',
      requester: 'casey',
      start: '2026-11-08T16:00:00.000Z',
      end: '2026-11-08T17:00:00.000Z',
      purpose: 'retro',
    }),
  });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.resource, 'room-a');
  assert.ok(body.id);

  const conflict = await fetch(`${base}/api/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({
      resource: 'room-a',
      requester: 'drew',
      start: '2026-11-08T09:30:00.000Z',
      end: '2026-11-08T10:30:00.000Z',
    }),
  });
  assert.equal(conflict.status, 409);
});

test('POST /api/reservations rejects invalid JSON and payloads', async () => {
  const { base } = await launch();
  const invalid = await fetch(`${base}/api/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    body: '{not-json',
  });
  assert.equal(invalid.status, 400);
  const incomplete = await fetch(`${base}/api/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({ resource: 'room-c' }),
  });
  assert.equal(incomplete.status, 400);
});

test('DELETE /api/reservations/:id requires a key and removes the booking', async () => {
  const { base } = await launch();
  const unauthorized = await fetch(`${base}/api/reservations/r-1002`, { method: 'DELETE' });
  assert.equal(unauthorized.status, 401);
  const deleted = await fetch(`${base}/api/reservations/r-1002`, {
    method: 'DELETE',
    headers: { 'x-api-key': API_KEY },
  });
  assert.equal(deleted.status, 200);
  const missing = await fetch(`${base}/api/reservations/r-1002`);
  assert.equal(missing.status, 404);
});

test('unknown routes return 404', async () => {
  const { base } = await launch();
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
});

test('GET /metrics exposes Prometheus counters after traffic', async () => {
  const { base } = await launch();
  await fetch(`${base}/api/reservations`);
  const res = await fetch(`${base}/metrics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const text = await res.text();
  assert.match(text, /http_requests_total\{app="reservations-api",code="200",method="GET",path="\/api\/reservations"\} /);
  assert.match(text, /http_request_duration_seconds_count\{app="reservations-api",method="GET",path="\/api\/reservations"\} /);
  assert.match(text, /app_info\{app="reservations-api"\} 1/);
});

test('ERROR_RATE injects failures on API routes but not on probes', async () => {
  const { base } = await launch({ errorRate: 1 }, { random: () => 0 });
  const failed = await fetch(`${base}/api/reservations`);
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: 'injected failure' });
  const live = await fetch(`${base}/healthz`);
  assert.equal(live.status, 200);
  const metrics = await (await fetch(`${base}/metrics`)).text();
  assert.match(metrics, /injected_failures_total\{app="reservations-api"\} 1/);
});

test('EXTRA_LATENCY_MS delays API responses', async () => {
  const { base } = await launch({ extraLatencyMs: 40 });
  const started = Date.now();
  const res = await fetch(`${base}/api/resources`);
  const elapsed = Date.now() - started;
  assert.equal(res.status, 200);
  assert.ok(elapsed >= 35, `expected delay, took ${elapsed}ms`);
});

test('reservation id paths are normalized in metrics', async () => {
  const { base } = await launch();
  await fetch(`${base}/api/reservations/r-1001`);
  const text = await (await fetch(`${base}/metrics`)).text();
  assert.match(text, /path="\/api\/reservations\/:id"/);
  assert.doesNotMatch(text, /path="\/api\/reservations\/r-1001"/);
});
