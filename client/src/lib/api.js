const environment = import.meta.env ?? {};

export const serviceUrls = {
  poll: environment.VITE_POLL_SERVICE_URL || 'http://localhost:3001',
  voting: environment.VITE_VOTING_SERVICE_URL || 'http://localhost:3002',
  results: environment.VITE_RESULTS_SERVICE_URL || 'http://localhost:3003',
};

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function createApi({
  pollServiceUrl = serviceUrls.poll,
  votingServiceUrl = serviceUrls.voting,
  resultsServiceUrl = serviceUrls.results,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
} = {}) {
  async function request(baseUrl, path, { method = 'GET', body, headers = {} } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}${path}`, {
        method,
        headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      // Keep the timeout active while receiving the response body too.
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        const message = response.ok
          ? 'The service returned an invalid response. Please try again.'
          : `Request failed (HTTP ${response.status}). Please try again.`;
        throw new ApiError(message, response.status);
      }

      if (!response.ok) {
        const message = typeof data?.error === 'string' && data.error.trim()
          ? data.error
          : `Request failed (HTTP ${response.status}). Please try again.`;
        throw new ApiError(message, response.status);
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) {
        throw new ApiError('The request timed out. Please try again.');
      }
      throw new ApiError('Could not reach the service. Check that it is running and try again.');
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    createPoll: (question, options) => request(pollServiceUrl, '/polls', {
      method: 'POST', body: { question, options },
    }),
    getPoll: (id) => request(pollServiceUrl, `/polls/${encodeURIComponent(id)}`),
    getPollByRoomCode: (code) => request(pollServiceUrl, `/polls/room/${encodeURIComponent(code)}`),
    closePoll: (id, hostToken) => request(pollServiceUrl, `/polls/${encodeURIComponent(id)}/close`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${hostToken}` },
    }),
    submitVote: (pollId, optionId, participantId) => request(votingServiceUrl, '/votes', {
      method: 'POST', body: { pollId, optionId, participantId },
    }),
    getResults: (id) => request(resultsServiceUrl, `/results/${encodeURIComponent(id)}`),
  };
}

export const api = createApi();
