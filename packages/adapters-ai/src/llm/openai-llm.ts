import { OpenAICompatibleLLM } from './openai-compatible-base.js';

export class OpenAILLMAdapter extends OpenAICompatibleLLM {
  constructor() {
    super({
      id: 'openai',
      name: 'OpenAI GPT',
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4.1',
    });
  }
}
