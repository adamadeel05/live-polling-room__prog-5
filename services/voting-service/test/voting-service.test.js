import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';
import { createApp as createPollApp } from '../../poll-service/src/app.js';
import { openDatabase as openPollDatabase } from '../../poll-service/src/database.js';

let directory;
let databasePath;
let db;
let pollDb;
let votingServer;
let pollServer;
let votingUrl;
let pollUrl;
let stubServers;

async function listen(server) {
  await new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListening);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolveClosed, reject) => {
    server.close((error) => error ? reject(error) : resolveClosed());
    server.closeAllConnections();
  });
}

async function startVoting(pollServiceUrl = pollUrl, pollRequestTimeoutMs = 3000) {
  const app = createApp(db, {
    port: 3002,
    clientOrigin: 'http://localhost:5173',
    pollServiceUrl,
    pollRequestTimeoutMs,
  });
  votingServer = createServer(app);
  votingUrl = await listen(votingServer);
}

async function usePollStub(handler, timeout = 3000) {
  await close(votingServer);
  const stub = createServer(handler);
  stubServers.push(stub);
  const url = await listen(stub);
  await startVoting(url, timeout);
  return stub;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'voting-service-test-'));
  databasePath = join(directory, 'votes.db');
  db = openDatabase(databasePath);
  pollDb = openPollDatabase(join(directory, 'polls.db'));
  stubServers = [];
  pollServer = createServer(createPollApp(pollDb));
  pollUrl = await listen(pollServer);
  await startVoting();
});

afterEach(async () => {
  await close(votingServer);
  await close(pollServer);
  for (const stub of stubServers || []) await close(stub);
  if (db?.open) db.close();
  if (pollDb?.open) pollDb.close();
  if (directory) {
    const absoluteDirectory = resolve(directory);
    assert.equal(dirname(absoluteDirectory), resolve(tmpdir()));
    assert.ok(basename(absoluteDirectory).startsWith('voting-service-test-'));
    await rm(absoluteDirectory, { recursive: true, force: true });
  }
});

async function request(baseUrl, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function createPoll(options = ['JavaScript', 'Java']) {
  const response = await request(pollUrl, '/polls', {
    method: 'POST', body: { question: 'Which language?', options },
  });
  assert.equal(response.status, 201);
  return response.body;
}

function castVote(poll, participantId, optionId = poll.options[0].id) {
  return request(votingUrl, '/votes', {
    method: 'POST', body: { pollId: poll.id, optionId, participantId },
  });
}

function assertError(response, expectedStatus) {
  assert.equal(response.status, expectedStatus);
  assert.equal(typeof response.body.error, 'string');
  assert.ok(response.body.error.length > 0);
}

function storedVoteCount() {
  return db.prepare('SELECT COUNT(*) AS count FROM votes').get().count;
}

test('health, CORS, and JSON 404 responses remain compatible', async () => {
  const health = await request(votingUrl, '/health', {
    headers: { Origin: 'http://localhost:5173' },
  });
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: 'ok', service: 'voting-service', port: 3002 });
  assert.equal(health.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const preflight = await fetch(`${votingUrl}/votes`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type',
    },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assertError(await request(votingUrl, '/unknown-route'), 404);
});

test('a valid vote is persisted with a trimmed participant ID and a minimal public response', async () => {
  const poll = await createPoll();
  const response = await castVote(poll, '  anonymous-browser  ', poll.options[1].id);
  assert.equal(response.status, 201);
  assert.ok(Number.isSafeInteger(response.body.id) && response.body.id > 0);
  assert.deepEqual(response.body, {
    id: response.body.id, pollId: poll.id, optionId: poll.options[1].id,
  });
  const row = db.prepare('SELECT poll_id, option_id, participant_id FROM votes WHERE id = ?').get(response.body.id);
  assert.deepEqual(row, {
    poll_id: poll.id, option_id: poll.options[1].id, participant_id: 'anonymous-browser',
  });
  assert.equal(storedVoteCount(), 1);
});

