import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createResultsService } from '../src/app.js';
import { calculateResults, createResultsReader } from '../src/results.js';
import { createApp as createPollApp } from '../../poll-service/src/app.js';
import { openDatabase as openPollDatabase } from '../../poll-service/src/database.js';
import { createApp as createVotingApp } from '../../voting-service/src/app.js';
import { openDatabase as openVotingDatabase } from '../../voting-service/src/database.js';

const { io: createSocket } = createRequire(new URL('../../../client/package.json', import.meta.url))('socket.io-client');
let directory;
let pollDb;
let votingDb;
let pollServer;
let votingServer;
let pollUrl;
let votingUrl;
let results;
let resultServices;
let stubServers;
let sockets;

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolveValue, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for the upstream request.')), 5000);
    resolvePromise = () => { clearTimeout(timer); resolveValue(); };
  });
  return { promise, resolve: resolvePromise };
}

async function listen(server) {
  await new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListening);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolveClosed, reject) => {
    server.close((error) => error ? reject(error) : resolveClosed());
    server.closeAllConnections();
  });
}

async function startResults(overrides = {}) {
  const service = createResultsService({
    port: 3003, clientOrigin: 'http://localhost:5173',
    pollServiceUrl: pollUrl, votingServiceUrl: votingUrl,
    requestTimeoutMs: 1000, ...overrides,
  });
  resultServices.push(service);
  service.url = await listen(service.server);
  return service;
}

async function stopResults(service) {
  if (service?.server.listening) {
    await new Promise((resolveClosed) => service.io.close(resolveClosed));
  }
}

async function startStub(handler) {
  const server = createServer(handler);
  stubServers.push(server);
  return { server, url: await listen(server) };
}

beforeEach(async () => {
  resultServices = [];
  stubServers = [];
  sockets = [];
  directory = await mkdtemp(join(tmpdir(), 'results-service-test-'));
  pollDb = openPollDatabase(join(directory, 'polls.db'));
  votingDb = openVotingDatabase(join(directory, 'votes.db'));
  pollServer = createServer(createPollApp(pollDb));
  pollUrl = await listen(pollServer);
  // Reserve the Voting URL before wiring its notification URL back to Results.
  votingServer = createServer();
  votingUrl = await listen(votingServer);
  results = await startResults();
  votingServer.on('request', createVotingApp(votingDb, {
    pollServiceUrl: pollUrl, resultsServiceUrl: results.url,
    resultsNotificationTimeoutMs: 2000,
  }));
});

afterEach(async () => {
  for (const socket of sockets || []) socket.disconnect();
  for (const service of resultServices || []) await stopResults(service);
  await closeServer(votingServer);
  await closeServer(pollServer);
  for (const stub of stubServers || []) await closeServer(stub);
  if (votingDb?.open) votingDb.close();
  if (pollDb?.open) pollDb.close();
  if (directory) {
    const absoluteDirectory = resolve(directory);
    assert.equal(dirname(absoluteDirectory), resolve(tmpdir()));
    assert.ok(basename(absoluteDirectory).startsWith('results-service-test-'));
    await rm(absoluteDirectory, { recursive: true, force: true });
  }
});

