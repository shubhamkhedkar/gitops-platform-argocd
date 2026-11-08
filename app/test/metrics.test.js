'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMetrics, formatLabels } = require('../src/metrics');

test('formatLabels sorts keys and escapes values', () => {
  assert.equal(formatLabels({}), '');
  assert.equal(formatLabels({ b: '2', a: '1' }), '{a="1",b="2"}');
  assert.equal(formatLabels({ path: 'say "hi"' }), '{path="say \\"hi\\""}');
});

test('counters increment and render in Prometheus text format', () => {
  const metrics = createMetrics({ app: 'reservations-api' });
  metrics.inc('reservations_created_total', { app: 'reservations-api' });
  metrics.inc('reservations_created_total', { app: 'reservations-api' }, 2);
  const text = metrics.render();
  assert.match(text, /# TYPE reservations_created_total counter/);
  assert.match(text, /reservations_created_total\{app="reservations-api"\} 3/);
  assert.match(text, /app_info\{app="reservations-api"\} 1/);
});

test('request records status counters and duration histogram buckets', () => {
  const metrics = createMetrics({ app: 'reservations-api' });
  metrics.request('GET', '/api/reservations', 200, 0.02);
  metrics.request('GET', '/api/reservations', 200, 0.4);
  const text = metrics.render();
  assert.match(text, /http_requests_total\{app="reservations-api",code="200",method="GET",path="\/api\/reservations"\} 2/);
  assert.match(text, /http_request_duration_seconds_count\{app="reservations-api",method="GET",path="\/api\/reservations"\} 2/);
  assert.match(text, /http_request_duration_seconds_bucket\{app="reservations-api",le="0.025",method="GET",path="\/api\/reservations"\} 1/);
  assert.match(text, /http_request_duration_seconds_bucket\{app="reservations-api",le="\+Inf",method="GET",path="\/api\/reservations"\} 2/);
});
