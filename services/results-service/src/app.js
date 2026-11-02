import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createResultsReader } from './results.js';

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function publicError(error) {
  const status = [400, 404, 409, 415, 502, 503].includes(error.status) ? error.status : 500;
  return { status, error: status === 500 ? 'An unexpected server error occurred.' : error.message };
}

export function createResultsService({
  port = 3003,
  clientOrigin = 'http://localhost:5173',
  pollServiceUrl = 'http://localhost:3001',
  votingServiceUrl = 'http://localhost:3002',
  requestTimeoutMs = 3000,
} = {}) {
  const app = express();
  const server = createServer(app);
  const io = new Server(server, { cors: { origin: clientOrigin } });
  const getResults = createResultsReader({ pollServiceUrl, votingServiceUrl, requestTimeoutMs });
  const pollRefreshes = new Map();
  const roomName = (pollId) => `poll:${pollId}`;

  // Finish refreshes in order so a slower, older snapshot cannot replace a newer one.
  function refreshInOrder(pollId, work) {
    const previous = pollRefreshes.get(pollId) || Promise.resolve();
    const refresh = previous.catch(() => {}).then(work);
    pollRefreshes.set(pollId, refresh);
    const cleanup = () => {
      if (pollRefreshes.get(pollId) === refresh) pollRefreshes.delete(pollId);
    };
    refresh.then(cleanup, cleanup);
    return refresh;
  }

  app.disable('x-powered-by');
  app.use(cors({ origin: clientOrigin }));
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'results-service', port });
  });

  app.get('/results/:pollId', async (req, res) => {
    const pollId = Number(req.params.pollId);
    if (!/^[1-9]\d*$/.test(req.params.pollId) || !positiveId(pollId)) {
      return res.status(400).json({ error: 'Poll ID must be a positive safe integer.' });
    }
    return res.json(await getResults(pollId));
  });

  app.post('/internal/votes', async (req, res) => {
    const pollId = req.body?.pollId;
    if (!positiveId(pollId)) {
      return res.status(400).json({ error: 'pollId must be a positive safe integer number.' });
    }

    try {
      await refreshInOrder(pollId, async () => {
        const results = await getResults(pollId);
        io.to(roomName(pollId)).emit('results-update', results);
      });
      return res.json({ ok: true, pollId });
    } catch (error) {
      io.to(roomName(pollId)).emit('results-error', { pollId, ...publicError(error) });
      throw error;
    }
  });

  io.on('connection', (socket) => {
    let currentPollId = null;
    let joinVersion = 0;

    async function joinPoll(payload, acknowledge) {
      const version = ++joinVersion;
      const pollId = payload?.pollId;
      const reply = (value) => {
        if (socket.connected && typeof acknowledge === 'function') acknowledge(value);
      };

      // Each socket watches one poll. A new join also cancels a pending old join.
      if (currentPollId !== null) socket.leave(roomName(currentPollId));
      currentPollId = null;
      if (!positiveId(pollId)) {
        const error = { status: 400, error: 'pollId must be a positive safe integer number.' };
        socket.emit('results-error', error);
        reply({ ok: false, ...error });
        return;
      }

      try {
        const joined = await refreshInOrder(pollId, async () => {
          if (!socket.connected || version !== joinVersion) return false;
          const results = await getResults(pollId);
          if (!socket.connected || version !== joinVersion) return false;
          socket.join(roomName(pollId));
          currentPollId = pollId;
          socket.emit('results-update', results);
          return true;
        });
        reply(joined ? { ok: true, pollId } : { ok: false, status: 409, error: 'Join request was replaced by a newer request.' });
      } catch (error) {
        if (!socket.connected) return;
        if (version !== joinVersion) {
          reply({ ok: false, status: 409, error: 'Join request was replaced by a newer request.' });
          return;
        }
        const details = publicError(error);
        if (details.status === 500) console.error('Results Service socket request failed:', error.message);
        socket.emit('results-error', { pollId, ...details });
        reply({ ok: false, ...details });
      }
    }

    socket.on('join-poll', joinPoll);
    socket.on('disconnect', () => {
      joinVersion += 1;
      currentPollId = null;
    });
    if (socket.handshake.auth?.pollId !== undefined) {
      void joinPoll({ pollId: socket.handshake.auth.pollId });
    }
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found.' });
  });

  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body exceeds the 16 KB limit.' });
    const details = publicError(error);
    if (details.status === 500) console.error('Results Service request failed:', error.message);
    return res.status(details.status).json({ error: details.error });
  });

  return { app, server, io };
}
