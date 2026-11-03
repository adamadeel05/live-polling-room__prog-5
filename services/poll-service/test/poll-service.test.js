import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';

let directory;
let databasePath;
let db;
let server;
let baseUrl;

async function startServer() {
  const app = createApp(db, {
    port: 3001,
    clientOrigin: 'http://localhost:5173',
  });
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function stopServer() {
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'poll-service-test-'));
  databasePath = join(directory, 'polls.db');
  db = openDatabase(databasePath);
  await startServer();
});

afterEach(async () => {
  await stopServer();
  if (db?.open) db.close();
  if (directory) {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('poll-service-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function createPoll(overrides = {}) {
  const response = await request('/polls', {
    method: 'POST',
    body: { question: 'Which language?', options: ['JavaScript', 'Java'], ...overrides },
  });
  assert.equal(response.status, 201);
  return response.body;
}

function assertError(response, expectedStatus) {
  assert.equal(response.status, expectedStatus);
  assert.equal(typeof response.body.error, 'string');
  assert.ok(response.body.error.length > 0);
}

function assertPublicPoll(poll, hostToken) {
  assert.equal(poll.hostToken, undefined);
  assert.equal(poll.host_token_hash, undefined);
  assert.equal(poll.hostTokenHash, undefined);
  assert.ok(!JSON.stringify(poll).includes(hostToken));
}

test('health, CORS preflight, and JSON 404 responses remain available', async () => {
  const health = await request('/health', { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: 'ok', service: 'poll-service', port: 3001 });
  assert.equal(health.headers.get('access-control-allow-origin'), 'http://localhost:5173');

  const preflight = await fetch(`${baseUrl}/polls/1/close`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'PATCH',
      'Access-Control-Request-Headers': 'Content-Type, Authorization',
    },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods'), /PATCH/);
  assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/i);
  assertError(await request('/unknown-route'), 404);
});

test('creation trims input, preserves option order, and stores only the token hash', async () => {
  const poll = await createPoll({ question: '  Choose a colour?  ', options: [' Red ', ' Blue ', ' Green ', ' Yellow '] });
  assert.ok(Number.isSafeInteger(poll.id) && poll.id > 0);
  assert.equal(poll.question, 'Choose a colour?');
  assert.equal(poll.status, 'open');
  assert.match(poll.roomCode, /^[1-9]\d{5}$/);
  assert.match(poll.hostToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(poll.options.map((option) => option.text), ['Red', 'Blue', 'Green', 'Yellow']);
  assert.ok(poll.options.every((option) => Number.isSafeInteger(option.id) && option.id > 0));
  assert.equal(new Set(poll.options.map((option) => option.id)).size, 4);

  const stored = db.prepare('SELECT * FROM polls WHERE id = ?').get(poll.id);
  assert.equal(stored.host_token_hash, createHash('sha256').update(poll.hostToken).digest('hex'));
  assert.ok(!JSON.stringify(stored).includes(poll.hostToken));
});

test('poll retrieval by room code and ID returns the same public poll without host credentials', async () => {
  const created = await createPoll();
  const { hostToken, ...publicPoll } = created;
  for (const path of [`/polls/${created.id}`, `/polls/room/${created.roomCode}`]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, publicPoll);
    assertPublicPoll(response.body, hostToken);
  }
});

test('invalid poll payloads are rejected without writing poll rows', async () => {
  const invalidBodies = [
    {}, null, [],
    { question: '', options: ['A', 'B'] },
    { question: '   ', options: ['A', 'B'] },
    { question: 42, options: ['A', 'B'] },
    { question: 'Q'.repeat(501), options: ['A', 'B'] },
    { question: 'Q?', options: undefined },
    { question: 'Q?', options: 'A,B' },
    { question: 'Q?', options: [] },
    { question: 'Q?', options: ['A'] },
    { question: 'Q?', options: ['A', 'B', 'C', 'D', 'E'] },
    { question: 'Q?', options: ['A', '   '] },
    { question: 'Q?', options: ['A', 2] },
    { question: 'Q?', options: ['A', null] },
    { question: 'Q?', options: ['A', 'B'.repeat(201)] },
    { question: 'Q?', options: [' Same ', 'same'] },
  ];
  for (const body of invalidBodies) {
    assertError(await request('/polls', { method: 'POST', body }), 400);
  }
  const missingBody = await request('/polls', { method: 'POST' });
  assertError(missingBody, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM polls').get().count, 0);

  const malformed = await fetch(`${baseUrl}/polls`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid JSON',
  });
  assert.equal(malformed.status, 400);
  assert.equal(typeof (await malformed.json()).error, 'string');
  const tooLarge = await fetch(`${baseUrl}/polls`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'Q'.repeat(20_000), options: ['A', 'B'] }),
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(typeof (await tooLarge.json()).error, 'string');
});

test('unsupported JSON charsets and content encodings return 415 without database writes', async () => {
  const responses = [];
  for (const headers of [
    { 'Content-Type': 'application/json; charset=iso-8859-1' },
    { 'Content-Encoding': 'unsupported' },
  ]) {
    responses.push(await request('/polls', {
      method: 'POST',
      body: { question: 'Which language?', options: ['JavaScript', 'Java'] },
      headers,
    }));
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM polls').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM poll_options').get().count, 0);
  assert.deepEqual(responses.map((response) => response.status), [415, 415]);
  for (const response of responses) assertError(response, 415);
});

