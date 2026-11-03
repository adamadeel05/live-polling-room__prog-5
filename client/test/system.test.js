import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { io } from 'socket.io-client';
import { startTestSystem } from '../scripts/test-system.js';
import { createApi } from '../src/lib/api.js';
import { createBrowserStorage } from '../src/lib/storage.js';

let system;
let api;
const sockets = new Set();

before(async () => {
  system = await startTestSystem();
  api = createApi({
    pollServiceUrl: system.pollUrl, votingServiceUrl: system.votingUrl,
    resultsServiceUrl: system.resultsUrl, timeoutMs: 5000,
  });
}, { timeout: 25000 });

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await system?.close();
}, { timeout: 15000 });

function mapStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function participant(label) {
  return createBrowserStorage({
    localStorage: mapStorage(), sessionStorage: mapStorage(),
    generateId: () => `${label}-${randomUUID()}`,
  });
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 12000) {
  return new Promise((resolveEvent, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timed out waiting for ${event}.`));
    }, timeoutMs);
    function listener(value) {
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolveEvent(value);
    }
    socket.on(event, listener);
  });
}

async function watchPoll(pollId) {
  const socket = io(system.resultsUrl, {
    autoConnect: false, reconnection: true, reconnectionDelay: 100,
    reconnectionDelayMax: 300, randomizationFactor: 0, timeout: 1500,
  });
  sockets.add(socket);
  let joins = 0;
  socket.on('connect', () => {
    joins += 1;
    // Match the frontend lifecycle: subscribe again after every connection.
    socket.emit('join-poll', { pollId });
  });
  const snapshot = waitFor(socket, 'results-update', (value) => value.pollId === pollId);
  socket.connect();
  return { socket, snapshot: await snapshot, joins: () => joins };
}

async function voteAndReceive(watcher, poll, storage, optionIndex, totalVotes) {
  const optionId = poll.options[optionIndex].id;
  const [snapshot, receipt] = await Promise.all([
    waitFor(watcher.socket, 'results-update', (value) => value.pollId === poll.id && value.totalVotes === totalVotes),
    api.submitVote(poll.id, optionId, storage.getParticipantId()),
  ]);
  assert.equal(receipt.pollId, poll.id);
  assert.equal(receipt.optionId, optionId);
  storage.saveVote(poll.id, optionId);
  assert.deepEqual(storage.getVote(poll.id), { optionId });
  return snapshot;
}

test('four real processes serve health, CORS, the React client, and isolated frontend API URLs', async () => {
  for (const [name, url] of [['poll', system.pollUrl], ['voting', system.votingUrl], ['results', system.resultsUrl]]) {
    const response = await fetch(`${url}/health`, { headers: { Origin: system.clientUrl } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), system.clientUrl);
    assert.deepEqual(await response.json(), { status: 'ok', service: `${name}-service`, port: Number(new URL(url).port) });
  }
  const page = await fetch(system.clientUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Live Polling Room \(Slido Lite\)<\/title>/);
  const module = await fetch(`${system.clientUrl}/src/lib/api.js`);
  assert.equal(module.status, 200);
  const source = await module.text();
  for (const url of [system.pollUrl, system.votingUrl, system.resultsUrl]) assert.ok(source.includes(url));
});

test('host creation, anonymous code join, live votes, duplicates, and authorized closure work together', async () => {
  const hostStorage = participant('host');
  const poll = await api.createPoll('Which topic should we study?', ['React', 'Node.js', 'SQLite']);
  assert.match(poll.roomCode, /^[1-9]\d{5}$/);
  assert.ok(/^[a-f0-9]{64}$/.test(poll.hostToken), 'Creation provides a host token.');
  hostStorage.saveHostSession(poll);
  const publicPoll = await api.getPollByRoomCode(poll.roomCode);
  assert.equal(publicPoll.id, poll.id);
  assert.equal(publicPoll.hostToken, undefined);
  assert.equal(publicPoll.hostTokenHash, undefined);
  assert.equal(publicPoll.host_token_hash, undefined);
  assert.ok(!JSON.stringify(publicPoll).includes(poll.hostToken));
  const missingRoom = poll.roomCode === '100000' ? '100001' : '100000';
  await assert.rejects(api.getPollByRoomCode(missingRoom), (error) => error.status === 404);
  const watcher = await watchPoll(poll.id);
  try {
    assert.equal(watcher.snapshot.totalVotes, 0);
    const a = participant('participant-a');
    const b = participant('participant-b');
    const c = participant('participant-c');
    assert.equal(new Set([a.getParticipantId(), b.getParticipantId(), c.getParticipantId()]).size, 3);
    await voteAndReceive(watcher, poll, a, 0, 1);
    await voteAndReceive(watcher, poll, b, 1, 2);
    const final = await voteAndReceive(watcher, poll, c, 1, 3);
    assert.deepEqual(final.results.map((option) => option.count), [1, 2, 0]);
    assert.deepEqual(final.results.map((option) => option.percentage), [33.33, 66.67, 0]);
    await assert.rejects(api.submitVote(poll.id, poll.options[1].id, a.getParticipantId()), (error) => error.status === 409);
    assert.equal((await api.getResults(poll.id)).totalVotes, 3);
    await assert.rejects(api.closePoll(poll.id, ''), (error) => error.status === 401);
    const incorrectToken = poll.hostToken === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
    await assert.rejects(api.closePoll(poll.id, incorrectToken), (error) => error.status === 403);
    const savedHost = hostStorage.getHostSession(poll.id);
    assert.ok(savedHost.hostToken === poll.hostToken, 'Host access remains in its session store.');
    assert.equal((await api.closePoll(poll.id, savedHost.hostToken)).status, 'closed');
    await assert.rejects(api.submitVote(poll.id, poll.options[2].id, participant('late').getParticipantId()), (error) => error.status === 409);
    assert.equal((await api.getResults(poll.id)).totalVotes, 3);
  } finally {
    watcher.socket.disconnect();
  }
});

test('a Results process outage preserves votes and Socket.IO automatically reconnects and rejoins', { timeout: 35000 }, async () => {
  const poll = await api.createPoll('Can the host reconnect?', ['Yes', 'Not yet']);
  const watcher = await watchPoll(poll.id);
  try {
    await Promise.all([waitFor(watcher.socket, 'disconnect'), system.stopService('results')]);
    assert.equal(watcher.socket.connected, false);
    const offlineVoter = participant('offline-voter');
    const accepted = await api.submitVote(poll.id, poll.options[0].id, offlineVoter.getParticipantId());
    assert.equal(accepted.pollId, poll.id);
    const [latest] = await Promise.all([
      waitFor(watcher.socket, 'results-update', (value) => value.pollId === poll.id && value.totalVotes === 1, 20000),
      system.startService('results'),
    ]);
    assert.equal(latest.results[0].count, 1);
    assert.ok(watcher.joins() >= 2, 'The existing client joined again on an automatic reconnect.');
    const liveAgain = await voteAndReceive(watcher, poll, participant('after-reconnect'), 1, 2);
    assert.deepEqual(liveAgain.results.map((option) => option.count), [1, 1]);
  } finally {
    watcher.socket.disconnect();
    await system.startService('results');
  }
});

test('actual Poll and Voting process restarts retain both poll states, option IDs, counts, and host authority', { timeout: 35000 }, async () => {
  const openPoll = await api.createPoll('An open poll survives restart?', ['First', 'Second', 'Third']);
  const closedPoll = await api.createPoll('A closed poll survives restart?', ['Yes', 'No']);
  const hostStorage = participant('persisted-host');
  hostStorage.saveHostSession(openPoll);
  const openVoter = participant('persisted-open-voter');
  await api.submitVote(openPoll.id, openPoll.options[1].id, openVoter.getParticipantId());
  await api.submitVote(closedPoll.id, closedPoll.options[0].id, participant('persisted-closed-voter').getParticipantId());
  await api.closePoll(closedPoll.id, closedPoll.hostToken);
  const beforeOpen = await api.getPoll(openPoll.id);
  const beforeClosed = await api.getPollByRoomCode(closedPoll.roomCode);

  await Promise.all([system.restartService('poll'), system.restartService('voting')]);

  assert.deepEqual(await api.getPollByRoomCode(openPoll.roomCode), beforeOpen);
  assert.deepEqual(await api.getPoll(closedPoll.id), beforeClosed);
  const openResults = await api.getResults(openPoll.id);
  const closedResults = await api.getResults(closedPoll.id);
  assert.equal(openResults.status, 'open');
  assert.equal(openResults.totalVotes, 1);
  assert.deepEqual(openResults.results.map((option) => option.count), [0, 1, 0]);
  assert.equal(closedResults.status, 'closed');
  assert.equal(closedResults.totalVotes, 1);
  assert.deepEqual(closedResults.results.map((option) => option.count), [1, 0]);
  await assert.rejects(api.submitVote(openPoll.id, openPoll.options[0].id, openVoter.getParticipantId()), (error) => error.status === 409);
  await assert.rejects(api.submitVote(closedPoll.id, closedPoll.options[1].id, participant('closed-after-restart').getParticipantId()), (error) => error.status === 409);
  const savedHost = hostStorage.getHostSession(openPoll.id);
  assert.equal((await api.closePoll(openPoll.id, savedHost.hostToken)).status, 'closed');
  assert.equal((await api.getPoll(openPoll.id)).status, 'closed');
});
