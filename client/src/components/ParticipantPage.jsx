import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { browserStorage } from '../lib/storage.js';
import { mergePoll } from '../lib/live-state.js';

export default function ParticipantPage({ roomCode, initialPoll }) {
  const [poll, setPoll] = useState(initialPoll);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [storageError, setStorageError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  function applyPoll(current) {
    setPoll((previous) => mergePoll(previous, current));
  }

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setStorageError('');
    async function load() {
      try {
        const current = await api.getPollByRoomCode(roomCode);
        if (!active) return;
        applyPoll(current);
        try { setReceipt(browserStorage.getVote(current.id)); } catch { setStorageError('Allow browser storage to vote, so we can remember your response.'); }
      } catch (failure) { if (active) setError(failure.status === 404 ? 'This room could not be found. Check the code with your host.' : failure.message); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [roomCode, revision]);

  useEffect(() => {
    if (!poll?.id) return;
    let active = true;
    const updateStatus = () => {
      if (document.hidden) return;
      api.getPoll(poll.id).then((current) => { if (active) applyPoll(current); }).catch(() => {});
    };
    window.addEventListener('focus', updateStatus);
    document.addEventListener('visibilitychange', updateStatus);
    return () => { active = false; window.removeEventListener('focus', updateStatus); document.removeEventListener('visibilitychange', updateStatus); };
  }, [poll?.id]);

  function rememberVote(optionId) {
    setReceipt({ optionId });
    try { browserStorage.saveVote(poll.id, optionId); }
    catch { setStorageError('Your vote is recorded. This browser could not save the confirmation.'); }
  }

  async function submit(event) {
    event.preventDefault();
    if (selected === null || receipt || busy || poll.status === 'closed') return;
    setBusy(true); setError('');
    try {
      const current = await api.getPoll(poll.id);
      applyPoll(current);
      if (current.status === 'closed') return;
      const participantId = browserStorage.getParticipantId();
      await api.submitVote(poll.id, selected, participantId);
      rememberVote(selected);
    } catch (failure) {
      if (failure.status === 409 && /already voted/i.test(failure.message)) rememberVote(null);
      else if (failure.status === 409 && /closed/i.test(failure.message)) setPoll((current) => ({ ...current, status: 'closed' }));
      else setError(failure.message);
    } finally { setBusy(false); }
  }

  if (loading) return <section className="card mx-auto max-w-xl p-10 text-center" role="status"><span className="loading-spinner" /><p className="muted mt-4">Opening your room…</p></section>;
  if (!poll) return <section className="card mx-auto max-w-xl p-8 text-center"><p className="eyebrow">LET’S FIND YOUR ROOM</p><h1 className="page-heading mt-3">A little trouble connecting.</h1><p role="alert" className="alert-error mt-5">{error || 'The poll could not be loaded.'}</p><div className="mt-6 flex flex-wrap justify-center gap-3"><button className="button-secondary" onClick={() => setRevision((value) => value + 1)}>Try again</button><a href="#/join" className="button-primary">Enter another code</a></div></section>;
  const chosenOption = poll.options.find((option) => option.id === receipt?.optionId);

  return (
    <section className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between gap-3"><a href="#/join" className="back-link">← Join another room</a><span className="room-tag">ROOM {poll.roomCode}</span></div>
      <div className="card p-6 sm:p-9">
        <div className="mb-4 flex items-center justify-between gap-4"><p className="eyebrow">{receipt ? 'THANKS FOR TAKING PART' : 'YOUR PERSPECTIVE MATTERS'}</p><span className={`status-pill ${poll.status === 'closed' ? 'status-closed' : ''}`}><span className="live-dot" />{poll.status === 'closed' ? 'Closed' : 'Open for votes'}</span></div>
        <h1 className="poll-question">{poll.question}</h1>
        {receipt ? <div className="confirmation"><span className="confirmation-mark" aria-hidden="true">✓</span><h2>You’re counted.</h2><p className="muted mt-2">{chosenOption ? <>Your vote for <strong className="text-[var(--ink)]">{chosenOption.text}</strong> has been recorded.</> : 'Your response has already been recorded for this poll.'}</p><p className="mt-4 text-sm text-[var(--muted)]">One vote. One voice. Thanks for sharing yours.</p>{poll.status === 'closed' && <p className="alert-info mt-5">This poll is now closed.</p>}<a href="#/join" className="button-secondary mt-6">Join another poll <span aria-hidden="true">↗</span></a></div> : <form onSubmit={submit} className="mt-6" aria-busy={busy}>
          {poll.status === 'closed' ? <p className="alert-info mb-5" role="status">This poll is closed. The host is no longer accepting votes.</p> : <p className="muted mb-5">Pick the answer that feels right. You can vote once.</p>}
          <fieldset disabled={busy || poll.status === 'closed' || Boolean(storageError)} className="space-y-3"><legend className="sr-only">Choose one answer</legend>{poll.options.map((option, index) => <label key={option.id} className={`vote-choice ${selected === option.id ? 'is-selected' : ''}`}><span className="option-letter" aria-hidden="true">{String.fromCharCode(65 + index)}</span><span className="min-w-0 flex-1 break-words">{option.text}</span><input type="radio" name="answer" value={option.id} checked={selected === option.id} onChange={() => setSelected(option.id)} required aria-label={option.text} /></label>)}</fieldset>
          {error && <p role="alert" className="alert-error mt-5">{error}</p>}
          <button className="button-primary mt-6 w-full" disabled={selected === null || busy || poll.status === 'closed' || Boolean(storageError)}>{busy ? 'Submitting your vote…' : poll.status === 'closed' ? 'Voting is closed' : 'Submit vote'}{!busy && poll.status === 'open' && <span aria-hidden="true">↗</span>}</button>
          <p className="mt-4 text-center text-xs text-[var(--muted)]">Anonymous by default. Your name is never asked for.</p>
        </form>}
        {storageError && <p role="status" className="alert-info mt-5">{storageError}{!receipt && <button className="ml-2 underline" onClick={() => setRevision((value) => value + 1)}>Try again</button>}</p>}
      </div>
    </section>
  );
}
