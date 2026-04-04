import { OpenAICompatibleLLM } from './openai-compatible-base.js';

export class QwenLLMAdapter extends OpenAICompatibleLLM {
  constructor() {
    super({
      id: 'qwen',
      name: 'Qwen',
      defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      defaultModel: 'qwen-plus',
    });
  }
}
