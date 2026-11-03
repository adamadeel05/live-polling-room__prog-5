import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api, serviceUrls } from '../lib/api.js';
import { mergeResults } from '../lib/live-state.js';

export default function useLiveResults(pollId) {
  const [results, setResults] = useState(null);
  const [connection, setConnection] = useState('connecting');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    let joinAttempt = 0;
    let receivedLiveSnapshot = false;
    setResults((current) => current?.pollId === pollId ? current : null);
    setConnection('connecting'); setError('');
    const socket = io(serviceUrls.results, { autoConnect: false });
    function accept(snapshot) {
      if (!active || snapshot.pollId !== pollId) return;
      setResults((current) => mergeResults(current, snapshot));
    }
    socket.on('connect', () => {
      if (!active) return;
      const attempt = ++joinAttempt;
      setConnection('connecting');
      socket.timeout(8000).emit('join-poll', { pollId }, (failure, acknowledgement) => {
        if (!active || attempt !== joinAttempt) return;
        if (failure || !acknowledgement?.ok) { setConnection('error'); setError(acknowledgement?.error || 'Live results could not connect. Please try again.'); }
        else { setConnection('live'); setError(''); }
      });
    });
    socket.on('results-update', (snapshot) => { if (active && snapshot.pollId === pollId) { receivedLiveSnapshot = true; accept(snapshot); setConnection('live'); setError(''); } });
    socket.on('results-error', (failure) => { if (active && (!failure.pollId || failure.pollId === pollId)) { setConnection('error'); setError(failure.error || 'Live results are temporarily unavailable.'); } });
    socket.on('disconnect', () => { joinAttempt += 1; if (active) setConnection('reconnecting'); });
    socket.on('connect_error', () => { if (active) { setConnection('reconnecting'); setError('The live connection is unavailable. Reconnecting…'); } });
    socket.connect();
    api.getResults(pollId).then(accept).catch((failure) => { if (active && !receivedLiveSnapshot) setError(failure.message); });
    return () => { active = false; socket.removeAllListeners(); socket.disconnect(); };
  }, [pollId, revision]);

  return { results, connection, error, refresh: () => setRevision((value) => value + 1) };
}
