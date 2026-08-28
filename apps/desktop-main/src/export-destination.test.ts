import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '@lucid-fin/storage';
import { WirePublicError } from './ipc/router.js';
import {
  createExportDestinationGateway,
  type ExportDestinationPickerResult,
} from './export-destination.js';

const context: CommandContext = {
  actor: 'user',
  causation: { kind: 'direct_ui', actionId: 'action.export-destination.1' },
  correlationId: 'correlation.export-destination.1',
};

const request = {
  wireVersion: 1,
  kind: 'request',
  requestId: 'request.export-destination.1',
  method: 'os.export.pick',
  input: {
    chatId: 'chat.export-destination.1',
    projectId: 'project.export-destination.1',
    deliveryPlan: {
      authority: 'delivery',
      id: 'delivery.export-destination.1',
      revision: 3,
      contentHash: 'b'.repeat(64),
    },
    destination: 'file',
    suggestedFileName: 'harbor-final.mp4',
    allowedExtensions: ['MP4'],
  },
} as const;

describe('export destination gateway', () => {
  it('fails closed without a main-owned picker adapter', async () => {
    const gateway = createExportDestinationGateway();

    await expect(gateway.pick(request, context)).rejects.toEqual(
      expect.objectContaining<WirePublicError>({
        descriptor: { code: 'unavailable', retryable: false },
      }),
    );
  });

  it('keeps a selected private destination in main, scopes it to the exact Project and Delivery plan, and binds it to one operation', async () => {
    let now = new Date('2026-08-26T12:00:00.000Z');
    let monotonicNow = 0;
    const privateWritableGrant = 'C:\\private\\exports\\harbor-final.mp4';
    const picker = {
      pick: vi.fn(async () => ({
        state: 'selected' as const,
        destination: 'file' as const,
        displayLabel: 'harbor-final.mp4',
        writableGrant: privateWritableGrant,
      })),
    };
    const gateway = createExportDestinationGateway({
      picker,
      now: () => now,
      monotonicNow: () => monotonicNow,
      createGrantId: () => 'grant.export-destination.1',
      createSecret: () => 'private-main-only-secret',
    });

    const selected = await gateway.pick(request, context);
    const expectedHash = createHash('sha256').update('private-main-only-secret').digest('hex');
    expect(selected).toEqual({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'os.export.pick',
      result: {
        state: 'selected',
        grant: {
          destination: {
            kind: 'user_selected_file',
            grantId: 'grant.export-destination.1',
            grantHash: expectedHash,
            displayLabel: 'harbor-final.mp4',
            projectId: request.input.projectId,
            deliveryPlan: request.input.deliveryPlan,
            allowedExtensions: request.input.allowedExtensions,
          },
          expiresAt: '2026-08-26T12:05:00.000Z',
        },
      },
    });
    expect(JSON.stringify(selected)).not.toContain(privateWritableGrant);
    expect(picker.pick).toHaveBeenCalledWith(request.input);

    if (selected.result.state !== 'selected') throw new Error('Expected a selected destination');
    const { kind, grantId, grantHash, displayLabel } = selected.result.grant.destination;
    const descriptor = { kind, grantId, grantHash, displayLabel };
    await expect(
      gateway.resolve({
        descriptor,
        projectId: 'project.other.1',
        chatId: request.input.chatId,
        runId: 'run.export-destination.1',
        deliveryPlan: request.input.deliveryPlan,
        requiredExtension: 'mp4',
        operationFingerprint: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      gateway.resolve({
        descriptor,
        projectId: request.input.projectId,
        chatId: request.input.chatId,
        runId: 'run.export-destination.1',
        deliveryPlan: { ...request.input.deliveryPlan, revision: 4 },
        requiredExtension: 'mp4',
        operationFingerprint: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      gateway.resolve({
        descriptor,
        projectId: request.input.projectId,
        chatId: request.input.chatId,
        runId: 'run.export-destination.1',
        deliveryPlan: request.input.deliveryPlan,
        requiredExtension: 'mov',
        operationFingerprint: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const resolution = await gateway.resolve({
      descriptor,
      projectId: request.input.projectId,
      chatId: request.input.chatId,
      runId: 'run.export-destination.1',
      deliveryPlan: request.input.deliveryPlan,
      requiredExtension: 'mp4',
      operationFingerprint: 'a'.repeat(64),
    });
    expect(resolution).toEqual({
      descriptor,
      writableGrant: privateWritableGrant,
    });

    await expect(
      gateway.resolve({
        descriptor,
        projectId: request.input.projectId,
        chatId: 'chat.other.1',
        runId: 'run.export-destination.1',
        deliveryPlan: request.input.deliveryPlan,
        requiredExtension: 'mp4',
        operationFingerprint: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      gateway.resolve({
        descriptor,
        projectId: request.input.projectId,
        chatId: request.input.chatId,
        runId: 'run.export-destination.1',
        deliveryPlan: request.input.deliveryPlan,
        requiredExtension: 'mp4',
        operationFingerprint: 'b'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    now = new Date('2026-08-26T11:00:00.000Z');
    monotonicNow = 5 * 60 * 1_000;
    await expect(
      gateway.resolve({
        descriptor,
        projectId: request.input.projectId,
        chatId: request.input.chatId,
        runId: 'run.export-destination.1',
        deliveryPlan: request.input.deliveryPlan,
        requiredExtension: 'mp4',
        operationFingerprint: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('fails closed when the gateway closes while the picker is pending', async () => {
    let settlePicker!: (value: ExportDestinationPickerResult) => void;
    const selection = new Promise<ExportDestinationPickerResult>((resolve) => {
      settlePicker = resolve;
    });
    const createGrantId = vi.fn(() => 'grant.export-destination.close-race');
    const gateway = createExportDestinationGateway({
      picker: { pick: () => selection },
      createGrantId,
    });

    const pending = gateway.pick(request, context);
    gateway.close();
    settlePicker({
      state: 'selected',
      destination: 'file',
      displayLabel: 'harbor-final.mp4',
      writableGrant: 'C:\\private\\exports\\harbor-final.mp4',
    });

    await expect(pending).rejects.toEqual(
      expect.objectContaining<WirePublicError>({
        descriptor: { code: 'unavailable', retryable: false },
      }),
    );
    expect(createGrantId).not.toHaveBeenCalled();
  });

  it('rejects a selected file outside the requested extensions', async () => {
    const createGrantId = vi.fn(() => 'grant.export-destination.disallowed-extension');
    const gateway = createExportDestinationGateway({
      picker: {
        pick: async () => ({
          state: 'selected',
          destination: 'file',
          displayLabel: 'harbor-final.mov',
          writableGrant: 'C:\\private\\exports\\harbor-final.mov',
        }),
      },
      createGrantId,
    });

    await expect(gateway.pick(request, context)).rejects.toThrow(/extension/i);
    expect(createGrantId).not.toHaveBeenCalled();
  });

  it('never turns an unsafe picker label or private grant into a public picker result', async () => {
    const gateway = createExportDestinationGateway({
      picker: {
        pick: async () => ({
          state: 'selected',
          destination: 'file',
          displayLabel: 'C:\\private\\exports\\harbor-final.mp4',
          writableGrant: 'C:\\private\\exports\\harbor-final.mp4',
        }),
      },
    });

    await expect(gateway.pick(request, context)).rejects.toBeInstanceOf(Error);
  });
});
