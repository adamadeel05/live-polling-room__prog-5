import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import HomePage from './components/HomePage.jsx';
import CreatePollPage from './components/CreatePollPage.jsx';
import JoinPollPage from './components/JoinPollPage.jsx';
import ParticipantPage from './components/ParticipantPage.jsx';
import { browserStorage } from './lib/storage.js';

const HostPage = lazy(() => import('./components/HostPage.jsx'));

function readRoute() {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return { page: 'home' };
  if (parts.length === 1 && ['create', 'join'].includes(parts[0])) return { page: parts[0] };
  if (parts[0] === 'join' && parts.length === 2 && /^[1-9]\d{5}$/.test(parts[1])) return { page: 'participant', code: parts[1] };
  if (parts[0] === 'host' && parts.length === 2 && /^[1-9]\d*$/.test(parts[1]) && Number.isSafeInteger(Number(parts[1]))) return { page: 'host', pollId: Number(parts[1]) };
  return { page: 'missing' };
}

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const [createdPoll, setCreatedPoll] = useState(null);
  const [joinedPoll, setJoinedPoll] = useState(null);
  const main = useRef(null);

  useEffect(() => {
    const changeRoute = () => setRoute(readRoute());
    window.addEventListener('hashchange', changeRoute);
    return () => window.removeEventListener('hashchange', changeRoute);
  }, []);
  useEffect(() => {
    const names = { home: 'Live Polling Room', create: 'Create a poll', join: 'Join a poll', participant: 'Cast your vote', host: 'Host workspace', missing: 'Page not found' };
    document.title = `${names[route.page]} · Slido Lite`;
    main.current?.focus();
    window.scrollTo(0, 0);
  }, [route]);

  function pollCreated(poll, shouldNavigate = true) {
    setCreatedPoll(poll);
    try { browserStorage.saveHostSession(poll); } catch { /* Current-tab memory still keeps the host token. */ }
    if (shouldNavigate) window.location.hash = `/host/${poll.id}`;
  }
  function pollJoined(poll) {
    setJoinedPoll(poll);
    window.location.hash = `/join/${poll.roomCode}`;
  }

  return (
    <div className="app-shell">
      <header className="site-header"><div className="site-width flex items-center justify-between gap-4">
        <a href="#/" className="brand" aria-label="Live Polling Room home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Live Polling Room<span className="brand-subtitle">A little question. A shared perspective.</span></span></a>
        <nav aria-label="Main navigation" className="hidden items-center gap-6 sm:flex"><a href="#/create" className="nav-link">Create poll</a><a href="#/join" className="button-secondary !px-4 !py-2.5">Join poll <span aria-hidden="true">↗</span></a></nav>
      </div></header>
      <main ref={main} tabIndex={-1} className="site-width main-content outline-none">
        {route.page === 'home' && <HomePage />}
        {route.page === 'create' && <CreatePollPage onCreated={pollCreated} />}
        {route.page === 'join' && <JoinPollPage onJoined={pollJoined} />}
        {route.page === 'participant' && <ParticipantPage key={route.code} roomCode={route.code} initialPoll={joinedPoll?.roomCode === route.code ? joinedPoll : null} />}
        {route.page === 'host' && <Suspense fallback={<div className="card p-8" role="status">Opening your host workspace…</div>}><HostPage key={route.pollId} pollId={route.pollId} initialPoll={createdPoll?.id === route.pollId ? createdPoll : null} /></Suspense>}
        {route.page === 'missing' && <section className="card mx-auto max-w-xl p-8 text-center"><h1 className="page-heading">That page isn’t here.</h1><p className="muted mt-3">Start a new conversation or join a room from the homepage.</p><a href="#/" className="button-primary mt-6">Back to home</a></section>}
      </main>
      <footer className="site-width site-footer"><span>Live Polling Room <span className="opacity-50">/ Slido Lite</span></span><span>Simple polls. Shared perspectives.</span></footer>
    </div>
  );
}
