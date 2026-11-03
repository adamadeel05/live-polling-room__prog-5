export default function HomePage() {
  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="eyebrow">Small questions. Big conversations.</p>
          <h1>Big questions.<br /><span>Instant answers.</span></h1>
          <p className="home-description">Bring every voice into the room. Create a poll, share one simple code, and turn anonymous answers into a live conversation.</p>
          <div className="home-highlights"><span><i className="live-dot" />Live results</span><span>No sign-up needed</span><span>Made for your room</span></div>
        </div>
        <div className="home-art" aria-hidden="true">
          <div className="art-orbit art-orbit-one" />
          <div className="art-orbit art-orbit-two" />
          <div className="art-spark">✳</div>
          <div className="art-card">
            <div className="art-card-top"><span className="art-tiny-label">THE ROOM HAS A VOICE</span><span className="art-dot" /></div>
            <p>A little question.<br />A clearer picture.</p>
            <div className="art-bars"><i /><i /><i /><i /></div>
            <div className="art-baseline" />
          </div>
          <div className="art-note"><span>↗</span> Every voice matters.</div>
        </div>
      </section>
      <section className="home-actions" aria-label="Get started">
        <a className="home-action" href="#/create">
          <div className="home-action-top"><span className="home-action-icon" aria-hidden="true">＋</span><span className="home-action-kicker">FOR THE HOST</span></div>
          <h2>Create poll <span aria-hidden="true">↗</span></h2>
          <p>A question, a few options, and a room full of possibilities. Your next conversation starts here.</p>
          <span className="home-action-link">Start a new room <span aria-hidden="true">→</span></span>
        </a>
        <a className="home-action home-action-join" href="#/join">
          <div className="home-action-top"><span className="home-action-icon" aria-hidden="true">↳</span><span className="home-action-kicker">FOR THE AUDIENCE</span></div>
          <h2>Join poll <span aria-hidden="true">↗</span></h2>
          <p>Have a six-digit room code? Step in, choose your answer, and add your voice. It’s that simple.</p>
          <span className="home-action-link">Enter your room code <span aria-hidden="true">→</span></span>
        </a>
      </section>
      <p className="home-footnote">Less setting up. More finding out.</p>
    </div>
  );
}
