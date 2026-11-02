import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';
import { createApp as createPollApp } from '../../poll-service/src/app.js';
import { openDatabase as openPollDatabase } from '../../poll-service/src/database.js';

let directory;
let db;
let pollDb;
let pollServer;
let votingServer;
let pollUrl;
let votingUrl;
let resultServers;
let notifications;

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

async function startVoting(resultsServiceUrl, resultsNotificationTimeoutMs = 2000) {
  votingServer = createServer(createApp(db, {
    pollServiceUrl: pollUrl,
    resultsServiceUrl,
    resultsNotificationTimeoutMs,
  }));
  votingUrl = await listen(votingServer);
}

async function startResults(handler) {
  let resolveReceived;
  const received = new Promise((resolveRequest) => { resolveReceived = resolveRequest; });
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const notification = {
        method: req.method,
        path: req.url,
        contentType: req.headers['content-type'],
        body,
      };
      notifications.push(notification);
      handler(req, res);
      resolveReceived(notification);
    });
  });
  resultServers.push(server);
  return { server, url: await listen(server), received };
}

async function request(baseUrl, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function createPoll() {
  const response = await request(pollUrl, '/polls', {
    method: 'POST', body: { question: 'Which language?', options: ['JavaScript', 'Java'] },
  });
  assert.equal(response.status, 201);
  return response.body;
}

function castVote(poll, participantId, optionId = poll.options[0].id) {
  return request(votingUrl, '/votes', {
    method: 'POST', body: { pollId: poll.id, optionId, participantId },
  });
}

async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Expected notification result before timeout.');
    await delay(10);
  }
}

function assertStoredVote(receipt, poll) {
  assert.equal(receipt.status, 201);
  assert.deepEqual(receipt.body, { id: receipt.body.id, pollId: poll.id, optionId: poll.options[0].id });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM votes').get().count, 1);
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'voting-notification-test-'));
  db = openDatabase(join(directory, 'votes.db'));
  pollDb = openPollDatabase(join(directory, 'polls.db'));
  notifications = [];
  resultServers = [];
  pollServer = createServer(createPollApp(pollDb));
  pollUrl = await listen(pollServer);
});

afterEach(async () => {
  await close(votingServer);
  for (const server of resultServers || []) await close(server);
  await close(pollServer);
  if (db?.open) db.close();
  if (pollDb?.open) pollDb.close();
  if (directory) {
    const absoluteDirectory = resolve(directory);
    assert.equal(dirname(absoluteDirectory), resolve(tmpdir()));
    assert.ok(basename(absoluteDirectory).startsWith('voting-notification-test-'));
    await rm(absoluteDirectory, { recursive: true, force: true });
  }
});

test('an accepted vote notifies Results with only its poll ID', async () => {
  const results = await startResults((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"received":true}');
  });
  await startVoting(`${results.url}/`);
  const poll = await createPoll();
  assertStoredVote(await castVote(poll, 'private-participant'), poll);
  const notification = await results.received;
  assert.equal(notification.method, 'POST');
  assert.equal(notification.path, '/internal/votes');
  assert.match(notification.contentType, /application\/json/);
  assert.deepEqual(JSON.parse(notification.body), { pollId: poll.id });
  assert.equal(notifications.length, 1);
});

test('a Results HTTP error leaves the vote accepted and duplicate protection intact', async (t) => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const results = await startResults((req, res) => {
    res.writeHead(500);
    res.end('Results failed');
  });
  await startVoting(results.url);
  const poll = await createPoll();
  assertStoredVote(await castVote(poll, 'http-error-participant'), poll);
  await waitFor(() => warnings.mock.callCount() === 1);
  assert.match(warnings.mock.calls[0].arguments[0], /Vote saved; Results Service notification failed/);
  assert.equal((await castVote(poll, 'http-error-participant')).status, 409);
  assert.equal(notifications.length, 1);
});

test('an offline Results Service cannot reject or remove an accepted vote', async (t) => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const results = await startResults((req, res) => res.end('{}'));
  await close(results.server);
  await startVoting(results.url);
  const poll = await createPoll();
  assertStoredVote(await castVote(poll, 'offline-participant'), poll);
  await waitFor(() => warnings.mock.callCount() === 1);
  assert.equal((await castVote(poll, 'offline-participant')).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM votes').get().count, 1);
});

test('a Results response-body timeout leaves the vote accepted and persisted', async (t) => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const results = await startResults((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('body has not finished');
  });
  await startVoting(results.url, 50);
  const poll = await createPoll();
  assertStoredVote(await castVote(poll, 'timeout-participant'), poll);
  await waitFor(() => warnings.mock.callCount() === 1);
  assert.equal((await castVote(poll, 'timeout-participant')).status, 409);
  assert.equal(notifications.length, 1);
});

test('the vote response is delivered before a slow notification completes', async () => {
  let finishNotification;
  let notificationFinished = false;
  const results = await startResults((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('waiting');
    finishNotification = () => {
      notificationFinished = true;
      res.end('done');
    };
  });
  await startVoting(results.url, 5000);
  const poll = await createPoll();
  const pendingVote = castVote(poll, 'slow-results-participant');
  await results.received;
  try {
    const receipt = await Promise.race([pendingVote, delay(1000).then(() => null)]);
    assert.notEqual(receipt, null, 'Vote receipt must not wait for the notification.');
    assertStoredVote(receipt, poll);
    assert.equal(notificationFinished, false);
  } finally {
    finishNotification();
    await pendingVote;
  }
});

test('invalid, duplicate, missing-poll, and closed-poll votes do not notify Results', async () => {
  const results = await startResults((req, res) => res.end('{}'));
  await startVoting(results.url);
  const poll = await createPoll();
  assertStoredVote(await castVote(poll, 'first-participant'), poll);
  await results.received;
  assert.equal((await castVote(poll, 'first-participant')).status, 409);
  assert.equal((await castVote(poll, '')).status, 400);
  assert.equal((await castVote(poll, 'wrong-option', 999999)).status, 400);
  assert.equal((await castVote({ ...poll, id: 999999 }, 'missing-poll')).status, 404);
  const closed = await request(pollUrl, `/polls/${poll.id}/close`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${poll.hostToken}` },
  });
  assert.equal(closed.status, 200);
  assert.equal((await castVote(poll, 'closed-poll-participant')).status, 409);
  assert.equal(notifications.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM votes').get().count, 1);
});
