import keytar from 'keytar';

const SERVICE_NAME = 'lucid-fin';

export class Keychain {
  async setKey(provider: string, apiKey: string): Promise<void> {
    await keytar.setPassword(SERVICE_NAME, provider, apiKey);
  }

  async getKey(provider: string): Promise<string | null> {
    return keytar.getPassword(SERVICE_NAME, provider);
  }

  async deleteKey(provider: string): Promise<boolean> {
    return keytar.deletePassword(SERVICE_NAME, provider);
  }

  async isConfigured(provider: string): Promise<boolean> {
    const key = await keytar.getPassword(SERVICE_NAME, provider);
    return key !== null;
  }
}
