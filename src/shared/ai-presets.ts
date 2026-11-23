export const DEEPSEEK_DEFAULTS = {
  url: 'https://api.deepseek.com',
  model: 'deepseek-chat',
} as const;

export const AI_PRESETS = {
  vision: [
    { id: 'qwen', label: '阿里云百炼 Qwen-VL', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' },
    { id: 'siliconflow', label: '硅基流动 VL', url: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-VL-72B-Instruct' },
    { id: 'zhipu', label: '智谱 GLM-4V', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash' },
    { id: 'doubao', label: '火山方舟（豆包）', url: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-1-5-vision-pro-32k' },
    { id: 'ollama', label: '本机 Ollama', url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5vl:7b' },
  ],
  ocrModel: [
    { id: 'qwen-ocr', label: '百炼 qwen-vl-ocr', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-ocr' },
    { id: 'silicon-ocr', label: '硅基 DeepSeek-OCR', url: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-OCR' },
    { id: 'ollama-ocr', label: '本机 Ollama', url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5vl:7b' },
  ],
  ocrHttp: [
    { id: 'pix2text', label: '本机 Pix2Text (8500)', url: 'http://127.0.0.1:8500/ocr' },
    { id: 'paddle', label: '本机 PaddleOCR (8866)', url: 'http://127.0.0.1:8866/ocr' },
  ],
} as const;
