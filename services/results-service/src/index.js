import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const port = Number(process.env.PORT || 3003);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Results Service: PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

app.use(cors({ origin: clientOrigin }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'results-service', port });
});

app.listen(port, (error) => {
  if (error) {
    console.error(`Results Service failed to start: ${error.message}`);
    process.exit(1);
  }

  console.log(`Results Service is running at http://localhost:${port}`);
});
