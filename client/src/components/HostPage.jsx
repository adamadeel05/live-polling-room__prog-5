import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { browserStorage } from '../lib/storage.js';
import useLiveResults from '../hooks/useLiveResults.js';
import ResultsChart from './ResultsChart.jsx';

export default function HostPage({ pollId, initialPoll }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let active = true;
    async function load() {
      setState({ loading: true });
      let session = String(initialPoll?.id) === String(pollId) ? initialPoll : null;
      let storageWarning = false;
      try { session ||= browserStorage.getHostSession(pollId); }
      catch { storageWarning = true; }
      if (!session?.hostToken) {
        if (active) setState({ missingAccess: true });
        return;
      }
      try {
        const fresh = await api.getPoll(pollId);
        const poll = { ...fresh, hostToken: session.hostToken };
        try { browserStorage.saveHostSession(poll); }
        catch { storageWarning = true; }
        if (active) setState({ poll, storageWarning });
      } catch (error) {
        if (active) setState({ error: error.message || 'We could not load your room. Please try again.' });
      }
    }
    load();
    return () => { active = false; };
  }, [pollId, initialPoll, attempt]);

  if (state.loading) return <div className="card p-8" role="status">Opening your host workspace…</div>;
  if (state.missingAccess) return (
    <section className="card mx-auto max-w-xl p-8">
      <p className="eyebrow">Host access</p>
      <h1 className="page-heading mt-3">Open the original host tab.</h1>
      <p className="muted mt-4">Host access is saved in the tab where you created the poll. This tab does not have its host key, so it cannot manage that room.</p>
      <a href="#/create" className="button-primary mt-6 inline-flex">Create a new poll</a>
      <a href="#/" className="button-ghost ml-3 inline-flex">Go home</a>
    </section>
  );
  if (state.error) return (
    <section className="card p-8">
      <h1 className="page-heading">Your room could not load.</h1>
      <p role="alert" className="alert-error mt-5">{state.error}</p>
      <button type="button" className="button-primary mt-5" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
    </section>
  );
  return <HostWorkspace key={pollId} initialPoll={state.poll} initialStorageWarning={state.storageWarning} />;
}

