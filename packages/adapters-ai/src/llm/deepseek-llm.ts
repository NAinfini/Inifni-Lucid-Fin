import { OpenAICompatibleLLM } from './openai-compatible-base.js';

export class DeepSeekLLMAdapter extends OpenAICompatibleLLM {
  constructor() {
    super({
      id: 'deepseek',
      name: 'DeepSeek',
      defaultBaseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-chat',
    });
  }
}