test('unknown polls, unrelated options, missing options, and closed polls cannot receive votes', async () => {
  const poll = await createPoll();
  const otherPoll = await createPoll();
  assertError(await castVote({ ...poll, id: 999999 }, 'missing-poll'), 404);
  assertError(await castVote(poll, 'wrong-poll-option', otherPoll.options[0].id), 400);
  assertError(await castVote(poll, 'missing-option', 999999), 400);
  const closed = await request(pollUrl, `/polls/${poll.id}/close`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${poll.hostToken}` },
  });
  assert.equal(closed.status, 200);
  assertError(await castVote(poll, 'closed-poll'), 409);
  assert.equal(storedVoteCount(), 0);
});

test('duplicate prevention is enforced by SQLite, trims IDs, and permits the same participant in another poll', async () => {
  const poll = await createPoll();
  const otherPoll = await createPoll();
  assert.equal((await castVote(poll, ' Alice ')).status, 201);
  assertError(await castVote(poll, 'Alice', poll.options[1].id), 409);
  assert.equal((await castVote(poll, 'alice')).status, 201);
  assert.equal((await castVote(otherPoll, 'Alice')).status, 201);

  assert.throws(() => {
    db.prepare('INSERT INTO votes (poll_id, option_id, participant_id) VALUES (?, ?, ?)')
      .run(poll.id, poll.options[1].id, 'Alice');
  }, (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE');
  assert.equal(storedVoteCount(), 3);
});

test('concurrent requests from one participant create exactly one vote', async () => {
  const poll = await createPoll();
  const responses = await Promise.all(Array.from({ length: 5 }, (_, index) => {
    return castVote(poll, 'same-browser', poll.options[index % 2].id);
  }));
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409, 409, 409, 409]);
  assert.equal(storedVoteCount(), 1);
});

test('grouped counts include zero-vote options in poll order and totals remain readable after closing', async () => {
  const poll = await createPoll(['JavaScript', 'Java', 'Python', 'C#']);
  const empty = await request(votingUrl, `/votes/${poll.id}/counts`);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, {
    pollId: poll.id,
    totalVotes: 0,
    counts: poll.options.map((option) => ({ optionId: option.id, text: option.text, count: 0 })),
  });
  assert.deepEqual((await request(votingUrl, `/votes/${poll.id}/total`)).body, { pollId: poll.id, totalVotes: 0 });
  for (const [participantId, optionIndex] of [['browser-a', 1], ['browser-b', 1], ['browser-c', 2]]) {
    assert.equal((await castVote(poll, participantId, poll.options[optionIndex].id)).status, 201);
  }
  const expected = {
    pollId: poll.id,
    totalVotes: 3,
    counts: poll.options.map((option, index) => ({ optionId: option.id, text: option.text, count: [0, 2, 1, 0][index] })),
  };
  assert.deepEqual((await request(votingUrl, `/votes/${poll.id}/counts`)).body, expected);
  assert.deepEqual((await request(votingUrl, `/votes/${poll.id}/total`)).body, { pollId: poll.id, totalVotes: 3 });
  assert.equal((await request(pollUrl, `/polls/${poll.id}/close`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${poll.hostToken}` },
  })).status, 200);
  const closedCounts = await request(votingUrl, `/votes/${poll.id}/counts`);
  const closedTotal = await request(votingUrl, `/votes/${poll.id}/total`);
  assert.equal(closedCounts.status, 200);
  assert.deepEqual(closedCounts.body, expected);
  assert.equal(closedTotal.status, 200);
  assert.deepEqual(closedTotal.body, { pollId: poll.id, totalVotes: 3 });
});

