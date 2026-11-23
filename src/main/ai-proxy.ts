import type { DatabaseSync } from 'node:sqlite';
import { AppError, type AiChatMessage, type RemoteModelInfo } from '../shared/types';
import type { AiGateway } from '../shared/ai-engine';
import { formatScore } from '../shared/score-policy';
import { analyzeExamColumn, cellStatusLabels } from '../shared/gradebook/analysis';
import {
  AiKeychainStore,
  isLocalUrl,
  normalizeChatEndpoint,
  normalizeModelsEndpoint,
  validateApiBaseUrl,
} from './keychain';
import { getExamDetail } from './repositories/exams';
import { listRoster } from './repositories/classes';

const HTTP_HINTS: Record<number, string> = {
  400: '请确认所选模型支持当前图文/对话参数',
  401: 'API Key 无效或已过期，请在设置中核对',
  402: '账号余额不足，请检查服务商控制台',
  403: '无权限访问该模型或接口',
  404: '接口地址或模型 ID 不存在',
  429: '触发限流，请稍后再试',
};

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      // ignore
    }
    throw new AppError(
      'AI_HTTP',
      `模型服务返回 HTTP ${response.status}（${HTTP_HINTS[response.status] || '请检查服务状态'}）${detail ? `：${detail}` : ''}`,
    );
  }
  const buf = await response.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new AppError('AI_HTTP', '响应内容超过大小限制');
  return new TextDecoder('utf-8').decode(buf);
}

function extractChatText(value: unknown): string {
  const obj = value as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = obj?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : '',
      )
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
    return pick(data).trim() || trimmed;
  } catch {
    return trimmed;
  }
}

export class MainAiProxy implements AiGateway {
  constructor(private keychain: AiKeychainStore) {}

  async listModels(params: {
    url: string;
    key?: string;
    fallbackRole?: 'general' | 'vision' | 'judge' | 'ocr';
  }): Promise<RemoteModelInfo[]> {
    const modelsUrl = normalizeModelsEndpoint(params.url);
    let key = (params.key || '').trim();
    if (!key && params.fallbackRole) {
      key = this.keychain.resolveFallbackKey(params.fallbackRole, params.url);
    }
    if (!key && !isLocalUrl(modelsUrl)) {
      throw new AppError('AI_CONFIG', '请先填写 API Key 再拉取可用模型列表');
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const response = await fetch(modelsUrl, { method: 'GET', headers });
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
      const name =
        typeof r.name === 'string' && r.name.trim() && r.name.trim() !== id
          ? r.name.trim()
          : undefined;
      const modalities = Array.isArray(r.input_modalities)
        ? r.input_modalities
        : Array.isArray((r.architecture as Record<string, unknown> | undefined)?.input_modalities)
          ? ((r.architecture as Record<string, unknown>).input_modalities as unknown[])
          : null;
      const vision = modalities
        ? modalities.includes('image')
        : /vl|vision|gpt-4o|claude-3|gemini|glm-4v|qwen.*vl/i.test(id)
          ? true
          : undefined;
      out.push({ id, name, vision });
    }
    if (!out.length) throw new AppError('AI_FORMAT', '该接口返回了空模型列表，请手动填写模型 ID');
    return out;
  }

