const storageError = 'Browser storage is unavailable. Enable browser storage and try again.';

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function participantId(value) {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.trim().length <= 100 && !value.includes('\0');
}

function hostSession(value, pollId) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    positiveId(value.id) && value.id === pollId &&
    typeof value.hostToken === 'string' && /^[a-f0-9]{64}$/i.test(value.hostToken);
}

function generateParticipantId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Could not create a secure participant ID in this browser.');
}

export function createBrowserStorage({ localStorage, sessionStorage, generateId = generateParticipantId } = {}) {
  // Resolve browser storage only when used; blocked storage must not break imports.
  function access(kind, method, ...arguments_) {
    try {
      const storage = kind === 'local'
        ? localStorage ?? globalThis.localStorage
        : sessionStorage ?? globalThis.sessionStorage;
      if (!storage || typeof storage[method] !== 'function') throw new Error(storageError);
      return storage[method](...arguments_);
    } catch {
      throw new Error(storageError);
    }
  }

  function readJson(kind, key) {
    const text = access(kind, 'getItem', key);
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  return {
    getParticipantId() {
      const stored = access('local', 'getItem', 'lpr.participantId');
      if (participantId(stored)) return stored.trim();
      const generated = generateId();
      if (!participantId(generated)) {
        throw new Error('Could not create a participant ID. Please try again.');
      }
      const id = generated.trim();
      access('local', 'setItem', 'lpr.participantId', id);
      return id;
    },

    getVote(pollId) {
      if (!positiveId(pollId)) return null;
      const vote = readJson('local', `lpr.vote.${pollId}`);
      if (!vote || typeof vote !== 'object' || Array.isArray(vote) ||
        (vote.optionId !== null && !positiveId(vote.optionId))) return null;
      return { optionId: vote.optionId };
    },

    saveVote(pollId, optionId = null) {
      if (!positiveId(pollId) || (optionId !== null && !positiveId(optionId))) return null;
      const vote = { optionId };
      access('local', 'setItem', `lpr.vote.${pollId}`, JSON.stringify(vote));
      return vote;
    },

    getHostSession(pollId) {
      if (!positiveId(pollId)) return null;
      const poll = readJson('session', `lpr.host.${pollId}`);
      return hostSession(poll, pollId) ? poll : null;
    },

    saveHostSession(poll) {
      if (!hostSession(poll, poll?.id)) return null;
      let text;
      try {
        text = JSON.stringify(poll);
      } catch {
        return null;
      }
      access('session', 'setItem', `lpr.host.${poll.id}`, text);
      return poll;
    },

    removeHostSession(pollId) {
      if (!positiveId(pollId)) return null;
      access('session', 'removeItem', `lpr.host.${pollId}`);
    },
  };
}

export const browserStorage = createBrowserStorage();
