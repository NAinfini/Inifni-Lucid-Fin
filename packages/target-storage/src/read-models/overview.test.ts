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
import { createProjectOverviewReadModel } from './overview.js';

describe('Project Overview read model', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });

  it('projects active counts and accepted Runs from the authoritative store', async () => {
    const fixture = await createJourneyFixture();
    registerTargetStoreDatabase(fixture.store, getJourneyTestDatabase(fixture.store));
    cleanups.push(async () => {
      unregisterTargetStoreDatabase(fixture.store);
      fixture.store.close();
      await rm(fixture.directory, { force: true, recursive: true });
    });
    createHostCatalogProvisioning(fixture.store, { now: () => NOW }).registerProviderProfile({
      id: PROVIDER_ID,
      displayName: 'I2H Provider',
      providerKind: fixture.dependencies.generation.providerKind,
      model: PROVIDER_MODEL,
      status: 'ready',
    });
    const created = fixture.data.projects.create(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.overview.project.create.1',
        method: 'project.create',
        input: { name: 'Overview Film', permissionMode: 'full', budget, formatPolicy },
      },
      userContext,
    ).result;
    const chat = fixture.data.conversations.createChat(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.overview.chat.create.1',
        method: 'chat.create',
        input: { projectId: created.project.id, title: 'Director chat' },
      },
      userContext,
    ).result;
    const accepted = fixture.data.conversations.sendMessage(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.overview.message.send.1',
        method: 'message.send',
        input: {
          chatId: chat.id,
          blocks: [{ type: 'text', text: 'Build the opening sequence.' }],
          attachments: [],
          selectedContext: [],
          exportDestinationGrant: null,
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

    const response = createProjectOverviewReadModel(fixture.store).get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.overview.get.1',
      method: 'overview.get',
      input: { projectId: created.project.id },
    });
    expect(response.result.project).toEqual(created.project);
    expect(response.result.activeRuns).toEqual([accepted]);
    expect(response.result.taskLists).toEqual([]);
    expect(response.result.counts).toEqual({
      chats: 1,
      deliveryPlans: 0,
      media: 0,
      productionObjects: 0,
    });
  });

  it('excludes archived Chats from the active Overview count', async () => {
    const fixture = await createJourneyFixture();
    registerTargetStoreDatabase(fixture.store, getJourneyTestDatabase(fixture.store));
    cleanups.push(async () => {
      unregisterTargetStoreDatabase(fixture.store);
      fixture.store.close();
      await rm(fixture.directory, { force: true, recursive: true });
    });
    const project = fixture.data.projects.create(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.overview.project.create.2',
        method: 'project.create',
        input: { name: 'Quiet Film', permissionMode: 'full', budget, formatPolicy },
      },
      userContext,
    ).result.project;
    const chat = fixture.data.conversations.createChat(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.overview.chat.create.2',
        method: 'chat.create',
        input: { projectId: project.id, title: 'Archived chat' },
      },
      userContext,
    ).result;
    fixture.data.conversations.archiveChat(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.overview.chat.archive.2',
        method: 'chat.archive',
        input: { chatId: chat.id, expectedRevision: chat.revision },
      },
      userContext,
    );

    const response = createProjectOverviewReadModel(fixture.store).get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.overview.get.2',
      method: 'overview.get',
      input: { projectId: project.id },
    });
    expect(response.result.counts.chats).toBe(0);
  });
});
