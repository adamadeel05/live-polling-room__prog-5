import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrowserStorage } from '../src/lib/storage.js';

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
  };
}

function setup(generateId = () => 'test-participant-id') {
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  return {
    localStorage,
    sessionStorage,
    storage: createBrowserStorage({ localStorage, sessionStorage, generateId }),
  };
}

const poll = {
  id: 7,
  question: 'Question?',
  roomCode: '123456',
  status: 'open',
  options: [{ id: 11, text: 'A' }, { id: 12, text: 'B' }],
  hostToken: 'a'.repeat(64),
};

test('one participant ID persists and is reused across reloads', () => {
  let generations = 0;
  const { storage, localStorage, sessionStorage } = setup(() => {
    generations += 1;
    return 'test-persistent-participant';
  });
  assert.equal(storage.getParticipantId(), 'test-persistent-participant');
  assert.equal(storage.getParticipantId(), 'test-persistent-participant');
  const reloaded = createBrowserStorage({ localStorage, sessionStorage, generateId: () => 'must-not-be-used' });
  assert.equal(reloaded.getParticipantId(), 'test-persistent-participant');
  assert.equal(generations, 1);
  assert.equal(localStorage.getItem('lpr.participantId'), 'test-persistent-participant');
});

test('existing participant IDs are trimmed, and corrupt IDs are replaced before use', () => {
  const { storage, localStorage } = setup();
  localStorage.setItem('lpr.participantId', '  existing-participant  ');
  assert.equal(storage.getParticipantId(), 'existing-participant');
  for (const invalid of ['', '   ', 'x'.repeat(101), '\0participant']) {
    localStorage.setItem('lpr.participantId', invalid);
    assert.equal(storage.getParticipantId(), 'test-participant-id');
    assert.equal(localStorage.getItem('lpr.participantId'), 'test-participant-id');
  }
});

test('vote receipts persist per poll and can represent an unknown prior choice', () => {
  const { storage, localStorage, sessionStorage } = setup();
  assert.equal(storage.getVote(7), null);
  storage.saveVote(7, 11);
  storage.saveVote(8);
  const reloaded = createBrowserStorage({ localStorage, sessionStorage });
  assert.deepEqual(reloaded.getVote(7), { optionId: 11 });
  assert.deepEqual(reloaded.getVote(8), { optionId: null });
  assert.equal(reloaded.getVote(9), null);
  assert.equal(sessionStorage.values.size, 0);
});

test('host sessions retain the full poll only in session storage', () => {
  const { storage, localStorage, sessionStorage } = setup();
  storage.getParticipantId();
  storage.saveVote(7, 11);
  storage.saveHostSession(poll);
  assert.deepEqual(storage.getHostSession(7), poll);
  assert.deepEqual(JSON.parse(sessionStorage.getItem('lpr.host.7')), poll);
  assert.equal(localStorage.getItem('lpr.host.7'), null);
  assert.ok(!JSON.stringify([...localStorage.values]).includes(poll.hostToken));

  const reloaded = createBrowserStorage({ localStorage, sessionStorage });
  assert.deepEqual(reloaded.getHostSession(7), poll);
  const newSession = createBrowserStorage({ localStorage, sessionStorage: memoryStorage() });
  assert.equal(newSession.getHostSession(7), null);
  storage.removeHostSession(7);
  assert.equal(storage.getHostSession(7), null);
});

test('corrupt JSON, invalid receipt shapes, and mismatched host sessions return null', () => {
  const { storage, localStorage, sessionStorage } = setup();
  for (const invalid of ['not JSON', 'null', '[]', '{}', '{"optionId":"11"}', '{"optionId":0}']) {
    localStorage.setItem('lpr.vote.7', invalid);
    assert.equal(storage.getVote(7), null);
  }
  for (const invalid of [
    'not JSON', 'null', '[]', '{}',
    JSON.stringify({ ...poll, id: 8 }),
    JSON.stringify({ ...poll, id: '7' }),
    JSON.stringify({ ...poll, hostToken: 'not-a-host-token' }),
    JSON.stringify({ ...poll, hostToken: 'z'.repeat(64) }),
  ]) {
    sessionStorage.setItem('lpr.host.7', invalid);
    assert.equal(storage.getHostSession(7), null);
  }
  for (const id of [0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(storage.getVote(id), null);
    assert.equal(storage.getHostSession(id), null);
  }
});

test('invalid values are not saved to either storage area', () => {
  const { storage, localStorage, sessionStorage } = setup();
  assert.equal(storage.saveVote('7', 11), null);
  assert.equal(storage.saveVote(7, '11'), null);
  assert.equal(storage.saveHostSession({ ...poll, hostToken: '' }), null);
  assert.equal(storage.saveHostSession({ ...poll, id: 0 }), null);
  assert.equal(storage.saveHostSession(null), null);
  assert.equal(localStorage.values.size, 0);
  assert.equal(sessionStorage.values.size, 0);
});

test('blocked reads and writes throw a friendly error instead of changing identity silently', () => {
  const blockedRead = { getItem() { throw new Error('raw browser security failure'); } };
  assert.doesNotThrow(() => createBrowserStorage({ localStorage: blockedRead }));
  const reader = createBrowserStorage({ localStorage: blockedRead });
  assert.throws(() => reader.getParticipantId(), /Browser storage is unavailable/);
  assert.throws(() => reader.getVote(7), /Browser storage is unavailable/);

  const blockedWrite = {
    getItem: () => null,
    setItem() { throw new Error('raw browser quota failure'); },
  };
  const writer = createBrowserStorage({
    localStorage: blockedWrite,
    sessionStorage: blockedWrite,
    generateId: () => 'must-be-persisted-before-returning',
  });
  assert.throws(() => writer.getParticipantId(), /Browser storage is unavailable/);
  assert.throws(() => writer.saveVote(7, 11), /Browser storage is unavailable/);
  assert.throws(() => writer.saveHostSession(poll), /Browser storage is unavailable/);
});

test('default storage access is lazy when browser storage getters are blocked', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('blocked storage getter'); },
    });
    let storage;
    assert.doesNotThrow(() => { storage = createBrowserStorage(); });
    assert.throws(() => storage.getParticipantId(), /Browser storage is unavailable/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
