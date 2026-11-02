function serviceError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function requestJson(baseUrl, path, serviceName, timeoutMs) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    if (response.status === 404) throw serviceError(404, 'Poll not found.');
    if (response.status === 503) throw serviceError(503, `${serviceName} is unavailable. Please try again.`);
    if (!response.ok) throw serviceError(502, `${serviceName} returned an unexpected response.`);

    try {
      return JSON.parse(body);
    } catch {
      throw serviceError(502, `${serviceName} returned invalid JSON.`);
    }
  } catch (error) {
    if (error.status) throw error;
    throw serviceError(503, `${serviceName} is unavailable or timed out. Please try again.`);
  }
}

function validPoll(poll) {
  return poll && Number.isSafeInteger(poll.id) && poll.id > 0 &&
    typeof poll.question === 'string' && typeof poll.roomCode === 'string' && /^[1-9]\d{5}$/.test(poll.roomCode) &&
    ['open', 'closed'].includes(poll.status) && Array.isArray(poll.options) &&
    poll.options.length >= 2 && poll.options.length <= 4 &&
    poll.options.every((option) => option && Number.isSafeInteger(option.id) && option.id > 0 && typeof option.text === 'string') &&
    new Set(poll.options.map((option) => option.id)).size === poll.options.length;
}

export function calculateResults(poll, voteCounts) {
  if (!validPoll(poll)) {
    throw serviceError(502, 'Poll Service returned invalid poll data.');
  }
  if (
    !voteCounts || voteCounts.pollId !== poll.id || !Number.isSafeInteger(voteCounts.totalVotes) || voteCounts.totalVotes < 0 ||
    !Array.isArray(voteCounts.counts) || voteCounts.counts.length !== poll.options.length ||
    voteCounts.counts.some((option) => !option || !Number.isSafeInteger(option.optionId) ||
      !Number.isSafeInteger(option.count) || option.count < 0 || !poll.options.some((item) => item.id === option.optionId)) ||
    new Set(voteCounts.counts.map((option) => option.optionId)).size !== poll.options.length ||
    voteCounts.counts.reduce((total, option) => total + option.count, 0) !== voteCounts.totalVotes
  ) {
    throw serviceError(502, 'Voting Service returned invalid vote counts.');
  }

  const countsByOption = new Map(voteCounts.counts.map((option) => [option.optionId, option.count]));
  return {
    pollId: poll.id,
    question: poll.question,
    roomCode: poll.roomCode,
    status: poll.status,
    totalVotes: voteCounts.totalVotes,
    results: poll.options.map((option) => {
      const count = countsByOption.get(option.id);
      const percentage = voteCounts.totalVotes === 0 ? 0 : Math.round((count / voteCounts.totalVotes) * 10000) / 100;
      return { optionId: option.id, text: option.text, count, percentage };
    }),
  };
}

export function createResultsReader({
  pollServiceUrl = 'http://localhost:3001',
  votingServiceUrl = 'http://localhost:3002',
  requestTimeoutMs = 3000,
} = {}) {
  return async function getResults(pollId) {
    if (!Number.isSafeInteger(pollId) || pollId < 1) {
      throw serviceError(400, 'Poll ID must be a positive safe integer.');
    }

    const poll = await requestJson(pollServiceUrl, `/polls/${pollId}`, 'Poll Service', requestTimeoutMs);
    if (!validPoll(poll) || poll.id !== pollId) {
      throw serviceError(502, 'Poll Service returned invalid poll data.');
    }
    const counts = await requestJson(votingServiceUrl, `/votes/${pollId}/counts`, 'Voting Service', requestTimeoutMs);
    return calculateResults(poll, counts);
  };
}
