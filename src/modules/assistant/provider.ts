import { z } from 'zod';
import { AppError } from '../../app/model';
import { assistantToolCatalog, type ToolName } from './tools';
// Official defaults verified 2026-11-20: DeepSeek-V4.1-Flash official API model ID is "deepseek-flash" (native text + image).
export const DEEPSEEK_DEFAULTS = {
  url: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  displayName: 'DeepSeek-V4.1-Flash',
} as const;
export const VISION_PRESETS = [
  { id: 'qwen', label: '阿里云百炼 Qwen3-VL', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-vl-plus' },
  { id: 'siliconflow', label: '硅基流动 VL', url: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/deepseek-vl2' },
  { id: 'zhipu', label: '智谱 GLM-4.6V', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6v-flash' },
  { id: 'doubao', label: '火山方舟（豆包）', url: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6-vision' },
  { id: 'ollama', label: '本机 Ollama', url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5vl:7b' },
] as const;
export const OCR_MODEL_PRESETS = [
  { id: 'qwen-ocr', label: '百炼 qwen-vl-ocr', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-ocr' },
  { id: 'deepseek-ocr', label: '硅基 DeepSeek-OCR', url: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-OCR' },
  { id: 'glm-ocr', label: '智谱 GLM-4.6V-Flash', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6v-flash' },
  { id: 'ds-flash-ocr', label: 'DeepSeek 官方', url: 'https://api.deepseek.com', model: 'deepseek-flash' },
  { id: 'ollama-ocr', label: '本机 Ollama', url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5vl:7b' },
] as const;
export const OCR_HTTP_PRESETS = [
  { id: 'local-8500', label: '本机 Pix2Text (8500)', url: 'http://127.0.0.1:8500/ocr' },
  { id: 'local-8866', label: '本机 PaddleOCR (8866)', url: 'http://127.0.0.1:8866/ocr' },
] as const;
export type RemoteModelInfo = {
  id: string;
  name?: string;
  vision?: boolean;
};
export const connectionSchema = z
  .object({
    provider: z.enum(['deepseek', 'custom']),
    url: z.string().max(2000),
    model: z.string().trim().min(1).max(120),
    key: z.string().max(500),
  })
  .strict();
export type ConnectionInput = z.infer<typeof connectionSchema>;
export type ConnectionView = {
  provider: ConnectionInput['provider'];
  url: string;
  model: string;
  hasKey: boolean;
  endpoint: string;
};
export const gradingRoleSchema = z
  .object({
    mode: z.enum(['inherit', 'custom']),
    url: z.string().max(2000),
    model: z.string().max(120),
    key: z.string().max(500),
  })
  .strict();
export const ocrConfigSchema = z
  .object({
    mode: z.enum(['off', 'vision-model', 'http-ocr']),
    url: z.string().max(2000),
    model: z.string().max(120),
    key: z.string().max(500),
  })
  .strict();
export const gradingModelsSchema = z
  .object({
    vision: gradingRoleSchema,
    judge: gradingRoleSchema,
    ocr: ocrConfigSchema,
  })
  .strict();
export type GradingRoleInput = z.infer<typeof gradingRoleSchema>;
export type OcrConfigInput = z.infer<typeof ocrConfigSchema>;
export type GradingModelsInput = z.infer<typeof gradingModelsSchema>;
export type GradingRoleView = {
  mode: 'inherit' | 'custom';
  url: string;
  model: string;
  hasKey: boolean;
  ready: boolean;
  effectiveLabel: string;
};
export type GradingModelsView = {
  vision: GradingRoleView;
  judge: GradingRoleView;
  ocr: {
    mode: OcrConfigInput['mode'];
    url: string;
    model: string;
    hasKey: boolean;
    ready: boolean;
    effectiveLabel: string;
  };
};
function validateBaseUrl(input: string, label = 'API 地址') {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppError('AI_CONFIG', `请输入完整${label}，例如 https://example.com/v1`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new AppError('AI_CONFIG', `${label}须使用 HTTPS；本机 localhost 可使用 HTTP`);
  if (url.username || url.password || url.search || url.hash)
    throw new AppError('AI_CONFIG', `${label}不能包含账号密码、查询参数或片段；Key 请填在独立字段`);
  return url;
}
export function normalizeEndpoint(input: string) {
  const url = validateBaseUrl(input);
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  return url.toString();
}
export function normalizeModelsEndpoint(input: string) {
  const url = validateBaseUrl(input);
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '');
  url.pathname = `${path}/models`;
  return url.toString();
}
export function normalizeHttpEndpoint(input: string) {
  return validateBaseUrl(input, 'OCR 接口地址').toString();
}
const callSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal('function'),
  function: z.object({ name: z.string().min(1).max(120), arguments: z.string().max(50000) }),
});
const messageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().max(100000).nullable().optional(),
  tool_calls: z.array(callSchema).max(20).optional(),
  reasoning_content: z.string().max(200000).nullable().optional(),
});
const meanTool = {
  name: 'grades.physics_mean' as const,
  description: '读取教师当前指定考试及物理成绩列的平均分（分）和有效人数（人）。无需参数。',
  inputSchema: z.toJSONSchema(z.object({}).strict()),
};
type ModelTool = ToolName | typeof meanTool.name;
const modelTools = [...assistantToolCatalog, meanTool];
export function decodeToolReply(value: unknown, allowed: readonly ModelTool[]) {
  const envelope = z
      .object({
        choices: z
          .array(z.object({ message: messageSchema }))
          .min(1)
          .max(1),
      })
      .parse(value),
    message = envelope.choices[0].message;
  const calls = (message.tool_calls || []).map((call) => {
    const tool = modelTools.find((t) => t.name.replace(/\./g, '__') === call.function.name);
    if (!tool || !allowed.includes(tool.name as ModelTool))
      throw new AppError('AI_TOOL', '模型请求了未开放的工具，未执行');
    let args: unknown;
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      throw new AppError('AI_TOOL', '工具参数不是合法 JSON，未执行');
    }
    return { id: call.id, name: tool.name as ModelTool, args };
  });
  if (new Set(calls.map((c) => c.id)).size !== calls.length)
    throw new AppError('AI_TOOL', '工具调用 ID 重复，未执行');
  return { message, calls }; // Execution must still pass the tool session schema and host authorization.
}
function isLocalEndpoint(urlStr: string) {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(urlStr).hostname);
  } catch {
    return false;
  }
}
const HTTP_HINTS: Record<number, string> = {
  400: '请确认所选模型支持图文输入与当前参数',
  401: '请核对 Key',
  402: '请检查服务余额',
  403: '请检查服务权限',
  404: '请核对地址和模型名称',
  429: '请求受限，请稍后重试',
};
async function readBoundedText(response: Response, maxBytes: number) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      'AI_HTTP',
      `模型服务返回 HTTP ${response.status}，${HTTP_HINTS[response.status] || '请检查模型或服务状态'}`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('AI_HTTP', '服务未返回响应正文');
  const decoder = new TextDecoder();
  let size = 0,
    text = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError('AI_HTTP', '服务回复超过大小限制');
      }
      text += decoder.decode(part.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}
function extractChatText(value: unknown): string {
  const obj = value as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = obj?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
      .join('');
  }
  throw new AppError('AI_FORMAT', '模型未返回有效文本内容');
}
function extractOcrText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const data = JSON.parse(trimmed) as Record<string, unknown>;
    const pick = (v: unknown): string => {
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) {
        return v
          .map((item) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object') {
              const r = item as Record<string, unknown>;
              return String(r.text ?? r.content ?? r.markdown ?? r.words ?? '');
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }
      if (v && typeof v === 'object') {
        const r = v as Record<string, unknown>;
        return pick(r.text ?? r.markdown ?? r.result ?? r.results ?? r.lines ?? r.words_result ?? r.data ?? '');
      }
      return '';
    };
    const found = pick(data);
    if (found) return found.trim();
  } catch {
    return trimmed;
  }
  return trimmed;
}
type StoredRole = { mode: 'inherit' | 'custom'; url: string; model: string; key: string };
type StoredOcr = { mode: OcrConfigInput['mode']; url: string; model: string; key: string };
export class AssistantConnection {
  private settings = {
    provider: 'deepseek' as ConnectionInput['provider'],
    url: DEEPSEEK_DEFAULTS.url as string,
    model: DEEPSEEK_DEFAULTS.model as string,
  };
  private grading: { vision: StoredRole; judge: StoredRole; ocr: StoredOcr } = {
    vision: { mode: 'inherit', url: '', model: '', key: '' },
    judge: { mode: 'inherit', url: '', model: '', key: '' },
    ocr: { mode: 'off', url: '', model: '', key: '' },
  };
  private generation = 0;
  get revision() {
    return this.generation;
  }
  private key = '';
  view(): ConnectionView {
    return { ...this.settings, hasKey: !!this.key, endpoint: normalizeEndpoint(this.settings.url) };
  }
  gradingView(): GradingModelsView {
    const baseReady = !!this.key || isLocalEndpoint(this.settings.url);
    const roleView = (r: StoredRole): GradingRoleView => {
      if (r.mode === 'inherit') {
        return {
          mode: 'inherit',
          url: r.url,
          model: r.model,
          hasKey: !!r.key,
          ready: baseReady,
          effectiveLabel: `跟随统一（${this.settings.model}）`,
        };
      }
      const ready = !!r.url && !!r.model && (!!r.key || isLocalEndpoint(r.url));
      return {
        mode: 'custom',
        url: r.url,
        model: r.model,
        hasKey: !!r.key,
        ready,
        effectiveLabel: ready ? `自定义（${r.model}）` : '自定义（未完成配置）',
      };
    };
    const o = this.grading.ocr;
    const ocrReady =
      o.mode === 'off'
        ? false
        : o.mode === 'vision-model'
          ? !!o.url && !!o.model && (!!o.key || isLocalEndpoint(o.url))
          : !!o.url;
    const ocrLabel =
      o.mode === 'off'
        ? '未开启（单路最高 82%）'
        : o.mode === 'vision-model'
          ? `独立 OCR 模型（${o.model || '未填模型'}）`
          : `HTTP OCR（${o.url ? new URL(o.url).host : '未填地址'}）`;
    return {
      vision: roleView(this.grading.vision),
      judge: roleView(this.grading.judge),
      ocr: {
        mode: o.mode,
        url: o.url,
        model: o.model,
        hasKey: !!o.key,
        ready: ocrReady,
        effectiveLabel: ocrLabel,
      },
    };
  }
  configure(raw: ConnectionInput) {
    const input = connectionSchema.parse(raw),
      url = input.provider === 'deepseek' ? DEEPSEEK_DEFAULTS.url : input.url.trim(),
      endpoint = normalizeEndpoint(url);
    const supplied = input.key.trim();
    if (/[\r\n\s]/.test(supplied)) throw new AppError('AI_CONFIG', 'Key 中不能有空白或换行');
    const retained =
      endpoint === normalizeEndpoint(this.settings.url) && input.provider === this.settings.provider
        ? this.key
        : '';
    if (!supplied && !retained && !isLocalEndpoint(endpoint))
      throw new AppError('AI_CONFIG', '请输入此服务的 API Key');
    this.settings = { provider: input.provider, url, model: input.model };
    this.key = supplied || retained;
    this.generation++;
    return this.view();
  }
  configureGrading(raw: GradingModelsInput) {
    const input = gradingModelsSchema.parse(raw);
    const resolveRole = (next: GradingRoleInput, prev: StoredRole, label: string): StoredRole => {
      if (next.mode === 'inherit') return { ...prev, mode: 'inherit' };
      const url = next.url.trim(),
        model = next.model.trim(),
        supplied = next.key.trim();
      if (!url) throw new AppError('AI_CONFIG', `请填写${label}的 API 地址`);
      const endpoint = normalizeEndpoint(url);
      if (!model) throw new AppError('AI_CONFIG', `请填写${label}的模型名称`);
      if (/[\r\n\s]/.test(supplied)) throw new AppError('AI_CONFIG', `${label} Key 中不能有空白或换行`);
      const retained = prev.url && normalizeEndpoint(prev.url) === endpoint ? prev.key : '';
      if (!supplied && !retained && !isLocalEndpoint(endpoint))
        throw new AppError('AI_CONFIG', `请填写${label}的 API Key`);
      return { mode: 'custom', url, model, key: supplied || retained };
    };
    const nextVision = resolveRole(input.vision, this.grading.vision, '视觉识图模型');
    const nextJudge = resolveRole(input.judge, this.grading.judge, '得分点采纳模型');
    let nextOcr: StoredOcr = { ...this.grading.ocr, mode: 'off' };
    if (input.ocr.mode !== 'off') {
      const url = input.ocr.url.trim(),
        model = input.ocr.model.trim(),
        supplied = input.ocr.key.trim();
      if (!url) throw new AppError('AI_CONFIG', '请填写辅助 OCR 的接口地址');
      if (/[\r\n\s]/.test(supplied)) throw new AppError('AI_CONFIG', 'OCR Key 中不能有空白或换行');
      const normalized =
        input.ocr.mode === 'vision-model' ? normalizeEndpoint(url) : normalizeHttpEndpoint(url);
      if (input.ocr.mode === 'vision-model' && !model)
        throw new AppError('AI_CONFIG', '请填写辅助 OCR 模型的名称');
      const prevNorm =
        this.grading.ocr.url && this.grading.ocr.mode === input.ocr.mode
          ? input.ocr.mode === 'vision-model'
            ? normalizeEndpoint(this.grading.ocr.url)
            : normalizeHttpEndpoint(this.grading.ocr.url)
          : '';
      const retained = prevNorm === normalized ? this.grading.ocr.key : '';
      if (input.ocr.mode === 'vision-model' && !supplied && !retained && !isLocalEndpoint(normalized))
        throw new AppError('AI_CONFIG', '请填写辅助 OCR 模型的 API Key');
      nextOcr = { mode: input.ocr.mode, url, model, key: supplied || retained };
    }
    this.grading = { vision: nextVision, judge: nextJudge, ocr: nextOcr };
    this.generation++;
    return this.gradingView();
  }
  clear() {
    this.key = '';
    this.grading.vision.key = '';
    this.grading.judge.key = '';
    this.grading.ocr.key = '';
    this.generation++;
  }
  async listModels(
    params: { url: string; key: string; fallbackRole?: 'general' | 'vision' | 'judge' | 'ocr' },
    signal?: AbortSignal,
  ): Promise<RemoteModelInfo[]> {
    const modelsUrl = normalizeModelsEndpoint(params.url);
    let key = params.key.trim();
    if (/[\r\n\s]/.test(key)) throw new AppError('AI_CONFIG', 'Key 中不能有空白或换行');
    if (!key && params.fallbackRole) {
      const saved =
        params.fallbackRole === 'general'
          ? { url: this.settings.url, key: this.key }
          : params.fallbackRole === 'vision'
            ? this.grading.vision
            : params.fallbackRole === 'judge'
              ? this.grading.judge
              : this.grading.ocr;
      if (saved.key && saved.url) {
        try {
          if (normalizeModelsEndpoint(saved.url) === modelsUrl) key = saved.key;
        } catch {}
      }
    }
    if (!key && !isLocalEndpoint(modelsUrl))
      throw new AppError('AI_CONFIG', '请先填写 API Key 再拉取可用模型列表');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const response = await fetch(modelsUrl, {
      method: 'GET',
      redirect: 'error',
      headers,
      signal,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const raw = await readBoundedText(response, 2 * 1024 * 1024);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AppError('AI_FORMAT', '模型列表接口未返回合法 JSON');
    }
    const obj = parsed as { data?: unknown[]; models?: unknown[] };
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(obj?.data)
        ? obj.data
        : Array.isArray(obj?.models)
          ? obj.models
          : [];
    const seen = new Set<string>();
    const out: RemoteModelInfo[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const id = String(r.id ?? r.model ?? r.name ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const name = typeof r.name === 'string' && r.name.trim() && r.name.trim() !== id ? r.name.trim() : undefined;
      const modalities = Array.isArray(r.input_modalities)
        ? r.input_modalities
        : Array.isArray((r.architecture as Record<string, unknown> | undefined)?.input_modalities)
          ? ((r.architecture as Record<string, unknown>).input_modalities as unknown[])
          : null;
      const vision = modalities ? modalities.includes('image') : undefined;
      out.push({ id, name, vision });
    }
    if (!out.length) throw new AppError('AI_FORMAT', '该接口返回了空的模型列表，请手动填写模型 ID');
    return out;
  }
  private resolveGradingRole(role: 'vision' | 'judge') {
    const cfg = this.grading[role];
    if (cfg.mode === 'custom') {
      const endpoint = normalizeEndpoint(cfg.url);
      if (!cfg.key && !isLocalEndpoint(endpoint))
        throw new AppError('AI_CONFIG', `请先配置${role === 'vision' ? '视觉识图' : '评分推理'}模型的 API Key`);
      return { endpoint, model: cfg.model, key: cfg.key };
    }
    const endpoint = normalizeEndpoint(this.settings.url);
    if (!this.key && !isLocalEndpoint(endpoint))
      throw new AppError('AI_CONFIG', '请先在左下角「AI 助手设置」中填写工作台模型 API Key，或在阅卷设置中自定义模型');
    return { endpoint, model: this.settings.model, key: this.key };
  }
  async chatCompletion(
    role: 'vision' | 'judge',
    messages: unknown[],
    opts: { signal?: AbortSignal; maxTokens?: number; temperature?: number } = {},
  ): Promise<string> {
    const resolved = this.resolveGradingRole(role);
    const payload = JSON.stringify({
      model: resolved.model,
      messages,
      stream: false,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.1,
    });
    if (new TextEncoder().encode(payload).length > 10 * 1024 * 1024)
      throw new AppError('AI_BUDGET', '上传图片或上下文超过 10MB 限制，请适当裁剪或减少页数');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (resolved.key) headers.Authorization = `Bearer ${resolved.key}`;
    const response = await fetch(resolved.endpoint, {
      method: 'POST',
      redirect: 'error',
      headers,
      body: payload,
      signal: opts.signal,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const raw = await readBoundedText(response, 1024 * 1024);
    try {
      return extractChatText(JSON.parse(raw));
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('AI_FORMAT', '模型返回内容不是合法的聊天响应 JSON');
    }
  }
  async runOcr(imageDataUrl: string, signal?: AbortSignal): Promise<string | null> {
    const o = this.grading.ocr;
    if (o.mode === 'off') return null;
    if (o.mode === 'vision-model') {
      const endpoint = normalizeEndpoint(o.url);
      if (!o.key && !isLocalEndpoint(endpoint))
        throw new AppError('AI_CONFIG', '请先填写辅助 OCR 模型的 API Key');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (o.key) headers.Authorization = `Bearer ${o.key}`;
      const body = JSON.stringify({
        model: o.model,
        stream: false,
        max_tokens: 2048,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              '你是纯文字与数学/物理公式 OCR 抄录工具。请严格逐字逐符号抄录图片中手写内容，原样保留数字、小数点、正负号、单位和公式，严禁改正学生错误、严禁猜测补全、不要输出任何解释。',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请纯逐字抄录此图中的全部手写文字与公式：' },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      });
      const response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers,
        body,
        signal,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      const raw = await readBoundedText(response, 1024 * 1024);
      return extractChatText(JSON.parse(raw)).trim();
    }
    const endpoint = normalizeHttpEndpoint(o.url);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (o.key) headers.Authorization = `Bearer ${o.key}`;
    const rawBase64 = imageDataUrl.includes(',') ? imageDataUrl.split(',')[1] : imageDataUrl;
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers,
      body: JSON.stringify({ image: imageDataUrl, image_base64: rawBase64 }),
      signal,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const raw = await readBoundedText(response, 1024 * 1024);
    return extractOcrText(raw);
  }
  // Constructing an envelope does not send it. The live transport always supplies its own one-tool allowlist.
  prepareRequest(messages: unknown[], allowed: readonly ModelTool[], choice?: 'required' | 'none') {
    if (!this.key) throw new AppError('AI_CONFIG', '请先填写 API Key');
    if (
      !messages.length ||
      messages.length > 100 ||
      new TextEncoder().encode(JSON.stringify(messages)).length > 256 * 1024
    )
      throw new AppError('AI_BUDGET', '任务上下文超过候选请求预算');
    if (new Set(allowed).size !== allowed.length || allowed.length > 32)
      throw new AppError('AI_TOOL', '工具清单重复或过多');
    const tools = allowed.map((name) => {
      const tool = modelTools.find((t) => t.name === name);
      if (!tool) throw new AppError('AI_TOOL', '未知工具');
      const { $schema: _schema, ...parameters } = tool.inputSchema;
      return {
        type: 'function' as const,
        function: { name: name.replace(/\./g, '__'), description: tool.description, parameters },
      };
    });
    return {
      url: normalizeEndpoint(this.settings.url),
      method: 'POST' as const,
      redirect: 'error' as const,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
      body: JSON.stringify({
        model: this.settings.model,
        messages,
        tools,
        tool_choice: choice,
        stream: false,
        max_tokens: 4096,
        ...(this.settings.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
      }),
    };
  }
  async physicsReply(messages: unknown[], final: boolean, signal: AbortSignal, revision: number) {
    if (this.revision !== revision) throw new Error('连接设置已更改，请重新查询');
    const request = this.prepareRequest(
      messages,
      [meanTool.name],
      final ? 'none' : this.settings.provider === 'deepseek' ? 'required' : undefined,
    );
    const { url, ...init } = request;
    const response = await fetch(url, {
      ...init,
      signal,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const text = await readBoundedText(response, 256 * 1024);
    if (this.revision !== revision) throw new Error('连接设置已更改，请重新查询');
    try {
      return decodeToolReply(JSON.parse(text), final ? [] : [meanTool.name]);
    } catch {
      throw new Error('模型回复格式或工具调用不符合本次只读查询，已停止');
    }
  }
}
