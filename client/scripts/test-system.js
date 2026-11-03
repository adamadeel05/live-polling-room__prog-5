import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = fileURLToPath(new URL('../../', import.meta.url));
const serviceNames = ['poll', 'voting', 'results', 'client'];
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function reservePorts() {
  const reservations = [];
  try {
    for (const name of serviceNames) {
      const server = createServer();
      reservations.push({ name, server });
      await new Promise((resolveListening, reject) => {
        server.once('error', reject);
        server.listen(0, resolveListening);
      });
    }
    return Object.fromEntries(reservations.map(({ name, server }) => [name, server.address().port]));
  } finally {
    await Promise.all(reservations.map(({ server }) => new Promise((resolveClosed) => {
      if (server.listening) server.close(resolveClosed);
      else resolveClosed();
    })));
  }
}

async function within(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Use disposable paths for this fixture, never the application's normal databases.
export async function startTestSystem() {
  const directory = await mkdtemp(join(tmpdir(), 'lpr-system-test-'));
  const children = new Map();
  const logs = new Map(serviceNames.map((name) => [name, '']));
  let configurations;
  let closing;

  function getLogs(name) {
    if (name !== undefined && !serviceNames.includes(name)) throw new Error('Unknown fixture service.');
    if (name !== undefined) return logs.get(name);
    return serviceNames.map((service) => `[${service}]\n${logs.get(service)}`).join('\n');
  }

  function appendLog(name, chunk) {
    // Diagnostics must never print host credentials, even if a child error changes.
    const text = chunk.toString().replace(/\b[a-f0-9]{64}\b/gi, '[redacted]');
    logs.set(name, (logs.get(name) + text).slice(-24000));
  }

  async function waitUntilReady(name, record) {
    const configuration = configurations[name];
    const deadline = Date.now() + 15000;
    let reason = 'No successful response yet.';
    while (Date.now() < deadline) {
      if (record.exited) {
        throw new Error(`${name} exited before readiness.\n${getLogs(name)}`);
      }
      try {
        const response = await fetch(configuration.readyUrl, { signal: AbortSignal.timeout(700) });
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (name === 'client') {
          const markup = await response.text();
          if (!/<title>Live Polling Room \(Slido Lite\)<\/title>/.test(markup)) {
            throw new Error('The expected client title was missing.');
          }
        } else {
          const health = await response.json();
          if (health.status !== 'ok' || health.service !== `${name}-service` || health.port !== configuration.port) {
            throw new Error('The service health response did not match its fixture configuration.');
          }
        }
        if (!record.exited) return;
      } catch (error) {
        reason = error.message;
      }
      await delay(75);
    }
    throw new Error(`${name} did not become ready within 15 seconds (${reason}).\n${getLogs(name)}`);
  }

  async function startService(name) {
    if (!serviceNames.includes(name)) throw new Error('Unknown fixture service.');
    if (closing) throw new Error('The fixture is closing.');
    const current = children.get(name);
    if (current && !current.exited) return;
    const configuration = configurations[name];
    let resolveExit;
    const record = { exited: false, exit: new Promise((resolveExited) => { resolveExit = resolveExited; }) };
    const child = spawn(process.execPath, configuration.arguments, {
      cwd: configuration.cwd, env: configuration.environment,
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    record.child = child;
    children.set(name, record);
    child.stdout.on('data', (chunk) => appendLog(name, chunk));
    child.stderr.on('data', (chunk) => appendLog(name, chunk));
    child.once('error', (error) => {
      appendLog(name, `Process error: ${error.message}\n`);
      if (!child.pid) {
        record.exited = true;
        resolveExit();
      }
    });
    child.once('exit', (code, signal) => {
      appendLog(name, `Process exited (code ${code}, signal ${signal}).\n`);
      record.exited = true;
      resolveExit();
    });
    await waitUntilReady(name, record);
  }

  async function stopService(name) {
    if (!serviceNames.includes(name)) throw new Error('Unknown fixture service.');
    const record = children.get(name);
    if (!record || record.exited || !record.child.pid) return;
    record.child.kill('SIGTERM');
    try {
      await within(record.exit, 5000, `${name} did not stop after SIGTERM.`);
    } catch {
      record.child.kill('SIGKILL');
      await within(record.exit, 3000, `${name} did not stop after SIGKILL.`);
    }
  }

  async function restartService(name) {
    await stopService(name);
    await startService(name);
  }

  async function close() {
    if (closing) return closing;
    closing = (async () => {
      const stopped = await Promise.allSettled(serviceNames.map(stopService));
      const failures = stopped.filter((result) => result.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'Fixture processes could not all be stopped. Temporary data was preserved.');
      const absoluteDirectory = resolve(directory);
      if (dirname(absoluteDirectory) !== resolve(tmpdir()) || !basename(absoluteDirectory).startsWith('lpr-system-test-')) {
        throw new Error('Refusing to remove a directory outside the fixture temporary location.');
      }
      await rm(absoluteDirectory, { recursive: true, force: true });
    })();
    return closing;
  }

  try {
    const ports = await reservePorts();
    const pollUrl = `http://127.0.0.1:${ports.poll}`;
    const votingUrl = `http://127.0.0.1:${ports.voting}`;
    const resultsUrl = `http://127.0.0.1:${ports.results}`;
    const clientUrl = `http://localhost:${ports.client}`;
    const emptyEnvironmentFile = join(directory, '.env');
    await writeFile(emptyEnvironmentFile, '');
    const sharedEnvironment = {
      ...process.env,
      CLIENT_ORIGIN: clientUrl,
      POLL_SERVICE_URL: pollUrl,
      VOTING_SERVICE_URL: votingUrl,
      RESULTS_SERVICE_URL: resultsUrl,
      VITE_POLL_SERVICE_URL: pollUrl,
      VITE_VOTING_SERVICE_URL: votingUrl,
      VITE_RESULTS_SERVICE_URL: resultsUrl,
      DOTENV_CONFIG_PATH: emptyEnvironmentFile,
    };
    const urls = { poll: pollUrl, voting: votingUrl, results: resultsUrl, client: clientUrl };
    configurations = Object.fromEntries(serviceNames.map((name) => {
      const cwd = join(projectDirectory, name === 'client' ? 'client' : `services/${name}-service`);
      return [name, {
        cwd, port: ports[name], readyUrl: name === 'client' ? clientUrl : `${urls[name]}/health`,
        arguments: name === 'client'
          ? [join(cwd, 'node_modules/vite/bin/vite.js'), '--host', 'localhost', '--port', String(ports.client), '--strictPort']
          : [join(cwd, 'src/index.js')],
        environment: {
          ...sharedEnvironment, PORT: String(ports[name]),
          DATABASE_PATH: join(directory, name === 'poll' ? 'polls.db' : name === 'voting' ? 'votes.db' : `${name}-unused.db`),
        },
      }];
    }));
    await Promise.all(serviceNames.map(startService));
    return { pollUrl, votingUrl, resultsUrl, clientUrl, directory, startService, stopService, restartService, close, getLogs };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Fixture startup and cleanup failed.');
    }
    throw error;
  }
}
