import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { scheduleBackups } from './db/backup.js';
import { openDb } from './db/index.js';
import { seedIfEmpty } from './db/seed.js';

function main() {
  const config = loadConfig();
  const db = openDb(config.databasePath);
  if (seedIfEmpty(db, config)) console.log("Base vide : données d'exemple chargées.");
  scheduleBackups(db, config.databasePath);
  const app = createApp({ config, db });
  const server = http.createServer(app);
  server.listen(config.port, () => {
    console.log(`Drops API en écoute sur le port ${config.port}`);
  });
  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