async function request(baseUrl, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, signal: AbortSignal.timeout(6000),
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function createPoll(options = ['JavaScript', 'Java', 'Python']) {
  const response = await request(pollUrl, '/polls', {
    method: 'POST', body: { question: 'Which language?', options },
  });
  assert.equal(response.status, 201);
  return response.body;
}

function castVote(poll, participantId, optionIndex = 0) {
  return request(votingUrl, '/votes', {
    method: 'POST',
    body: { pollId: poll.id, optionId: poll.options[optionIndex].id, participantId },
  });
}

function assertError(response, status) {
  assert.equal(response.status, status);
  assert.equal(typeof response.body.error, 'string');
  assert.ok(response.body.error.length > 0);
}

function waitFor(socket, event, predicate = () => true) {
  return new Promise((resolveEvent, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}.`));
    }, 5000);
    function onEvent(value) {
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolveEvent(value);
    }
    socket.on(event, onEvent);
  });
}

function makeSocket(auth = {}, url = results.url) {
  const socket = createSocket(url, {
    autoConnect: false, transports: ['websocket'], reconnection: false, auth,
  });
  sockets.push(socket);
  return socket;
}

async function connect(socket) {
  const connected = waitFor(socket, 'connect');
  socket.connect();
  await connected;
}

async function joinPoll(socket, pollId) {
  const snapshot = waitFor(socket, 'results-update', (value) => value.pollId === pollId);
  const acknowledgment = await socket.timeout(5000).emitWithAck('join-poll', { pollId });
  assert.deepEqual(acknowledgment, { ok: true, pollId });
  return snapshot;
}

async function connectToPoll(pollId, url = results.url) {
  const socket = makeSocket({ pollId }, url);
  const snapshot = waitFor(socket, 'results-update', (value) => value.pollId === pollId);
  await connect(socket);
  return { socket, snapshot: await snapshot };
}

test('REST and the results reader calculate ordered zero counts and rounded percentages, including closed polls', async () => {
  const poll = await createPoll();
  const zero = await request(results.url, `/results/${poll.id}`);
  assert.equal(zero.status, 200);
  assert.deepEqual(zero.body, {
    pollId: poll.id, question: poll.question, roomCode: poll.roomCode, status: 'open', totalVotes: 0,
    results: poll.options.map((option) => ({ optionId: option.id, text: option.text, count: 0, percentage: 0 })),
  });
  for (const [participant, index] of [['a', 0], ['b', 1], ['c', 1]]) {
    assert.equal((await castVote(poll, participant, index)).status, 201);
  }
  const counts = (await request(votingUrl, `/votes/${poll.id}/counts`)).body;
  const expected = calculateResults(poll, counts);
  assert.deepEqual(calculateResults(poll, { ...counts, counts: [...counts.counts].reverse() }), expected);
  assert.deepEqual(expected.results.map((option) => option.percentage), [33.33, 66.67, 0]);
  assert.deepEqual(expected.results.map((option) => option.count), [1, 2, 0]);
  assert.equal(expected.totalVotes, 3);
  assert.deepEqual((await request(results.url, `/results/${poll.id}`)).body, expected);
  const reader = createResultsReader({ pollServiceUrl: pollUrl, votingServiceUrl: votingUrl, requestTimeoutMs: 1000 });
  assert.deepEqual(await reader(poll.id), expected);
  assert.equal((await request(pollUrl, `/polls/${poll.id}/close`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${poll.hostToken}` },
  })).status, 200);
  const closed = await request(results.url, `/results/${poll.id}`);
  assert.equal(closed.status, 200);
  assert.deepEqual(closed.body, { ...expected, status: 'closed' });
  assert.ok(!JSON.stringify(closed.body).includes(poll.hostToken));
});

