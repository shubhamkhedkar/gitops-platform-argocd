'use strict';

const { loadConfig } = require('./config');
const { createApp } = require('./app');

const config = loadConfig();
const { server, status } = createApp(config);

server.listen(config.port, () => {
  process.stdout.write(`${JSON.stringify({
    level: 'info',
    msg: 'reservations-api listening',
    port: config.port,
    env: config.appEnv,
    version: config.version,
  })}\n`);
});

function shutdown(signal) {
  process.stdout.write(`${JSON.stringify({ level: 'info', msg: 'shutdown requested', signal })}\n`);
  status.shuttingDown = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 20000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
