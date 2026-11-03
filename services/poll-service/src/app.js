import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import express from 'express';
import cors from 'cors';

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function parsePollId(value) {
  const id = Number(value);
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(id) ? id : null;
}

function validatePoll(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Provide a JSON object with a question and options.';
  }

  if (typeof body.question !== 'string' || !body.question.trim() || body.question.trim().length > 500) {
    return 'Question must contain between 1 and 500 characters.';
  }

  if (!Array.isArray(body.options) || body.options.length < 2 || body.options.length > 4) {
    return 'Provide between 2 and 4 options.';
  }

  if (body.options.some((option) => typeof option !== 'string' || !option.trim() || option.trim().length > 200)) {
    return 'Each option must contain between 1 and 200 characters.';
  }

  const uniqueOptions = new Set(body.options.map((option) => option.trim().toLowerCase()));
  if (uniqueOptions.size !== body.options.length) {
    return 'Options must be different from each other.';
  }

  return null;
}

export function createApp(db, { port = 3001, clientOrigin = 'http://localhost:5173' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: clientOrigin }));
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Select public fields explicitly so tokens and their hashes cannot be returned.
  const selectPoll = db.prepare('SELECT id, question, room_code AS roomCode, status FROM polls WHERE id = ?');
  const selectOptions = db.prepare('SELECT id, text FROM poll_options WHERE poll_id = ? ORDER BY position');
  const selectRoom = db.prepare('SELECT id FROM polls WHERE room_code = ?');
  const selectHost = db.prepare('SELECT host_token_hash AS hostTokenHash FROM polls WHERE id = ?');
  const insertPoll = db.prepare('INSERT INTO polls (question, room_code, host_token_hash) VALUES (?, ?, ?)');
  const insertOption = db.prepare('INSERT INTO poll_options (poll_id, text, position) VALUES (?, ?, ?)');
  const closePoll = db.prepare("UPDATE polls SET status = 'closed' WHERE id = ? AND status = 'open'");

  function getPoll(id) {
    const poll = selectPoll.get(id);
    return poll ? { ...poll, options: selectOptions.all(id) } : null;
  }

  // A failed insert rolls back the entire poll, including all its options.
  const savePoll = db.transaction((question, options, roomCode, tokenHash) => {
    const { lastInsertRowid } = insertPoll.run(question, roomCode, tokenHash);
    options.forEach((text, position) => insertOption.run(lastInsertRowid, text, position));
    return Number(lastInsertRowid);
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'poll-service', port });
  });

  app.post('/polls', (req, res) => {
    const validationError = validatePoll(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const question = req.body.question.trim();
    const options = req.body.options.map((option) => option.trim());
    const hostToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(hostToken);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const roomCode = String(randomInt(100000, 1000000));
      let id;

      try {
        id = savePoll(question, options, roomCode, tokenHash);
      } catch (error) {
        // The UNIQUE constraint handles collisions, including simultaneous creates.
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') continue;
        throw error;
      }

      return res.status(201).location(`/polls/${id}`).json({ ...getPoll(id), hostToken });
    }

    return res.status(503).json({ error: 'Could not generate an available room code. Please try again.' });
  });

  // Register this route before /polls/:id so room codes have a distinct URL.
  app.get('/polls/room/:roomCode', (req, res) => {
    if (!/^[1-9]\d{5}$/.test(req.params.roomCode)) {
      return res.status(400).json({ error: 'Room code must be a 6-digit number from 100000 to 999999.' });
    }

    const row = selectRoom.get(req.params.roomCode);
    if (!row) {
      return res.status(404).json({ error: 'Poll not found.' });
    }

    return res.json(getPoll(row.id));
  });

  app.get('/polls/:id', (req, res) => {
    const id = parsePollId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Poll ID must be a positive safe integer.' });
    }

    const poll = getPoll(id);
    if (!poll) {
      return res.status(404).json({ error: 'Poll not found.' });
    }

    return res.json(poll);
  });

  app.patch('/polls/:id/close', (req, res) => {
    const id = parsePollId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Poll ID must be a positive safe integer.' });
    }

    const poll = getPoll(id);
    if (!poll) {
      return res.status(404).json({ error: 'Poll not found.' });
    }

    const authorization = req.get('Authorization') || '';
    const match = /^Bearer ([a-f0-9]{64})$/i.exec(authorization);
    if (!match) {
      return res.status(401).json({ error: 'Provide the host token in an Authorization: Bearer header.' });
    }

    const suppliedHash = Buffer.from(hashToken(match[1]), 'hex');
    const storedHash = Buffer.from(selectHost.get(id).hostTokenHash, 'hex');
    if (!timingSafeEqual(suppliedHash, storedHash)) {
      return res.status(403).json({ error: 'Invalid host token.' });
    }

    // Check authorization first, even when the poll is already closed.
    if (closePoll.run(id).changes === 0) {
      return res.status(409).json({ error: 'Poll is already closed.' });
    }

    return res.json(getPoll(id));
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
    if (error.status === 415) {
      return res.status(415).json({ error: 'Request body uses an unsupported charset or content encoding.' });
    }
    if (error.status === 400) {
      return res.status(400).json({ error: 'Invalid request.' });
    }

    console.error('Poll Service request failed:', error.message);
    return res.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  return app;
}
