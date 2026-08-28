import { app } from 'electron';
import { startElectronEntry } from '../../apps/desktop-main/dist/electron.js';
import { LOCAL_OLLAMA_PROVIDER_ID } from '../../apps/desktop-main/dist/production-adapters.js';
import { createProductionCompositionOptions } from '../../apps/desktop-main/dist/production-composition.js';

const recoverySecrets = new Map();
const keyFor = (service, account) => service + '\0' + account;
const recoveryKeyStore = Object.freeze({
  async getPassword(service, account) {
    return recoverySecrets.get(keyFor(service, account)) ?? null;
  },
  async setPassword(service, account, password) {
    recoverySecrets.set(keyFor(service, account), password);
  },
});

const fakeLocalModelFetch = async () =>
  new globalThis.Response(
    JSON.stringify({
      message: { content: 'The local E2E model accepted the Project brief.' },
      prompt_eval_count: 32,
      eval_count: 12,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

async function start() {
  await app.whenReady();
  const composition = await createProductionCompositionOptions({
    userDataPath: app.getPath('userData'),
    recoveryKeyStore,
    model: {
      provider: {
        providerId: LOCAL_OLLAMA_PROVIDER_ID,
        model: 'e2e-local-model',
        reasoningStrength: null,
      },
      fetch: fakeLocalModelFetch,
    },
    mediaPicker: Object.freeze({ pick: async () => null }),
  });

  await startElectronEntry({
    composition: {
      databasePath: composition.layout.databasePath,
      dataAccess: composition.dataAccess,
      provisionHost: composition.provisionHost,
      createAcceptanceSeedFor: composition.createAcceptanceSeedFor,
      exportDestinationPicker: Object.freeze({
        pick: async () => Object.freeze({ state: 'cancelled' }),
      }),
      pickMedia: composition.pickMedia,
      contextForRequest: (request) => composition.contextForRequest(request),
      createRuntime: composition.createRuntime,
      createPushRequestId: composition.createPushRequestId,
      reportStartup: composition.reportStartup,
      onInternalError: composition.onInternalError,
    },
  });
}

void start().catch((error) => {
  globalThis.console.error('[e2e] canonical desktop startup failed', error);
  app.exit(1);
});
