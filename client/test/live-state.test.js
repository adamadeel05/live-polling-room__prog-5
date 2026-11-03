import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergePoll, mergeResults } from '../src/lib/live-state.js';

test('a delayed REST result cannot overwrite a newer live vote total', () => {
  const live = { pollId: 1, status: 'open', totalVotes: 5 };
  assert.equal(mergeResults(live, { pollId: 1, status: 'open', totalVotes: 3 }), live);
  assert.deepEqual(mergeResults(live, { pollId: 1, status: 'open', totalVotes: 6 }), { pollId: 1, status: 'open', totalVotes: 6 });
});

test('late open responses cannot reopen a known closed poll or result', () => {
  const incomingPoll = { id: 1, status: 'open', question: 'Question?' };
  assert.deepEqual(mergePoll({ id: 1, status: 'closed' }, incomingPoll), { ...incomingPoll, status: 'closed' });
  const incomingResults = { pollId: 1, status: 'open', totalVotes: 6 };
  assert.deepEqual(mergeResults({ pollId: 1, status: 'closed', totalVotes: 5 }, incomingResults), { ...incomingResults, status: 'closed' });
  assert.equal(incomingPoll.status, 'open');
  assert.equal(incomingResults.status, 'open');
});

test('switching polls does not carry the previous status or counts into the new room', () => {
  const poll = { id: 2, status: 'open' };
  const results = { pollId: 2, status: 'open', totalVotes: 0 };
  assert.equal(mergePoll({ id: 1, status: 'closed' }, poll), poll);
  assert.equal(mergeResults({ pollId: 1, status: 'closed', totalVotes: 100 }, results), results);
  assert.equal(mergePoll(null, poll), poll);
  assert.equal(mergeResults(null, results), results);
});
