import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createApi, serviceUrls } from '../src/lib/api.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

test('service defaults match the three configured development ports', () => {
  assert.deepEqual(serviceUrls, {
    poll: 'http://localhost:3001', voting: 'http://localhost:3002', results: 'http://localhost:3003',
  });
});

test('API methods send the correct URLs, bodies, and close-only bearer header', async () => {
  const requests = [];
  const api = createApi({
    pollServiceUrl: 'http://poll.example/',
    votingServiceUrl: 'http://voting.example/',
    resultsServiceUrl: 'http://results.example/',
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options });
      return json({ ok: true });
    },
  });
  await api.createPoll('Question?', ['A', 'B']);
  await api.getPoll(7);
  await api.getPollByRoomCode('123456');
  await api.closePoll(7, 'test-host-token');
  await api.submitVote(7, 12, 'test-participant');
  await api.getResults(7);

  assert.deepEqual(requests.map(({ url, method }) => [url, method]), [
    ['http://poll.example/polls', 'POST'],
    ['http://poll.example/polls/7', 'GET'],
    ['http://poll.example/polls/room/123456', 'GET'],
    ['http://poll.example/polls/7/close', 'PATCH'],
    ['http://voting.example/votes', 'POST'],
    ['http://results.example/results/7', 'GET'],
  ]);
  assert.deepEqual(JSON.parse(requests[0].body), { question: 'Question?', options: ['A', 'B'] });
  assert.deepEqual(JSON.parse(requests[4].body), { pollId: 7, optionId: 12, participantId: 'test-participant' });
  for (const [index, request] of requests.entries()) {
    assert.ok(request.signal instanceof AbortSignal);
    assert.equal(request.headers['Content-Type'], [0, 4].includes(index) ? 'application/json' : undefined);
    assert.equal(request.headers.Authorization, index === 3 ? 'Bearer test-host-token' : undefined);
    assert.ok(!request.url.includes('test-host-token'));
  }
  assert.equal(requests[3].body, undefined);
});

test('successful responses preserve creation data, including the one-time token', async () => {
  const poll = { id: 7, roomCode: '123456', hostToken: 'example-token' };
  const api = createApi({ fetchImpl: async () => json(poll, 201) });
  assert.deepEqual(await api.createPoll('Question?', ['A', 'B']), poll);
});

test('HTTP validation and conflict errors preserve the server message and status', async () => {
  for (const [status, message] of [[400, 'Provide between 2 and 4 options.'], [409, 'Poll is closed.']]) {
    const api = createApi({ fetchImpl: async () => json({ error: message }, status) });
    await assert.rejects(api.getPoll(7), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.message, message);
      return true;
    });
  }
});

test('network failures produce a friendly API error without exposing raw failure details', async () => {
  const api = createApi({ fetchImpl: async () => { throw new TypeError('raw internal socket failure'); } });
  await assert.rejects(api.getResults(7), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.match(error.message, /Could not reach the service/);
    assert.ok(!error.message.includes('raw internal'));
    return true;
  });
});

test('timeouts apply while connecting and while receiving the response body', async () => {
  function waitForAbort(signal) {
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  }
  for (const phase of ['connection', 'body']) {
    const api = createApi({
      timeoutMs: 10,
      fetchImpl: async (url, { signal }) => phase === 'connection'
        ? waitForAbort(signal)
        : { ok: true, status: 200, text: () => waitForAbort(signal) },
    });
    await assert.rejects(api.getPoll(7), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 0);
      assert.match(error.message, /timed out/);
      return true;
    });
  }
});

test('invalid JSON and missing server error messages use generic errors', async () => {
  for (const [response, status, expectedMessage] of [
    [new Response('<html>internal detail</html>', { status: 200 }), 200, /invalid response/],
    [new Response('<html>internal detail</html>', { status: 500 }), 500, /Request failed/],
    [json({ error: {} }, 400), 400, /Request failed/],
  ]) {
    const api = createApi({ fetchImpl: async () => response });
    await assert.rejects(api.getPoll(7), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.match(error.message, expectedMessage);
      assert.ok(!error.message.includes('internal detail'));
      return true;
    });
  }
});