test('malformed identifiers and missing polls produce clear 400 and 404 errors', async () => {
  for (const id of ['abc', '0', '-1', '1.5', '9007199254740992']) {
    assertError(await request(`/polls/${id}`), 400);
  }
  for (const code of ['abc123', '12345', '1234567', '12.345', '000000']) {
    assertError(await request(`/polls/room/${code}`), 400);
  }
  assertError(await request('/polls/999999'), 404);
  assertError(await request('/polls/room/999999'), 404);
  assertError(await request('/polls/999999/close', {
    method: 'PATCH', headers: { Authorization: `Bearer ${'a'.repeat(64)}` },
  }), 404);
});

test('only the matching host token can close a poll; repeated closes return 409', async () => {
  const poll = await createPoll();
  const otherPoll = await createPoll({ question: 'Another question?' });
  const closePath = `/polls/${poll.id}/close`;
  for (const headers of [{}, { Authorization: 'Basic credentials' }, { Authorization: 'Bearer' }]) {
    assertError(await request(closePath, { method: 'PATCH', headers }), 401);
  }
  for (const token of ['0'.repeat(64), otherPoll.hostToken]) {
    const response = await request(closePath, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}` },
    });
    assertError(response, 403);
    assertPublicPoll(response.body, poll.hostToken);
  }
  assert.equal((await request(`/polls/${poll.id}`)).body.status, 'open');

  const closed = await request(closePath, {
    method: 'PATCH', headers: { Authorization: `Bearer ${poll.hostToken}` },
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.status, 'closed');
  assertPublicPoll(closed.body, poll.hostToken);
  for (const path of [`/polls/${poll.id}`, `/polls/room/${poll.roomCode}`]) {
    const retrieved = await request(path);
    assert.equal(retrieved.status, 200);
    assert.equal(retrieved.body.status, 'closed');
    assertPublicPoll(retrieved.body, poll.hostToken);
  }
  assertError(await request(closePath, { method: 'PATCH' }), 401);
  assertError(await request(closePath, {
    method: 'PATCH', headers: { Authorization: `Bearer ${poll.hostToken}` },
  }), 409);
  assert.equal((await request(`/polls/${otherPoll.id}`)).body.status, 'open');
});

test('generated room codes are unique across many persisted polls', async () => {
  const codes = new Set();
  for (let index = 0; index < 25; index += 1) {
    const poll = await createPoll({ question: `Question ${index}?` });
    assert.match(poll.roomCode, /^[1-9]\d{5}$/);
    assert.ok(!codes.has(poll.roomCode));
    codes.add(poll.roomCode);
  }
  assert.equal(db.prepare('SELECT COUNT(DISTINCT room_code) AS count FROM polls').get().count, 25);
});

test('open and closed polls, option IDs, room codes, and host authority survive reopening SQLite', async () => {
  const openPoll = await createPoll();
  const closedPoll = await createPoll({ question: 'Already closed?' });
  assert.equal((await request(`/polls/${closedPoll.id}/close`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${closedPoll.hostToken}` },
  })).status, 200);

  await stopServer();
  db.close();
  db = openDatabase(databasePath);
  await startServer();

  const { hostToken, ...expectedOpenPoll } = openPoll;
  const reopened = await request(`/polls/room/${openPoll.roomCode}`);
  assert.equal(reopened.status, 200);
  assert.deepEqual(reopened.body, expectedOpenPoll);
  assertPublicPoll(reopened.body, hostToken);
  assert.equal((await request(`/polls/${closedPoll.id}`)).body.status, 'closed');
  assert.equal((await request(`/polls/${openPoll.id}/close`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${hostToken}` },
  })).body.status, 'closed');
});
