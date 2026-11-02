import express from 'express';
import cors from 'cors';
import { fetchPoll } from './poll-client.js';
import { notifyResults } from './results-notifier.js';

function isPositiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function parsePollId(value) {
  const id = Number(value);
  return /^[1-9]\d*$/.test(value) && isPositiveId(id) ? id : null;
}

function validateVote(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Provide a JSON object with pollId, optionId, and participantId.';
  }
  if (!isPositiveId(body.pollId) || !isPositiveId(body.optionId)) {
    return 'pollId and optionId must be positive safe integer numbers.';
  }
  if (typeof body.participantId !== 'string' || !body.participantId.trim() || body.participantId.trim().length > 100 || body.participantId.includes('\0')) {
    return 'participantId must contain between 1 and 100 characters without null characters.';
  }
  return null;
}

export function createApp(db, {
  port = 3002,
  clientOrigin = 'http://localhost:5173',
  pollServiceUrl = 'http://localhost:3001',
  pollRequestTimeoutMs = 3000,
  resultsServiceUrl = null,
  resultsNotificationTimeoutMs = 2000,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: clientOrigin }));
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const insertVote = db.prepare('INSERT INTO votes (poll_id, option_id, participant_id) VALUES (?, ?, ?)');
  const selectCounts = db.prepare('SELECT option_id AS optionId, COUNT(*) AS count FROM votes WHERE poll_id = ? GROUP BY option_id');
  const selectTotal = db.prepare('SELECT COUNT(*) AS totalVotes FROM votes WHERE poll_id = ?');
  const getPoll = (pollId) => fetchPoll(pollId, pollServiceUrl, pollRequestTimeoutMs);

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'voting-service', port });
  });

  app.post('/votes', async (req, res) => {
    const validationError = validateVote(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { pollId, optionId } = req.body;
    const participantId = req.body.participantId.trim();
    const poll = await getPoll(pollId);

    if (poll.status !== 'open') {
      return res.status(409).json({ error: 'Poll is closed.' });
    }
    if (!poll.options.some((option) => option.id === optionId)) {
      return res.status(400).json({ error: 'Selected option does not belong to this poll.' });
    }

    let voteId;
    try {
      const { lastInsertRowid } = insertVote.run(pollId, optionId, participantId);
      voteId = Number(lastInsertRowid);
    } catch (error) {
      // The database also protects against simultaneous duplicate requests.
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Participant has already voted in this poll.' });
      }
      throw error;
    }

    res.status(201).json({ id: voteId, pollId, optionId });
    // The vote is saved and acknowledged before notifying the Results Service.
    if (resultsServiceUrl) {
      void notifyResults(pollId, resultsServiceUrl, resultsNotificationTimeoutMs);
    }
  });

  app.get('/votes/:pollId/counts', async (req, res) => {
    const pollId = parsePollId(req.params.pollId);
    if (pollId === null) {
      return res.status(400).json({ error: 'Poll ID must be a positive safe integer.' });
    }

    const poll = await getPoll(pollId);
    const votesByOption = new Map(selectCounts.all(pollId).map((row) => [row.optionId, row.count]));
    const counts = poll.options.map((option) => ({
      optionId: option.id,
      text: option.text,
      count: votesByOption.get(option.id) || 0,
    }));
    const totalVotes = counts.reduce((total, option) => total + option.count, 0);
    return res.json({ pollId, totalVotes, counts });
  });

  app.get('/votes/:pollId/total', async (req, res) => {
    const pollId = parsePollId(req.params.pollId);
    if (pollId === null) {
      return res.status(400).json({ error: 'Poll ID must be a positive safe integer.' });
    }

    await getPoll(pollId);
    return res.json({ pollId, totalVotes: selectTotal.get(pollId).totalVotes });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found.' });
  });

  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body must be valid JSON.' });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body exceeds the 16 KB limit.' });
    }
    if ([400, 404, 415, 502, 503].includes(error.status)) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error('Voting Service request failed:', error.message);
    return res.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  return app;
}