function HostWorkspace({ initialPoll, initialStorageWarning }) {
  const [poll, setPoll] = useState(initialPoll);
  const [storageWarning, setStorageWarning] = useState(initialStorageWarning);
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [copyState, setCopyState] = useState('');
  const { results, connection, error, refresh } = useLiveResults(poll.id);
  const closed = poll.status === 'closed' || results?.status === 'closed';
  const connectionLabel = { connecting: 'Connecting', live: 'Live connection', reconnecting: 'Reconnecting', error: 'Connection interrupted' }[connection];

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(poll.roomCode);
      setCopyState('Room code copied.');
    } catch { setCopyState('Copy is unavailable. Select and copy the room code above.'); }
  }

  function updatePoll(fresh) {
    const updated = { ...fresh, hostToken: poll.hostToken };
    setPoll(updated);
    try { browserStorage.saveHostSession(updated); }
    catch { setStorageWarning(true); }
    setConfirming(false);
  }

  async function closePoll() {
    setClosing(true);
    setCloseError('');
    try {
      updatePoll(await api.closePoll(poll.id, poll.hostToken));
      await refresh();
    } catch (closeFailure) {
      if (closeFailure.status === 409) {
        try {
          updatePoll(await api.getPoll(poll.id));
          await refresh();
        } catch (reloadFailure) { setCloseError(reloadFailure.message); }
      } else setCloseError(closeFailure.message || 'Voting could not be closed. Please try again.');
    } finally { setClosing(false); }
  }

  return (
    <div>
      <header className="mb-8 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
        <div>
          <p className="eyebrow">Host workspace</p>
          <h1 className="page-heading mt-3">{closed ? 'This room is closed.' : 'Your room is live.'}</h1>
          <p className="muted mt-3">{closed ? 'Voting has ended. Your final results are still here.' : 'Share the code, invite your audience, and watch their answers arrive.'}</p>
        </div>
        <button type="button" className="button-secondary shrink-0" disabled={closed || closing || !poll.hostToken} onClick={() => { setConfirming(true); setCloseError(''); }}>{closed ? 'Voting closed' : closing ? 'Closing…' : 'Close voting'}</button>
      </header>
      {storageWarning && <p className="alert-info mb-5" role="status">Your browser could not save host access. Keep this tab open to manage your poll.</p>}
      {confirming && !closed && (
        <section className="alert-info mb-5" aria-label="Confirm closing voting">
          <p className="font-semibold">Close voting for everyone?</p>
          <p className="mt-1 text-sm">New votes will stop. Your results will remain available.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="button-primary" disabled={closing} onClick={closePoll}>{closing ? 'Closing…' : 'Yes, close voting'}</button>
            <button type="button" className="button-secondary" disabled={closing} onClick={() => setConfirming(false)}>Keep it open</button>
          </div>
        </section>
      )}
      {closeError && <p className="alert-error mb-5" role="alert">{closeError}</p>}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="card order-2 min-w-0 p-5 sm:p-8 lg:order-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="eyebrow">Audience responses</p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="min-h-11 text-xs font-semibold text-[#637774] underline underline-offset-4" onClick={() => refresh()}>Refresh results</button>
              <span className="status-pill"><span className={`h-2 w-2 rounded-full ${closed ? 'bg-[#8a9890]' : connection === 'live' ? 'bg-[#518750]' : 'bg-[#bb914c]'}`} />{closed ? 'Voting closed' : connectionLabel}</span>
            </div>
          </div>
          <h2 className="mt-5 break-words text-2xl font-semibold leading-snug text-[#163a3a]">{poll.question}</h2>
          <div className="mb-6 mt-5 flex items-baseline gap-2" aria-live="polite" aria-atomic="true">
            {results ? <><span className="text-4xl font-semibold tracking-tight text-[#163a3a]">{results.totalVotes}</span><span className="muted text-sm">{results.totalVotes === 1 ? 'vote received' : 'votes received'}</span></> : <span className="muted text-sm">Waiting for results…</span>}
          </div>
          {error && <div className="alert-error mb-5" role="alert"><p>{typeof error === 'string' ? error : error.message}</p><button type="button" className="mt-2 font-semibold underline underline-offset-4" onClick={() => refresh()}>Retry results</button></div>}
          {results ? <>
            {results.totalVotes === 0 && <p className="mb-5 rounded-xl bg-[#f5f7f4] px-4 py-3 text-sm text-[#526761]">{closed ? 'No votes were submitted before voting closed.' : 'No votes yet. Share your room code to invite the first response.'}</p>}
            <ResultsChart results={results.results} />
          </> : !error && <p className="muted py-16 text-center" role="status">Loading live results…</p>}
        </section>
        <aside className="card order-1 p-6 lg:order-2 lg:p-7">
          <p className="eyebrow">Invite your audience</p>
          <h2 className="mt-3 text-lg font-semibold text-[#163a3a]">One code. Every voice.</h2>
          <p className="muted mt-3 text-sm leading-relaxed">Ask participants to open this app, choose Join poll, and enter:</p>
          <p className="my-6 select-all rounded-xl border border-[#dce4df] bg-[#f5f7f4] py-5 text-center font-mono text-4xl font-semibold tracking-[0.16em] text-[#163a3a]" aria-label={`Room code ${poll.roomCode.split('').join(' ')}`}>{poll.roomCode}</p>
          <button type="button" className="button-primary w-full" onClick={copyCode}>{copyState === 'Room code copied.' ? 'Copied!' : 'Copy room code'}</button>
          <p className="mt-3 text-sm text-[#526761]" role="status">{copyState}</p>
          <p className="muted mt-5 border-t border-[#dce4df] pt-5 text-xs leading-relaxed">Keep this host tab open. Participants can vote anonymously, once per browser.</p>
          <a href="#/create" className="mt-5 inline-block text-sm font-semibold text-[#163a3a] underline underline-offset-4">Create another poll →</a>
        </aside>
      </div>
    </div>
  );
}
