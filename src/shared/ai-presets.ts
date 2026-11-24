export const DEEPSEEK_DEFAULTS = {
  url: 'https://api.deepseek.com',
  model: 'deepseek-chat',
} as const;

export interface AiPlatformLink {
  id: string;
  label: string;
  url: string;
  hostHint?: string;
  desc: string;
}

export const AI_PLATFORM_LINKS: Record<string, AiPlatformLink> = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek 开放平台',
    url: 'https://platform.deepseek.com/api_keys',
    hostHint: 'api.deepseek.com',
    desc: '官方对话 / 判分推理 API Key',
  },
  siliconflow: {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    url: 'https://cloud.siliconflow.cn/account/ak',
    hostHint: 'api.siliconflow.cn',
    desc: '一站式提供 Qwen-VL / DeepSeek-OCR / DeepSeek-V3',
  },
  dashscope: {
    id: 'dashscope',
    label: '阿里云百炼 DashScope',
    url: 'https://bailian.console.aliyun.com/',
    hostHint: 'dashscope.aliyuncs.com',
    desc: '通义千问 Qwen-VL-Max / qwen-vl-ocr 专用视觉模型',
  },
  zhipu: {
    id: 'zhipu',
    label: '智谱开放平台',
    url: 'https://open.bigmodel.cn/usercenter/apikeys',
    hostHint: 'open.bigmodel.cn',
    desc: 'GLM-4V 视觉与 GLM-4 推理模型',
  },
  volcengine: {
    id: 'volcengine',
    label: '火山方舟（豆包）',
    url: 'https://console.volcengine.com/ark',
    hostHint: 'volces.com',
    desc: '豆包视觉与通用模型接入点',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama 官网',
    url: 'https://ollama.com/',
    hostHint: '127.0.0.1:11434',
    desc: '本机离线运行 Qwen2.5-VL，免 API Key',
  },
  doc2x: {
    id: 'doc2x',
    label: 'Doc2X 官网',
    url: 'https://doc2x.noedgeai.com/',
    hostHint: 'doc2x.noedgeai.com',
    desc: '物理试卷/复杂公式专业版面解析 Key',
  },
  pix2text: {
    id: 'pix2text',
    label: 'Pix2Text 部署说明',
    url: 'https://github.com/breezedeus/Pix2Text',
    hostHint: '127.0.0.1:8500',
    desc: '开源本机公式+文字 HTTP OCR 服务',
  },
  paddleocr: {
    id: 'paddleocr',
    label: 'PaddleOCR 部署说明',
    url: 'https://github.com/PaddlePaddle/PaddleOCR',
    hostHint: '127.0.0.1:8866',
    desc: '开源本机中文手写/印刷体 HTTP OCR',
  },
};

export const AI_PRESETS = {
  general: [
    {
      id: 'deepseek',
      label: 'DeepSeek 官方',
      provider: 'deepseek' as const,
      url: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      platformId: 'deepseek',
    },
    {
      id: 'siliconflow',
      label: '硅基流动 DeepSeek-V3',
      provider: 'custom' as const,
      url: 'https://api.siliconflow.cn/v1',
      model: 'deepseek-ai/DeepSeek-V3',
      platformId: 'siliconflow',
    },
    {
      id: 'dashscope',
      label: '阿里云百炼 Qwen',
      provider: 'custom' as const,
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      platformId: 'dashscope',
    },
    {
      id: 'zhipu',
      label: '智谱 GLM-4',
      provider: 'custom' as const,
      url: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash',
      platformId: 'zhipu',
    },
    {
      id: 'doubao',
      label: '火山方舟（豆包）',
      provider: 'custom' as const,
      url: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-1-5-pro-32k',
      platformId: 'volcengine',
    },
    {
      id: 'ollama',
      label: '本机 Ollama',
      provider: 'custom' as const,
      url: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5:7b',
      platformId: 'ollama',
    },
  ],
  vision: [
    {
      id: 'qwen',
      label: '阿里云百炼 Qwen-VL',
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-vl-max',
      platformId: 'dashscope',
    },
    {
      id: 'siliconflow',
      label: '硅基流动 Qwen2.5-VL',
      url: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen2.5-VL-72B-Instruct',
      platformId: 'siliconflow',
    },
    {
      id: 'zhipu',
      label: '智谱 GLM-4V',
      url: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4v-flash',
      platformId: 'zhipu',
    },
    {
      id: 'doubao',
      label: '火山方舟（豆包 VL）',
      url: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-1-5-vision-pro-32k',
      platformId: 'volcengine',
    },
    {
      id: 'ollama',
      label: '本机 Ollama',
      url: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5vl:7b',
      platformId: 'ollama',
    },
  ],
  judge: [
    {
      id: 'deepseek-judge',
      label: 'DeepSeek 官方',
      url: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      platformId: 'deepseek',
    },
    {
      id: 'siliconflow-judge',
      label: '硅基 DeepSeek-V3',
      url: 'https://api.siliconflow.cn/v1',
      model: 'deepseek-ai/DeepSeek-V3',
      platformId: 'siliconflow',
    },
    {
      id: 'dashscope-judge',
      label: '百炼 Qwen-Plus',
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      platformId: 'dashscope',
    },
    {
      id: 'zhipu-judge',
      label: '智谱 GLM-4',
      url: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash',
      platformId: 'zhipu',
    },
  ],
  ocrModel: [
    {
      id: 'qwen-ocr',
      label: '百炼 qwen-vl-ocr',
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-vl-ocr',
      platformId: 'dashscope',
    },
    {
      id: 'silicon-ocr',
      label: '硅基 DeepSeek-OCR',
      url: 'https://api.siliconflow.cn/v1',
      model: 'deepseek-ai/DeepSeek-OCR',
      platformId: 'siliconflow',
    },
    {
      id: 'silicon-qwen-ocr',
      label: '硅基 Qwen2.5-VL-7B',
      url: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen2.5-VL-7B-Instruct',
      platformId: 'siliconflow',
    },
    {
      id: 'zhipu-ocr',
      label: '智谱 GLM-4V-Flash',
      url: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4v-flash',
      platformId: 'zhipu',
    },
    {
      id: 'ollama-ocr',
      label: '本机 Ollama',
      url: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5vl:7b',
      platformId: 'ollama',
    },
  ],
  ocrHttp: [
    {
      id: 'pix2text',
      label: '本机 Pix2Text (8500)',
      url: 'http://127.0.0.1:8500/ocr',
      platformId: 'pix2text',
    },
    {
      id: 'paddle',
      label: '本机 PaddleOCR (8866)',
      url: 'http://127.0.0.1:8866/ocr',
      platformId: 'paddleocr',
    },
  ],
} as const;

export function findPlatformLinkForUrl(url: string): AiPlatformLink | null {
  const lower = (url || '').trim().toLowerCase();
  if (!lower) return null;
  for (const link of Object.values(AI_PLATFORM_LINKS)) {
    if (link.hostHint && lower.includes(link.hostHint.toLowerCase())) {
      return link;
    }
  }
  return null;
}
