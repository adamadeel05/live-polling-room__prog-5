function pollError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Read the public REST API; the Voting Service never opens the Poll database.
export async function fetchPoll(pollId, pollServiceUrl, timeoutMs) {
  try {
    const baseUrl = pollServiceUrl.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/polls/${pollId}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Read the body under the same timeout, including slow or interrupted replies.
    const body = await response.text();

    if (response.status === 404) {
      throw pollError(404, 'Poll not found.');
    }
    if (!response.ok) {
      throw pollError(502, 'Poll Service returned an unexpected response.');
    }

    let poll;
    try {
      poll = JSON.parse(body);
    } catch {
      throw pollError(502, 'Poll Service returned invalid poll data.');
    }

    if (
      !poll || poll.id !== pollId || !['open', 'closed'].includes(poll.status) ||
      !Array.isArray(poll.options) || poll.options.length < 2 || poll.options.length > 4 ||
      poll.options.some((option) => !option || !Number.isSafeInteger(option.id) || option.id < 1 || typeof option.text !== 'string') ||
      new Set(poll.options.map((option) => option.id)).size !== poll.options.length
    ) {
      throw pollError(502, 'Poll Service returned invalid poll data.');
    }

    return poll;
  } catch (error) {
    if (error.status) throw error;
    throw pollError(503, 'Poll Service is unavailable or timed out. Please try again.');
  }
}
