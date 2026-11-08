'use strict';

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseRate(value, fallback) {
  const n = parseNumber(value, fallback);
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function loadConfig(env = process.env) {
  return {
    port: parseNumber(env.PORT, 8080),
    appEnv: env.APP_ENV || env.ENVIRONMENT || 'dev',
    appName: env.APP_NAME || 'reservations-api',
    version: env.APP_VERSION || '1.0.0',
    gitSha: env.GIT_SHA || 'dev',
    logLevel: env.LOG_LEVEL || 'info',
    apiKey: env.API_KEY || '',
    startupDelayMs: parseNumber(env.STARTUP_DELAY_MS, 0),
    extraLatencyMs: parseNumber(env.EXTRA_LATENCY_MS, 0),
    errorRate: parseRate(env.ERROR_RATE, 0),
    podName: env.POD_NAME || '',
    podNamespace: env.POD_NAMESPACE || '',
    nodeName: env.NODE_NAME || '',
  };
}

module.exports = { loadConfig, parseNumber, parseRate };
