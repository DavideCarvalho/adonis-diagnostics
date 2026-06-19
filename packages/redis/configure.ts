import type Configure from '@adonisjs/core/commands/configure';
import { stubsRoot } from './stubs/main.js';

/**
 * `node ace configure @agora/diagnostics-redis` — registers the provider and
 * publishes `config/diagnostics_redis.ts`.
 */
export async function configure(command: Configure) {
  const codemods = await command.createCodemods();

  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('@agora/diagnostics-redis/diagnostics_redis_provider');
  });

  await codemods.makeUsingStub(stubsRoot, 'config/diagnostics_redis.stub', {});
}
