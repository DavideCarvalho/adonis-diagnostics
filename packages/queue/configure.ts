import type Configure from '@adonisjs/core/commands/configure';
import { stubsRoot } from './stubs/main.js';

/**
 * `node ace configure @agora/diagnostics-queue` — registers the provider and
 * publishes `config/diagnostics_queue.ts`.
 */
export async function configure(command: Configure) {
  const codemods = await command.createCodemods();

  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('@agora/diagnostics-queue/diagnostics_queue_provider');
  });

  await codemods.makeUsingStub(stubsRoot, 'config/diagnostics_queue.stub', {});
}
