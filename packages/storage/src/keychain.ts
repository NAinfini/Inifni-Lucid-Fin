import keytar from 'keytar';

const SERVICE_NAME = 'lucid-fin';

export interface KeychainOptions {
  onError?: (operation: string, error: unknown) => void;
}

export class Keychain {
  private readonly onError?: (operation: string, error: unknown) => void;

  constructor(options?: KeychainOptions) {
    this.onError = options?.onError;
  }

  async setKey(provider: string, apiKey: string): Promise<void> {
    try {
      await keytar.setPassword(SERVICE_NAME, provider, apiKey);
    } catch (error) {
      this.onError?.('setKey', error);
    }
  }

  async getKey(provider: string): Promise<string | null> {
    try {
      return await keytar.getPassword(SERVICE_NAME, provider);
    } catch (error) {
      this.onError?.('getKey', error);
      return null;
    }
  }

  async deleteKey(provider: string): Promise<boolean> {
    try {
      return await keytar.deletePassword(SERVICE_NAME, provider);
    } catch (error) {
      this.onError?.('deleteKey', error);
      return false;
    }
  }

  async isConfigured(provider: string): Promise<boolean> {
    try {
      const key = await keytar.getPassword(SERVICE_NAME, provider);
      return key !== null;
    } catch (error) {
      this.onError?.('isConfigured', error);
      return false;
    }
  }
}
