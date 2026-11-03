import { startTestSystem } from './test-system.js';

const startup = startTestSystem();
let shutdownPromise;

function shutdown(exitCode = 0) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    let finalCode = exitCode;
    try {
      const system = await startup;
      await system.close();
      console.log('Isolated integration preview stopped; temporary data removed.');
    } catch (error) {
      console.error(`Integration preview cleanup: ${error.message}`);
      finalCode = 1;
    }
    process.exit(finalCode);
  })();
  return shutdownPromise;
}

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

try {
  const system = await startup;
  if (!shutdownPromise) {
    console.log(`INTEGRATION_PREVIEW ${JSON.stringify({
      clientUrl: system.clientUrl, pollUrl: system.pollUrl,
      votingUrl: system.votingUrl, resultsUrl: system.resultsUrl,
    })}`);
    console.log('All four applications are ready with isolated temporary databases.');
    console.log('Commands: restart-poll, restart-voting, stop-results, start-results, stop');
    let buffer = '';
    let commands = Promise.resolve();
    process.stdin.setEncoding('utf8');
    // Piped input ending must also release the temporary processes and files.
    process.stdin.once('end', () => { void commands.then(() => shutdown()); });
    process.stdin.once('error', (error) => {
      console.error(`Integration preview input failed: ${error.message}`);
      void shutdown(1);
    });
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        commands = commands.then(async () => {
          const command = line.trim();
          if (command === 'stop') return shutdown();
          if (command === 'restart-poll') await system.restartService('poll');
          else if (command === 'restart-voting') await system.restartService('voting');
          else if (command === 'stop-results') await system.stopService('results');
          else if (command === 'start-results') await system.startService('results');
          else if (command) console.log('Commands: restart-poll, restart-voting, stop-results, start-results, stop');
          if (['restart-poll', 'restart-voting', 'stop-results', 'start-results'].includes(command)) console.log(`${command}: complete.`);
        }).catch(async (error) => {
          console.error(`Integration preview command failed: ${error.message}`);
          await shutdown(1);
        });
      }
    });
  }
} catch (error) {
  console.error(`Integration preview could not start: ${error.message}`);
  await shutdown(1);
}
