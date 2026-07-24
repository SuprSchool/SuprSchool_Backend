import { createApp } from './app.js';
import { createRuntimeDependencies } from './config/dependencies.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const dependencies = createRuntimeDependencies(env);
const server = createApp(dependencies).listen(env.PORT, () => {
  process.stdout.write(`SuperSkool API listening on port ${env.PORT}\n`);
});

function stop(signal: NodeJS.Signals): void {
  server.close((error) => {
    if (error) {
      process.stderr.write(`${signal}: ${error.message}\n`);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
