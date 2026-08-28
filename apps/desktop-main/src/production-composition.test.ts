import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startDesktopComposition, type DesktopStartupState } from './composition-root.js';
import type { IpcMainLike } from './ipc/router.js';
import { LOCAL_OLLAMA_PROVIDER_ID, type RecoveryKeyStore } from './production-adapters.js';
import { createProductionCompositionOptions } from './production-composition.js';

class MemoryKeyStore implements RecoveryKeyStore {
  private password: string | null = null;

  async getPassword(): Promise<string | null> {
    return this.password;
  }

  async setPassword(_service: string, _account: string, password: string): Promise<void> {
    this.password = password;
  }
}

describe('production composition options', () => {
  it('composes a disposable canonical profile with persistent recovery and exact Ollama', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'lucid-fin-composition-'));
    try {
      const options = await createProductionCompositionOptions({
        userDataPath,
        recoveryKeyStore: new MemoryKeyStore(),
        model: {
          provider: {
            providerId: LOCAL_OLLAMA_PROVIDER_ID,
            model: 'qwen3:8b',
            reasoningStrength: null,
          },
        },
      });

      expect(options.layout.root).toBe(join(userDataPath, 'lucid-fin-v1'));
      expect(options.layout.databasePath).toBe(
        join(userDataPath, 'lucid-fin-v1', 'project.sqlite'),
      );
      expect(options.dataAccess.mediaCas).toBe(options.mediaCas);
      expect(options.model.provider).toEqual({
        providerId: LOCAL_OLLAMA_PROVIDER_ID,
        model: 'qwen3:8b',
        reasoningStrength: null,
      });
      const sealed = options.dataAccess.privateRecoveryCodec.seal({
        plaintext: new TextEncoder().encode('disposable'),
        aad: new TextEncoder().encode('test'),
      });
      expect(
        Buffer.from(
          options.dataAccess.privateRecoveryCodec.open({
            ...sealed,
            aad: new TextEncoder().encode('test'),
          }),
        ),
      ).toEqual(Buffer.from('disposable'));

      const startup: DesktopStartupState[] = [];
      const ipcMain: IpcMainLike<object> = {
        handle() {},
        removeHandler() {},
      };
      const composition = await startDesktopComposition({
        databasePath: options.layout.databasePath,
        dataAccess: options.dataAccess,
        provisionHost: options.provisionHost,
        createAcceptanceSeedFor: options.createAcceptanceSeedFor,
        pickMedia: options.pickMedia,
        ipcMain,
        authorizeInvocation: () => true,
        contextForRequest: (request) => options.contextForRequest(request),
        createRuntime: options.createRuntime,
        createPushRequestId: options.createPushRequestId,
        runEventSink: { send() {} },
        reportStartup: (state) => startup.push(state),
        onInternalError: () => undefined,
      });
      try {
        expect(composition.databaseCreated).toBe(true);
        expect(composition.builtInSkills.results).toHaveLength(287);
        expect(startup.at(-1)).toMatchObject({
          status: 'ready',
          databaseCreated: true,
          builtInSkillCount: 287,
        });
      } finally {
        await composition.close();
      }
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });
});