test('invalid inputs, malformed JSON, oversized bodies, and invalid read IDs produce JSON errors', async () => {
  const poll = await createPoll();
  const valid = { pollId: poll.id, optionId: poll.options[0].id, participantId: 'browser' };
  const invalidBodies = [
    {}, null, [],
    ...[undefined, '1', 0, -1, 1.5, 9007199254740992].map((pollId) => ({ ...valid, pollId })),
    ...[undefined, '1', 0, -1, 1.5, 9007199254740992].map((optionId) => ({ ...valid, optionId })),
    ...[undefined, '', '   ', 1, null, 'A'.repeat(101), '\u0000browser'].map((participantId) => ({ ...valid, participantId })),
  ];
  for (const body of invalidBodies) {
    assertError(await request(votingUrl, '/votes', { method: 'POST', body }), 400);
  }
  assertError(await request(votingUrl, '/votes', { method: 'POST' }), 400);
  for (const id of ['abc', '0', '-1', '1.5', '9007199254740992']) {
    for (const suffix of ['counts', 'total']) {
      assertError(await request(votingUrl, `/votes/${id}/${suffix}`), 400);
    }
  }
  for (const suffix of ['counts', 'total']) {
    assertError(await request(votingUrl, `/votes/999999/${suffix}`), 404);
  }
  const malformed = await fetch(`${votingUrl}/votes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid JSON',
  });
  assert.equal(malformed.status, 400);
  assert.equal(typeof (await malformed.json()).error, 'string');
  const oversized = await fetch(`${votingUrl}/votes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...valid, participantId: 'A'.repeat(20_000) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal(typeof (await oversized.json()).error, 'string');
  assert.equal(storedVoteCount(), 0);
  assert.equal((await castVote(poll, 'A'.repeat(100))).status, 201);
});

test('upstream errors, invalid JSON, and malformed polls return 502 without recording votes', async () => {
  const responses = [
    { status: 500, body: JSON.stringify({ error: 'Internal upstream failure' }) },
    { status: 200, body: '{invalid JSON' },
    { status: 200, body: JSON.stringify({ id: 1, status: 'open', options: [] }) },
    { status: 200, body: JSON.stringify({ id: 2, status: 'open', options: [{ id: 1, text: 'A' }, { id: 2, text: 'B' }] }) },
  ];
  for (const upstream of responses) {
    await usePollStub((req, res) => {
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(upstream.body);
    });
    assertError(await request(votingUrl, '/votes', {
      method: 'POST', body: { pollId: 1, optionId: 1, participantId: 'browser' },
    }), 502);
    assertError(await request(votingUrl, '/votes/1/counts'), 502);
    assertError(await request(votingUrl, '/votes/1/total'), 502);
  }
  assert.equal(storedVoteCount(), 0);
});

test('unreachable and timed-out Poll Service requests return 503 without recording votes', async () => {
  const unreachable = await usePollStub((req, res) => res.end('{}'));
  await close(unreachable);
  assertError(await request(votingUrl, '/votes', {
    method: 'POST', body: { pollId: 1, optionId: 1, participantId: 'offline-browser' },
  }), 503);
  assertError(await request(votingUrl, '/votes/1/counts'), 503);
  assertError(await request(votingUrl, '/votes/1/total'), 503);

  await usePollStub(() => {}, 50);
  assertError(await request(votingUrl, '/votes', {
    method: 'POST', body: { pollId: 1, optionId: 1, participantId: 'timeout-browser' },
  }), 503);
  assertError(await request(votingUrl, '/votes/1/counts'), 503);
  assertError(await request(votingUrl, '/votes/1/total'), 503);
  assert.equal(storedVoteCount(), 0);
});

test('vote counts and duplicate prevention persist after reopening SQLite and restarting the app', async () => {
  const poll = await createPoll();
  const first = await castVote(poll, 'persistent-browser', poll.options[1].id);
  assert.equal(first.status, 201);
  await close(votingServer);
  db.close();
  db = openDatabase(databasePath);
  await startVoting();

  assertError(await castVote(poll, 'persistent-browser', poll.options[0].id), 409);
  const counts = await request(votingUrl, `/votes/${poll.id}/counts`);
  assert.equal(counts.status, 200);
  assert.deepEqual(counts.body, {
    pollId: poll.id,
    totalVotes: 1,
    counts: poll.options.map((option, index) => ({ optionId: option.id, text: option.text, count: index === 1 ? 1 : 0 })),
  });
  assert.deepEqual((await request(votingUrl, `/votes/${poll.id}/total`)).body, { pollId: poll.id, totalVotes: 1 });
  assert.equal(storedVoteCount(), 1);
});