  async chatCompletion(
    role: 'vision' | 'judge' | 'general',
    messages: unknown[],
    opts: { signal?: AbortSignal; maxTokens?: number; temperature?: number } = {},
  ): Promise<string> {
    const resolved = this.keychain.resolveChatRole(role);
    const payload = JSON.stringify({
      model: resolved.model,
      messages,
      stream: false,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.2,
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (resolved.key) headers.Authorization = `Bearer ${resolved.key}`;
    const response = await fetch(resolved.endpoint, {
      method: 'POST',
      headers,
      body: payload,
      signal: opts.signal,
    });
    const raw = await readBoundedText(response, 2 * 1024 * 1024);
    try {
      return extractChatText(JSON.parse(raw));
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('AI_FORMAT', '模型返回内容不是合法 JSON');
    }
  }

  async runOcr(imageDataUrl: string, signal?: AbortSignal): Promise<string | null> {
    const o = this.keychain.resolveOcr();
    if (o.mode === 'off') return null;
    if (o.mode === 'vision-model') {
      const endpoint = normalizeChatEndpoint(o.url);
      if (!o.key && !isLocalUrl(endpoint)) {
        throw new AppError('AI_CONFIG', '请先配置辅助 OCR 模型的 API Key');
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (o.key) headers.Authorization = `Bearer ${o.key}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: o.model,
          stream: false,
          max_tokens: 2048,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                '你是纯文字与数学/物理公式 OCR 抄录工具。请严格逐字逐符号抄录图片中手写内容，原样保留数字、小数点、正负号、单位和公式，严禁改正学生错误，不要输出解释。',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: '请逐字抄录此图中的全部手写文字与公式：' },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ],
            },
          ],
        }),
      });
      const raw = await readBoundedText(response, 2 * 1024 * 1024);
      return extractChatText(JSON.parse(raw)).trim();
    }

    const endpoint = validateApiBaseUrl(o.url, 'OCR 接口地址').toString();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (o.key) headers.Authorization = `Bearer ${o.key}`;
    const rawBase64 = imageDataUrl.includes(',') ? imageDataUrl.split(',')[1] : imageDataUrl;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({ image: imageDataUrl, image_base64: rawBase64 }),
    });
    const raw = await readBoundedText(response, 2 * 1024 * 1024);
    return extractOcrText(raw);
  }

  /** Privacy-transparent read-only exam analytics AI tutor. */
  async chatExamTutor(
    db: DatabaseSync,
    params: {
      examId: string;
      columnId?: string;
      privacyMode: 'summary-only' | 'anonymized-rows';
      messages: AiChatMessage[];
    },
  ): Promise<{ reply: string; sentPreview: string }> {
    const detail = getExamDetail(db, params.examId);
    const members = listRoster(db, detail.exam.classId, false);
    const clsRow = db
      .prepare(`SELECT name FROM classes WHERE id = ?`)
      .get(detail.exam.classId) as { name: string } | undefined;

    const targetColId =
      params.columnId ||
      detail.columns.find((c) => c.role === 'total')?.id ||
      detail.columns[0]?.id ||
      'computed';

    const colSummaries = detail.columns.map((c) => {
      const a = analyzeExamColumn({
        columns: detail.columns,
        scores: detail.scores,
        members,
        columnId: c.id,
      });
      return {
        column: c.label,
        source: c.source,
        maxScore: formatScore(a.maxUnits),
        validCount: a.count,
        absent: a.statusCounts.absent,
        mean: formatScore(a.meanUnits),
        median: formatScore(a.medianUnits),
        max: formatScore(a.maxObservedUnits),
        min: formatScore(a.minUnits),
        stdDev: formatScore(a.stdDevUnits),
        passRate: a.passCount !== null && a.count ? `${((a.passCount / a.count) * 100).toFixed(1)}%` : '未设满分',
        excellentRate:
          a.excellentCount !== null && a.count
            ? `${((a.excellentCount / a.count) * 100).toFixed(1)}%`
            : '未设满分',
        distribution: a.bands.map((b) => `${b.label}: ${b.count}人(${b.pct.toFixed(1)}%)`),
      };
    });

    const contextObj: Record<string, unknown> = {
      className: clsRow?.name || '当前班级',
      examTitle: detail.exam.title,
      examDate: detail.exam.examDate,
      studentCount: members.length,
      focusColumn: detail.columns.find((c) => c.id === targetColId)?.label || '全部科目',
      columnSummaries: colSummaries,
    };

    if (params.privacyMode === 'anonymized-rows') {
      const scoreMap = new Map(detail.scores.map((s) => [`${s.membershipId}:${s.columnId}`, s]));
      contextObj.anonymizedStudents = members.slice(0, 120).map((m, idx) => {
        const rec: Record<string, string> = { student: `学生${idx + 1}` };
        for (const c of detail.columns) {
          const sc = scoreMap.get(`${m.membershipId}:${c.id}`);
          rec[c.label] = !sc
            ? '未录'
            : sc.status === 'score'
              ? formatScore(sc.units)
              : cellStatusLabels[sc.status];
        }
        return rec;
      });
    }

    const contextText = JSON.stringify(contextObj, null, 2);
    const systemPrompt =
      '你是中学资深教研与学情分析助教（只读模式，不修改数据）。请严格依据下方提供的本场考试统计数据，用简洁、结构化、可落地的教学建议回答老师的问题。\n' +
      '要求：1) 所有引用的均分、人数、百分比必须严格与提供数据一致，绝不编造；2) 若当前为「仅统计摘要」模式而老师问及个别学生明细，请提醒可切换至「匿名明细」模式；3) 尽量给出讲评重点、分层辅导建议或试卷难度诊断。\n\n' +
      `【本场考试数据上下文（${params.privacyMode === 'summary-only' ? '仅汇总统计，无个人记录' : '已脱敏匿名明细，无真实姓名学号'}）】\n${contextText}`;

    const recentMessages = params.messages.slice(-12).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 4000),
    }));

    const reply = await this.chatCompletion(
      'general',
      [{ role: 'system', content: systemPrompt }, ...recentMessages],
      { maxTokens: 2048, temperature: 0.3 },
    );

    return { reply, sentPreview: contextText };
  }

  /** Customize or expand a moral/safety lesson plan, parent script, or notice for the active class (zero student PII). */
  async generateHomeroomMaterial(
    db: DatabaseSync,
    params: {
      classId: string;
      theme: string;
      partLabel: string;
      baseContent?: string;
      customPrompt?: string;
    },
  ): Promise<{ content: string }> {
    const clsRow = db
      .prepare(`SELECT name, school, term_label FROM classes WHERE id = ?`)
      .get(params.classId) as { name: string; school: string; term_label: string } | undefined;
    const memberCnt = db
      .prepare(`SELECT COUNT(*) AS cnt FROM memberships WHERE class_id = ? AND status = 'active'`)
      .get(params.classId) as { cnt: number } | undefined;

    const systemPrompt =
      '你是经验丰富的中学班主任德育与家校沟通文案助手。请严格围绕老师指定的主题与场景，输出可直接用于班会宣讲、家长会发言或微信家长群发布的实用文本。\n' +
      '要求：1) 语气诚恳专业、接地气、无空话套话；2) 结构清晰、可直接复制使用；3) 严禁编造具体学生姓名或隐私信息。';

    const userPrompt = [
      `【班级背景】${clsRow?.school ? `${clsRow.school} ` : ''}${clsRow?.name || '当前班级'}${clsRow?.term_label ? `（${clsRow.term_label}）` : ''}，共约 ${memberCnt?.cnt || 0} 人。`,
      `【教育主题】${params.theme}`,
      `【目标板块】${params.partLabel}`,
      params.baseContent ? `【基础参考素材】\n${params.baseContent.slice(0, 3000)}` : '',
      params.customPrompt
        ? `【老师补充要求】\n${params.customPrompt.slice(0, 1200)}`
        : '【老师补充要求】请结合当前中学班级实际场景，优化润色并给出更具操作性与感染力的定制版本。',
    ]
      .filter(Boolean)
      .join('\n\n');

    const content = await this.chatCompletion(
      'general',
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { maxTokens: 2048, temperature: 0.55 },
    );
    return { content: content.trim() };
  }
}
