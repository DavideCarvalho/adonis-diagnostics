import type Configure from '@adonisjs/core/commands/configure';
import { stubsRoot } from './stubs/main.js';

/**
 * `node ace configure @agora/diagnostics` — auto-wires the package:
 *
 * 1. registers the service provider in `adonisrc.ts`;
 * 2. publishes `start/diagnostics.ts` (where handlers are registered) and
 *    registers it as a preload file.
 */
export async function configure(command: Configure) {
  const codemods = await command.createCodemods();

  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('@agora/diagnostics/diagnostics_provider');
    rcFile.addPreloadFile('#start/diagnostics');
  });

  await codemods.makeUsingStub(stubsRoot, 'start/diagnostics.stub', {});
}
