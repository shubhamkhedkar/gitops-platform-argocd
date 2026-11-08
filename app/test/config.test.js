'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, parseNumber, parseRate } = require('../src/config');

test('loadConfig applies defaults', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.port, 8080);
  assert.equal(cfg.appEnv, 'dev');
  assert.equal(cfg.appName, 'reservations-api');
  assert.equal(cfg.version, '1.0.0');
  assert.equal(cfg.errorRate, 0);
  assert.equal(cfg.extraLatencyMs, 0);
  assert.equal(cfg.apiKey, '');
});

test('loadConfig reads environment overrides', () => {
  const cfg = loadConfig({
    PORT: '9090',
    APP_ENV: 'prod',
    APP_VERSION: '1.2.3',
    GIT_SHA: 'abc123',
    API_KEY: 'example-api-key-change-me',
    ERROR_RATE: '0.25',
    EXTRA_LATENCY_MS: '15',
    LOG_LEVEL: 'warn',
    POD_NAME: 'pod-a',
  });
  assert.equal(cfg.port, 9090);
  assert.equal(cfg.appEnv, 'prod');
  assert.equal(cfg.version, '1.2.3');
  assert.equal(cfg.gitSha, 'abc123');
  assert.equal(cfg.errorRate, 0.25);
  assert.equal(cfg.extraLatencyMs, 15);
  assert.equal(cfg.logLevel, 'warn');
  assert.equal(cfg.podName, 'pod-a');
});

test('loadConfig accepts ENVIRONMENT as an APP_ENV alias', () => {
  const cfg = loadConfig({ ENVIRONMENT: 'staging' });
  assert.equal(cfg.appEnv, 'staging');
});

test('parseNumber falls back for blank or invalid input', () => {
  assert.equal(parseNumber(undefined, 3), 3);
  assert.equal(parseNumber('', 3), 3);
  assert.equal(parseNumber('nope', 3), 3);
  assert.equal(parseNumber('12', 3), 12);
});

test('parseRate clamps values between 0 and 1', () => {
  assert.equal(parseRate('-1', 0), 0);
  assert.equal(parseRate('2', 0), 1);
  assert.equal(parseRate('0.2', 0), 0.2);
});
