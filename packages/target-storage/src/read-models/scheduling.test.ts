import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { createHostCatalogProvisioning } from '../host/index.js';
import {
  registerTargetStoreDatabase,
  unregisterTargetStoreDatabase,
} from '../internal/database-access.js';
import {
  NOW,
  PROVIDER_ID,
  PROVIDER_MODEL,
  ROOT_CATALOG,
  budget,
  createJourneyFixture,
  formatPolicy,
  getJourneyTestDatabase,
  userContext,
} from '../../test/i2h/fixture.js';
import { createRunSchedulingReadModel } from './scheduling.js';

describe('Run scheduling read model', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });

  it('lists only nonterminal Runs from the authoritative store', async () => {
    const fixture = await createJourneyFixture();
    registerTargetStoreDatabase(fixture.store, getJourneyTestDatabase(fixture.store));
    cleanups.push(async () => {
      unregisterTargetStoreDatabase(fixture.store);
      fixture.store.close();
      await rm(fixture.directory, { force: true, recursive: true });
    });
    createHostCatalogProvisioning(fixture.store, { now: () => NOW }).registerProviderProfile({
      id: PROVIDER_ID,
      displayName: 'Scheduling Provider',
      providerKind: fixture.dependencies.generation.providerKind,
      model: PROVIDER_MODEL,
      status: 'ready',
    });
    const project = fixture.data.projects.create(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.scheduling.project.1',
        method: 'project.create',
        input: { name: 'Scheduling Film', permissionMode: 'full', budget, formatPolicy },
      },
      userContext,
    ).result.project;
    const chat = fixture.data.conversations.createChat(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.scheduling.chat.1',
        method: 'chat.create',
        input: { projectId: project.id, title: 'Scheduling chat' },
      },
      userContext,
    ).result;
    const run = fixture.data.conversations.sendMessage(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.scheduling.message.1',
        method: 'message.send',
        input: {
          chatId: chat.id,
          blocks: [{ type: 'text', text: 'Start one schedulable Run.' }],
          attachments: [],
          selectedContext: [],
          supersedesMessageId: null,
        },
      },
      userContext,
      {
        model: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
        locale: 'en-US',
        timeZone: 'America/New_York',
        capabilityCatalog: ROOT_CATALOG,
        projectMediaSelections: [],
        citedMemoryEntryIds: [],
      },
    ).result.acceptedRun;
    const scheduling = createRunSchedulingReadModel(fixture.store);
    expect(scheduling.listNonterminal({ afterRunId: null, limit: 200 })).toEqual({
      runs: [run],
      nextAfterRunId: null,
    });

    fixture.data.runs.control(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.scheduling.cancel.1',
        method: 'run.control',
        input: {
          runId: run.id,
          expectedRevision: run.revision,
          action: 'cancel',
          expectedStatus: 'accepted',
          terminalSummary: 'Cancelled by the scheduling read-model test.',
        },
      },
      userContext,
    );
    expect(scheduling.listNonterminal({ afterRunId: null, limit: 200 })).toEqual({
      runs: [],
      nextAfterRunId: null,
    });
  });
});
