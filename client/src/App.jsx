const services = [
  { name: 'React client', port: 5173 },
  { name: 'Poll Service', port: 3001 },
  { name: 'Voting Service', port: 3002 },
  { name: 'Results Service', port: 3003 },
];

export default function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
        Programming 5 university project
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        Live Polling Room <span className="text-slate-500">(Slido Lite)</span>
      </h1>
      <p className="mt-6 text-lg font-medium text-slate-900">Part 1 setup ready</p>
      <p className="mt-2 leading-relaxed text-slate-600">
        The React client and three independent Express services have their project
        structure in place. Poll creation, anonymous voting, and live results will
        be added in later parts.
      </p>
      <dl className="mt-8 grid gap-4 sm:grid-cols-2">
        {services.map((service) => (
          <div key={service.name} className="rounded-xl border border-slate-200 bg-white p-5">
            <dt className="font-medium text-slate-900">{service.name}</dt>
            <dd className="mt-1 text-sm text-slate-600">Port {service.port}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-sm text-slate-500">
        These are the configured development ports. Each backend service exposes
        a /health endpoint.
      </p>
    </main>
  );
}
