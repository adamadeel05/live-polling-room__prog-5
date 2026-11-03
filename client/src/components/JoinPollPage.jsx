import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

export default function JoinPollPage({ onJoined }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function submit(event) {
    event.preventDefault();
    if (!/^[1-9]\d{5}$/.test(code)) { setError('Enter a six-digit room code from your host.'); return; }
    setError(''); setBusy(true);
    try { const poll = await api.getPollByRoomCode(code); if (mounted.current) onJoined(poll); }
    catch (failure) { if (mounted.current) setError(failure.status === 404 ? 'We couldn’t find that room. Check the code and try again.' : failure.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  return (
    <section className="mx-auto max-w-lg">
      <a href="#/" className="back-link">← Back to home</a>
      <div className="join-intro"><span className="join-symbol" aria-hidden="true">↗</span><p className="eyebrow mt-6">YOUR VOICE BELONGS HERE</p><h1 className="page-heading mt-2">Join the conversation.</h1><p className="muted mt-3">Enter the six-digit room code your host shared with you.</p></div>
      <form onSubmit={submit} className="card p-6 sm:p-8" aria-busy={busy}>
        <label className="field-label" htmlFor="room-code">Room code</label><input id="room-code" className="input room-code-input mt-3" type="text" inputMode="numeric" autoComplete="off" placeholder="123456" maxLength={6} value={code} disabled={busy} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} aria-describedby={error ? 'join-error' : 'join-hint'} />
        <p id="join-hint" className="mt-3 text-sm text-[var(--muted)]">No account. No names. Just your perspective.</p>
        {error && <p id="join-error" className="alert-error mt-5" role="alert">{error}</p>}
        <button className="button-primary mt-6 w-full" disabled={busy || code.length !== 6}>{busy ? 'Finding your room…' : 'Join poll'}{!busy && <span aria-hidden="true">↗</span>}</button>
      </form>
    </section>
  );
}
