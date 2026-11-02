import 'dotenv/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase } from './database.js';

const port = Number(process.env.PORT || 3002);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const pollServiceUrl = process.env.POLL_SERVICE_URL || 'http://localhost:3001';
const serviceDirectory = fileURLToPath(new URL('../', import.meta.url));
const databasePath = resolve(serviceDirectory, process.env.DATABASE_PATH || 'data/votes.db');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Voting Service: PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

try {
  const pollUrl = new URL(pollServiceUrl);
  if (!['http:', 'https:'].includes(pollUrl.protocol) || pollUrl.search || pollUrl.hash) {
    throw new Error('POLL_SERVICE_URL must be an HTTP or HTTPS base URL without a query or fragment.');
  }

  const db = openDatabase(databasePath);
  const app = createApp(db, { port, clientOrigin, pollServiceUrl });
  const server = app.listen(port, (error) => {
    if (error) {
      console.error(`Voting Service failed to start: ${error.message}`);
      db.close();
      process.exit(1);
    }

    console.log(`Voting Service is running at http://localhost:${port}`);
    console.log(`SQLite database: ${databasePath}`);
  });

  function shutdown() {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error(`Voting Service failed to start: ${error.message}`);
  process.exit(1);
}
