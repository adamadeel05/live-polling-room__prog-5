// A notification failure must never undo or reject an accepted vote.
export async function notifyResults(pollId, resultsServiceUrl, timeoutMs = 2000) {
  try {
    const baseUrl = resultsServiceUrl.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/internal/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Consume the response under the same timeout, even if its body is slow.
    await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown notification error';
    console.warn('Vote saved; Results Service notification failed:', message);
    return false;
  }
}
