import { OpenAICompatibleLLM } from './openai-compatible-base.js';

export class GrokLLMAdapter extends OpenAICompatibleLLM {
  constructor() {
    super({
      id: 'grok',
      name: 'Grok',
      defaultBaseUrl: 'https://api.x.ai/v1',
      defaultModel: 'grok-3',
    });
  }
}
