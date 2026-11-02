import 'dotenv/config';
import { createResultsService } from './app.js';

const port = Number(process.env.PORT || 3003);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const pollServiceUrl = process.env.POLL_SERVICE_URL || 'http://localhost:3001';
const votingServiceUrl = process.env.VOTING_SERVICE_URL || 'http://localhost:3002';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Results Service: PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

try {
  for (const [name, value] of Object.entries({ POLL_SERVICE_URL: pollServiceUrl, VOTING_SERVICE_URL: votingServiceUrl })) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
      throw new Error(`${name} must be an HTTP or HTTPS base URL without a query or fragment.`);
    }
  }

  const { server, io } = createResultsService({ port, clientOrigin, pollServiceUrl, votingServiceUrl });
  server.on('error', (error) => {
    console.error(`Results Service failed to start: ${error.message}`);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(`Results Service is running at http://localhost:${port}`);
  });

  const shutdown = () => io.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error(`Results Service failed to start: ${error.message}`);
  process.exit(1);
}
