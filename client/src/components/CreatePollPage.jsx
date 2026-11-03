import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

export default function CreatePollPage({ onCreated }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function submit(event) {
    event.preventDefault();
    const cleanOptions = options.map((option) => option.trim());
    if (!question.trim() || cleanOptions.some((option) => !option)) { setError('Add a question and fill in every answer option.'); return; }
    if (new Set(cleanOptions.map((option) => option.toLowerCase())).size !== cleanOptions.length) { setError('Each answer option needs to be different.'); return; }
    setBusy(true); setError('');
    try { onCreated(await api.createPoll(question.trim(), cleanOptions), mounted.current); }
    catch (failure) { if (mounted.current) setError(failure.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  return (
    <section className="mx-auto max-w-2xl">
      <a href="#/" className="back-link">← Back to home</a>
      <p className="eyebrow mt-8">START THE CONVERSATION</p><h1 className="page-heading mt-2">What’s on your mind?</h1><p className="muted mt-3">Keep it simple. Ask one question and give your room a few ways to answer.</p>
      <form onSubmit={submit} className="card mt-8 p-6 sm:p-8" aria-busy={busy}>
        <label className="field-label" htmlFor="question">Your question</label><textarea id="question" className="input mt-2 min-h-28 resize-y" placeholder="What should we talk about?" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} required disabled={busy} />
        <div className="mt-2 text-right text-xs text-slate-500">{question.length}/500</div>
        <div className="mb-3 mt-7 flex items-end justify-between gap-3"><span className="field-label">Answer options</span><span className="text-xs text-slate-500">2–4 choices · One answer per person</span></div>
        <div className="space-y-3">{options.map((option, index) => <div key={index} className="flex items-center gap-3"><span className="option-letter" aria-hidden="true">{String.fromCharCode(65 + index)}</span><label className="sr-only" htmlFor={`option-${index}`}>Option {String.fromCharCode(65 + index)}</label><input id={`option-${index}`} className="input min-w-0 flex-1" value={option} maxLength={200} required disabled={busy} placeholder={`Answer option ${String.fromCharCode(65 + index)}`} onChange={(event) => setOptions(options.map((value, optionIndex) => optionIndex === index ? event.target.value : value))} />{options.length > 2 && <button type="button" className="remove-option" aria-label={`Remove option ${String.fromCharCode(65 + index)}`} disabled={busy} onClick={() => setOptions(options.filter((_, optionIndex) => optionIndex !== index))}>×</button>}</div>)}</div>
        <button type="button" className="button-ghost mt-3" onClick={() => setOptions([...options, ''])} disabled={busy || options.length >= 4}>＋ Add option</button>
        {error && <p className="alert-error mt-5" role="alert">{error}</p>}
        <div className="mt-7 flex flex-col gap-4 border-t border-[var(--border)] pt-6 sm:flex-row sm:items-center sm:justify-between"><p className="max-w-64 text-sm text-[var(--muted)]">Your room code will be ready as soon as you create the poll.</p><button className="button-primary shrink-0" disabled={busy}>{busy ? 'Creating your room…' : 'Create poll'}{!busy && <span aria-hidden="true">↗</span>}</button></div>
      </form>
    </section>
  );
}