test('health, CORS, invalid IDs, missing polls, and JSON request errors are handled', async () => {
  const health = await request(results.url, '/health', { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: 'ok', service: 'results-service', port: 3003 });
  assert.equal(health.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  for (const id of ['abc', '0', '-1', '1.5', '9007199254740992']) {
    assertError(await request(results.url, `/results/${id}`), 400);
  }
  assertError(await request(results.url, '/results/999999'), 404);
  assertError(await request(results.url, '/unknown-route'), 404);
  for (const body of [{}, null, [], { pollId: '1' }, { pollId: 0 }, { pollId: -1 }, { pollId: 1.5 }]) {
    assertError(await request(results.url, '/internal/votes', { method: 'POST', body }), 400);
  }
  assertError(await request(results.url, '/internal/votes', { method: 'POST', body: { pollId: 999999 } }), 404);
  for (const [body, status] of [['{invalid JSON', 400], [JSON.stringify({ pollId: 1, extra: 'A'.repeat(20_000) }), 413]]) {
    const response = await fetch(`${results.url}/internal/votes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('a real successful POST /votes automatically broadcasts a fresh snapshot', async () => {
  const poll = await createPoll();
  const { socket, snapshot } = await connectToPoll(poll.id);
  assert.equal(snapshot.totalVotes, 0);
  const update = waitFor(socket, 'results-update', (value) => value.totalVotes === 1);
  assert.equal((await castVote(poll, 'live-participant', 2)).status, 201);
  const received = await update;
  assert.equal(received.results[2].count, 1);
  assert.equal(received.results[2].percentage, 100);
  assert.deepEqual(received, (await request(results.url, `/results/${poll.id}`)).body);
  assertError(await castVote(poll, 'live-participant'), 409);
  const refresh = waitFor(socket, 'results-update', (value) => value.totalVotes === 1);
  const notification = await request(results.url, '/internal/votes', {
    method: 'POST', body: { pollId: poll.id },
  });
  assert.equal(notification.status, 200);
  assert.deepEqual(notification.body, { ok: true, pollId: poll.id });
  assert.deepEqual(await refresh, received);
});

test('explicit joins work with or without acknowledgments and malformed joins return safe errors', async () => {
  const poll = await createPoll();
  const socket = makeSocket();
  await connect(socket);
  assert.equal((await joinPoll(socket, poll.id)).totalVotes, 0);
  const optionalAckSnapshot = waitFor(socket, 'results-update');
  socket.emit('join-poll', { pollId: poll.id });
  assert.equal((await optionalAckSnapshot).pollId, poll.id);
  for (const payload of [null, {}, { pollId: '1' }, { pollId: 0 }, { pollId: 1.5 }]) {
    const event = waitFor(socket, 'results-error');
    const acknowledgment = await socket.timeout(5000).emitWithAck('join-poll', payload);
    assert.equal(acknowledgment.ok, false);
    assert.equal(acknowledgment.status, 400);
    assert.equal(typeof acknowledgment.error, 'string');
    assert.equal((await event).status, 400);
  }
  const missing = waitFor(socket, 'results-error', (value) => value.status === 404);
  const acknowledgment = await socket.timeout(5000).emitWithAck('join-poll', { pollId: 999999 });
  assert.equal(acknowledgment.ok, false);
  assert.equal(acknowledgment.status, 404);
  assert.equal((await missing).pollId, 999999);
});

test('new clients and reconnected clients automatically receive the latest snapshot using preserved auth', async () => {
  const poll = await createPoll();
  const first = await connectToPoll(poll.id);
  assert.equal(first.snapshot.totalVotes, 0);
  first.socket.disconnect();
  assert.equal((await castVote(poll, 'while-disconnected-a', 0)).status, 201);
  assert.equal((await castVote(poll, 'while-disconnected-b', 1)).status, 201);
  const rejoined = waitFor(first.socket, 'results-update', (value) => value.totalVotes === 2);
  await connect(first.socket);
  assert.equal((await rejoined).totalVotes, 2);
  assert.deepEqual(first.socket.auth, { pollId: poll.id });
  const newest = await connectToPoll(poll.id);
  assert.equal(newest.snapshot.totalVotes, 2);
  assert.deepEqual(newest.snapshot, await joinPoll(first.socket, poll.id));
});

test('poll rooms are isolated, switching leaves the old room, and a failed join leaves no poll room', async () => {
  const pollA = await createPoll();
  const pollB = await createPoll();
  const viewerA = await connectToPoll(pollA.id);
  const viewerB = await connectToPoll(pollB.id);
  const receivedByB = [];
  viewerB.socket.on('results-update', (value) => receivedByB.push(value));
  const updateA = waitFor(viewerA.socket, 'results-update', (value) => value.totalVotes === 1);
  assert.equal((await castVote(pollA, 'poll-a-voter')).status, 201);
  await updateA;
  await joinPoll(viewerB.socket, pollB.id);
  assert.ok(receivedByB.every((value) => value.pollId === pollB.id));

  await joinPoll(viewerA.socket, pollB.id);
  assert.equal(results.io.sockets.sockets.get(viewerA.socket.id).rooms.has(`poll:${pollA.id}`), false);
  const updateForA = waitFor(viewerA.socket, 'results-update', (value) => value.pollId === pollB.id && value.totalVotes === 1);
  const updateForB = waitFor(viewerB.socket, 'results-update', (value) => value.totalVotes === 1);
  assert.equal((await castVote(pollB, 'poll-b-voter')).status, 201);
  await Promise.all([updateForA, updateForB]);

  const failed = await viewerA.socket.timeout(5000).emitWithAck('join-poll', { pollId: 999999 });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 404);
  assert.equal(results.io.sockets.sockets.get(viewerA.socket.id).rooms.size, 1);
});

test('disconnecting during an upstream lookup is safe and does not affect subsequent subscribers', async () => {
  const poll = await createPoll();
  const requested = deferred();
  let release = false;
  let pendingResponse;
  const source = await startStub((req, res) => {
    if (!release) {
      pendingResponse = res;
      requested.resolve();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(poll));
  });
  const service = await startResults({ pollServiceUrl: source.url });
  const socket = makeSocket({ pollId: poll.id }, service.url);
  await connect(socket);
  await requested.promise;
  const disconnectedId = socket.id;
  const disconnected = waitFor(service.io.sockets.sockets.get(disconnectedId), 'disconnect');
  socket.disconnect();
  await disconnected;
  release = true;
  pendingResponse.writeHead(200, { 'Content-Type': 'application/json' });
  pendingResponse.end(JSON.stringify(poll));
  const next = await connectToPoll(poll.id, service.url);
  assert.equal(next.snapshot.totalVotes, 0);
  assert.equal(service.io.sockets.sockets.has(disconnectedId), false);
  assert.equal((await request(service.url, '/health')).status, 200);
});

test('concurrent valid votes emit nondecreasing totals and finish with the current result', async () => {
  const poll = await createPoll();
  const { socket } = await connectToPoll(poll.id);
  const totals = [];
  socket.on('results-update', (value) => totals.push(value.totalVotes));
  const complete = waitFor(socket, 'results-update', (value) => value.totalVotes === 8);
  const votes = await Promise.all(Array.from({ length: 8 }, (_, index) => castVote(poll, `parallel-${index}`, index % 3)));
  assert.ok(votes.every((response) => response.status === 201));
  const finalSnapshot = await complete;
  assert.ok(totals.length > 0);
  assert.ok(totals.every((total, index) => index === 0 || total >= totals[index - 1]));
  assert.deepEqual(finalSnapshot, (await request(results.url, `/results/${poll.id}`)).body);
  assert.deepEqual(finalSnapshot.results.map((option) => option.count), [3, 3, 2]);
});

test('HTTP failures from either upstream service are mapped to clear errors', async () => {
  const poll = await createPoll();
  for (const source of ['pollServiceUrl', 'votingServiceUrl']) {
    for (const [upstreamStatus, expectedStatus] of [[404, 404], [503, 503], [500, 502]]) {
      const stub = await startStub((req, res) => {
        res.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream failure' }));
      });
      const service = await startResults({ [source]: stub.url });
      assertError(await request(service.url, `/results/${poll.id}`), expectedStatus);
      await stopResults(service);
    }
  }
});

test('an upstream refresh failure emits a room error and the next notification can recover', async () => {
  const poll = await createPoll();
  let unavailable = false;
  const source = await startStub((req, res) => {
    res.writeHead(unavailable ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(unavailable ? { error: 'Unavailable' } : poll));
  });
  const service = await startResults({ pollServiceUrl: source.url });
  const { socket } = await connectToPoll(poll.id, service.url);
  unavailable = true;
  const error = waitFor(socket, 'results-error', (value) => value.status === 503);
  assertError(await request(service.url, '/internal/votes', {
    method: 'POST', body: { pollId: poll.id },
  }), 503);
  assert.equal((await error).pollId, poll.id);
  unavailable = false;
  const recovered = waitFor(socket, 'results-update');
  assert.equal((await request(service.url, '/internal/votes', {
    method: 'POST', body: { pollId: poll.id },
  })).status, 200);
  assert.equal((await recovered).totalVotes, 0);
});

test('invalid JSON, malformed metadata, and inconsistent counts are rejected with 502', async () => {
  const poll = await createPoll();
  const counts = {
    pollId: poll.id, totalVotes: 0,
    counts: poll.options.map((option) => ({ optionId: option.id, text: option.text, count: 0 })),
  };
  const scenarios = [
    ['pollServiceUrl', '{invalid JSON'],
    ['votingServiceUrl', '{invalid JSON'],
    ['pollServiceUrl', JSON.stringify({ ...poll, question: 42 })],
    ['pollServiceUrl', JSON.stringify({ ...poll, roomCode: 'invalid' })],
    ['pollServiceUrl', JSON.stringify({ ...poll, id: poll.id + 1 })],
    ['votingServiceUrl', JSON.stringify({ ...counts, totalVotes: 1 })],
    ['votingServiceUrl', JSON.stringify({ ...counts, counts: counts.counts.slice(1) })],
    ['votingServiceUrl', JSON.stringify({ ...counts, counts: counts.counts.map((row) => ({ ...row, optionId: 999999 })) })],
    ['votingServiceUrl', JSON.stringify({ ...counts, counts: counts.counts.map((row) => ({ ...row, count: -1 })) })],
    ['votingServiceUrl', JSON.stringify({ ...counts, totalVotes: 1.5 })],
  ];
  for (const [source, body] of scenarios) {
    const stub = await startStub((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    });
    const service = await startResults({ [source]: stub.url });
    assertError(await request(service.url, `/results/${poll.id}`), 502);
    await stopResults(service);
  }
});

test('offline upstreams and responses that stall after their headers return 503', async () => {
  const poll = await createPoll();
  for (const source of ['pollServiceUrl', 'votingServiceUrl']) {
    const offline = await startStub((req, res) => res.end('{}'));
    const unavailableService = await startResults({ [source]: offline.url });
    await closeServer(offline.server);
    assertError(await request(unavailableService.url, `/results/${poll.id}`), 503);
    await stopResults(unavailableService);

    const slowBody = await startStub((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.flushHeaders();
      res.write('{');
    });
    const slowService = await startResults({ [source]: slowBody.url, requestTimeoutMs: 50 });
    assertError(await request(slowService.url, `/results/${poll.id}`), 503);
    await stopResults(slowService);
  }
});
