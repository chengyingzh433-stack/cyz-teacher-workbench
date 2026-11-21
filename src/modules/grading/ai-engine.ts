import { AppError } from '../../app/model';
import { calculateScores, parsePoints, points, type Rubric, type ScoreInput } from './score-policy';

export interface AiGateway {
  chatCompletion(
    role: 'vision' | 'judge',
    messages: unknown[],
    opts?: { signal?: AbortSignal; maxTokens?: number; temperature?: number },
  ): Promise<string>;
  runOcr(imageDataUrl: string, signal?: AbortSignal): Promise<string | null>;
}

export type Legibility = 'clear' | 'minor_edits' | 'messy' | 'illegible' | 'blank' | 'truncated';

export type PowerPreset = {
  threshold: number;
  label: string;
  short: string;
  desc: string;
  tone: 'success' | 'info' | 'warning' | 'danger';
};

export const POWER_PRESETS: readonly PowerPreset[] = [
  { threshold: 100, label: '纯人工把关', short: '纯把关', desc: '每份均暂停，给出建议分值由老师确认', tone: 'success' },
  { threshold: 88, label: '智能平衡（推荐）', short: '稳健挡', desc: '清晰高置信卷自动提交，涂改/冲突秒停', tone: 'info' },
  { threshold: 78, label: '高功率提速', short: '提速挡', desc: '轻微涂改放行，数值冲突与存疑点仍停', tone: 'warning' },
  { threshold: 68, label: '极限挂机', short: '强力挡', desc: '最大化自动率，4 条硬红线仍永不放行', tone: 'danger' },
] as const;

export type ImageGateResult = {
  ok: boolean;
  width: number;
  height: number;
  inkRatio: number | null;
  blankSuspected: boolean;
  reason: string;
};

export type TokenDiff = {
  kind: 'number' | 'unit';
  vlm: string;
  ocr: string;
  reason: string;
};

export type OcrComparison = {
  enabled: boolean;
  ocrText: string;
  agreementScore: number;
  matchedTokens: string[];
  conflicts: TokenDiff[];
  hasCriticalConflict: boolean;
  summary: string;
};

export type Stage1ScanResult = {
  restoredText: string;
  formulas: string[];
  legibility: Legibility;
  legibilityNote: string;
  ocr: OcrComparison;
  imageGate: ImageGateResult;
};

export type PointAdoption = {
  criterionId: string;
  status: 'full' | 'partial' | 'none' | 'uncertain';
  suggestedUnits: number;
  suggestedValue: string;
  quote: string;
  quoteVerified: boolean;
  reason: string;
};

export type ConfidenceBreakdown = {
  total: number;
  ocrScore: number;
  clarityScore: number;
  adoptionScore: number;
  ruleScore: number;
  cappedBy: string | null;
  redlines: string[];
  decision: 'auto' | 'manual';
  threshold: number;
  summary: string;
};

export type GradingResult = {
  scan: Stage1ScanResult;
  adoptions: PointAdoption[];
  totalUnits: number;
  maxUnits: number;
  overallComment: string;
  confidence: ConfidenceBreakdown;
  ruleError: string;
};

export type DraftCriterion = {
  unitLabel: string;
  unitMax: string;
  description: string;
  maxScore: string;
  stepScore: string;
  exclusiveGroup: string;
};

export type BreakdownResult = {
  referenceAnswer: string;
  criteria: DraftCriterion[];
};

const LEGIBILITY_SET = new Set<Legibility>(['clear', 'minor_edits', 'messy', 'illegible', 'blank', 'truncated']);

export const LEGIBILITY_LABELS: Record<Legibility, string> = {
  clear: '字迹清晰',
  minor_edits: '轻微涂改',
  messy: '潦草可辨',
  illegible: '无法辨认',
  blank: '疑似空白',
  truncated: '截断残缺',
};

/** Ported from AI-Marker-Suite's BlankDetector + garbage-image gate (Otsu binarization). */
export function analyzeRgbaInk(rgba: Uint8ClampedArray, width: number, height: number): ImageGateResult {
  if (width < 40 || height < 24) {
    return { ok: false, width, height, inkRatio: null, blankSuspected: false, reason: `图片尺寸过小 (${width}×${height})，疑似裁剪残片` };
  }
  const aspect = width / height;
  if (aspect > 22 || aspect < 1 / 22) {
    return { ok: false, width, height, inkRatio: null, blankSuspected: false, reason: `图片宽高比极端异常 (${width}×${height})，疑似废图` };
  }
  const totalPixels = Math.min(width * height, Math.floor(rgba.length / 4));
  if (totalPixels <= 0) {
    return { ok: false, width, height, inkRatio: null, blankSuspected: false, reason: '图像像素为空' };
  }
  const hist = new Uint32Array(256);
  for (let i = 0; i < totalPixels * 4; i += 4) {
    const gray = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    hist[gray]++;
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = -1, threshold = 160;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = totalPixels - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      threshold = t;
    }
  }
  const cutoff = Math.min(205, Math.max(85, threshold));
  let dark = 0;
  for (let i = 0; i <= cutoff; i++) dark += hist[i];
  const inkRatio = dark / totalPixels;
  // Detect virtually blank white/flat canvas (very little ink OR almost uniform brightness).
  const blankSuspected = inkRatio < 0.0025 || maxVar < 40;
  return {
    ok: true,
    width,
    height,
    inkRatio,
    blankSuspected,
    reason: blankSuspected ? `本地墨迹检测疑似空白（黑像素 ${(inkRatio * 100).toFixed(2)}%）` : '本地图像闸门通过',
  };
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new AppError('IMAGE', '无法读取图片内容'));
    reader.readAsDataURL(blob);
  });
}

export async function inspectImageBlob(blob: Blob): Promise<{ dataUrl: string; gate: ImageGateResult }> {
  const dataUrl = await blobToDataUrl(blob);
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return {
      dataUrl,
      gate: { ok: true, width: 0, height: 0, inkRatio: null, blankSuspected: false, reason: '跳过像素预检' },
    };
  }
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = dataUrl;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (w < 40 || h < 24 || w / h > 22 || h / w > 22) {
      return { dataUrl, gate: analyzeRgbaInk(new Uint8ClampedArray(0), w, h) };
    }
    const scale = Math.min(1, 480 / Math.max(w, h));
    const sw = Math.max(1, Math.round(w * scale)), sh = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { dataUrl, gate: { ok: true, width: w, height: h, inkRatio: null, blankSuspected: false, reason: '图像尺寸正常' } };
    }
    ctx.drawImage(img, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    const rawGate = analyzeRgbaInk(data, sw, sh);
    return { dataUrl, gate: { ...rawGate, width: w, height: h } };
  } catch {
    return {
      dataUrl,
      gate: { ok: false, width: 0, height: 0, inkRatio: null, blankSuspected: false, reason: '图片解码失败，无法送审' },
    };
  }
}

export function extractJsonObject<T = Record<string, unknown>>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new AppError('AI_FORMAT', '模型未返回有效的 JSON 结构');
  }
}

export function normalizeMathText(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[＋－＝（）]/g, (c) => ({ '＋': '+', '－': '-', '＝': '=', '（': '(', '）': ')' }[c] || c))
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1/$2')
    .replace(/\\text\s*\{([^{}]+)\}/g, '$1')
    .replace(/\\mathrm\s*\{([^{}]+)\}/g, '$1')
    .replace(/\\times|\\cdot|×|·/g, '*')
    .replace(/\\div|÷/g, '/')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\$/g, '')
    .replace(/[，。；：、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNIT_AFTER_NUM_RE =
  /(\d)\s*(m\/s\^?2|m\/s2|m\/s|km\/h|N\*m|kPa|Pa|Hz|mol|kg|cm|mm|km|kW|kJ|mA|mV|℃|Ω|%|N|J|W|V|A|s|m|g)(?![A-Za-z])/g;
const NUMBER_RE = /(?:^|[^A-Za-z\d._])([-+]?\d+(?:\.\d+)?(?:\/[1-9]\d*)?(?:\s*\*\s*10\^[-+]?\d+)?)/g;

function extractTokens(text: string): { numbers: string[]; units: string[] } {
  const norm = normalizeMathText(text);
  const units: string[] = [];
  const withoutUnits = norm.replace(UNIT_AFTER_NUM_RE, (_m, digit: string, unit: string) => {
    units.push(unit === 'm/s2' ? 'm/s^2' : unit);
    return `${digit} `;
  });
  const numbers: string[] = [];
  for (const m of withoutUnits.matchAll(NUMBER_RE)) {
    if (m[1]) numbers.push(m[1].replace(/\s+/g, ''));
  }
  return { numbers, units };
}

function multisetDiff(a: string[], b: string[]): { common: string[]; onlyA: string[]; onlyB: string[] } {
  const countsB = new Map<string, number>();
  for (const x of b) countsB.set(x, (countsB.get(x) || 0) + 1);
  const common: string[] = [];
  const onlyA: string[] = [];
  for (const x of a) {
    const left = countsB.get(x) || 0;
    if (left > 0) {
      common.push(x);
      countsB.set(x, left - 1);
    } else {
      onlyA.push(x);
    }
  }
  const onlyB: string[] = [];
  for (const [k, v] of countsB) {
    for (let i = 0; i < v; i++) onlyB.push(k);
  }
  return { common, onlyA, onlyB };
}

function bigramSimilarity(a: string, b: string): number {
  const sa = normalizeMathText(a).replace(/\s+/g, '').toLowerCase();
  const sb = normalizeMathText(b).replace(/\s+/g, '').toLowerCase();
  if (!sa && !sb) return 1;
  if (!sa || !sb) return 0;
  if (sa.length < 2 || sb.length < 2) return sa === sb ? 1 : 0;
  const map = new Map<string, number>();
  for (let i = 0; i < sa.length - 1; i++) {
    const g = sa.slice(i, i + 2);
    map.set(g, (map.get(g) || 0) + 1);
  }
  let inter = 0;
  for (let i = 0; i < sb.length - 1; i++) {
    const g = sb.slice(i, i + 2);
    const n = map.get(g) || 0;
    if (n > 0) {
      inter++;
      map.set(g, n - 1);
    }
  }
  return (2 * inter) / (sa.length - 1 + sb.length - 1);
}

/** Objective VLM × OCR key-token consistency check (0–40 points). */
export function compareVlmWithOcr(vlmText: string, ocrText: string | null): OcrComparison {
  if (ocrText === null) {
    return {
      enabled: false,
      ocrText: '',
      agreementScore: 28,
      matchedTokens: [],
      conflicts: [],
      hasCriticalConflict: false,
      summary: '未开启 OCR 交叉核对（单路模式，置信度上限 82%）',
    };
  }
  const cleanOcr = ocrText.trim();
  if (!cleanOcr) {
    return {
      enabled: true,
      ocrText: '',
      agreementScore: 10,
      matchedTokens: [],
      conflicts: [{ kind: 'number', vlm: vlmText.slice(0, 24), ocr: '（OCR 未识出内容）', reason: 'OCR 返回为空，与大模型结果冲突' }],
      hasCriticalConflict: true,
      summary: 'OCR 返回为空，与大模型识图不一致，建议人工核对',
    };
  }
  const vTok = extractTokens(vlmText);
  const oTok = extractTokens(cleanOcr);
  const numDiff = multisetDiff(vTok.numbers, oTok.numbers);
  const unitDiff = multisetDiff(vTok.units, oTok.units);
  const conflicts: TokenDiff[] = [];

  const maxNumPairs = Math.max(numDiff.onlyA.length, numDiff.onlyB.length);
  for (let i = 0; i < maxNumPairs; i++) {
    const v = numDiff.onlyA[i] || '（未出现）';
    const o = numDiff.onlyB[i] || '（未出现）';
    conflicts.push({ kind: 'number', vlm: v, ocr: o, reason: `数值分歧：大模型「${v}」 vs OCR「${o}」` });
  }
  const maxUnitPairs = Math.max(unitDiff.onlyA.length, unitDiff.onlyB.length);
  for (let i = 0; i < maxUnitPairs; i++) {
    const v = unitDiff.onlyA[i] || '（未出现）';
    const o = unitDiff.onlyB[i] || '（未出现）';
    conflicts.push({ kind: 'unit', vlm: v, ocr: o, reason: `单位分歧：大模型「${v}」 vs OCR「${o}」` });
  }

  const matchedTokens = [...numDiff.common, ...unitDiff.common];
  const sim = bigramSimilarity(vlmText, cleanOcr);
  const hasCriticalConflict = conflicts.length > 0;

  let agreementScore: number;
  if (!hasCriticalConflict) {
    agreementScore = sim >= 0.78 ? 40 : sim >= 0.55 ? 36 : 32;
  } else {
    const totalTok = matchedTokens.length + conflicts.length;
    const ratio = totalTok ? matchedTokens.length / totalTok : 0;
    agreementScore = Math.max(0, Math.min(10, Math.round(ratio * 10)));
  }

  const summary = hasCriticalConflict
    ? `发现 ${conflicts.length} 处关键数值/单位分歧（已标黄，置信度封顶 65%）`
    : `关键数值与单位完全一致（文本相似度 ${Math.round(sim * 100)}%）`;

  return {
    enabled: true,
    ocrText: cleanOcr,
    agreementScore,
    matchedTokens,
    conflicts,
    hasCriticalConflict,
    summary,
  };
}

/** Splits restored text into plain + yellow-highlighted conflict spans for safe React rendering. */
export function highlightScanSegments(
  text: string,
  conflicts: TokenDiff[],
): Array<{ text: string; conflict?: TokenDiff }> {
  const candidates: Array<{ pattern: string; conflict: TokenDiff }> = [];
  for (const c of conflicts) {
    if (!c.vlm || c.vlm === '（未出现）') continue;
    candidates.push({ pattern: c.vlm, conflict: c });
    if (c.vlm.includes('^2')) candidates.push({ pattern: c.vlm.replace(/\^2/g, '²'), conflict: c });
    if (c.vlm.includes('^3')) candidates.push({ pattern: c.vlm.replace(/\^3/g, '³'), conflict: c });
  }
  candidates.sort((a, b) => b.pattern.length - a.pattern.length);
  if (!candidates.length || !text) return [{ text }];
  const escaped = candidates.map((c) => c.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'g');
  const parts: Array<{ text: string; conflict?: TokenDiff }> = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ text: text.slice(last, idx) });
    const hit = candidates.find((n) => n.pattern === m[0])?.conflict;
    parts.push({ text: m[0], conflict: hit });
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length ? parts : [{ text }];
}

/** Verifies Stage-2's cited student quote genuinely exists in Stage-1's restored text. */
export function verifyQuoteInText(quote: string, scanText: string): boolean {
  const q = normalizeMathText(quote).replace(/\s+/g, '').toLowerCase();
  if (!q) return false;
  const s = normalizeMathText(scanText).replace(/\s+/g, '').toLowerCase();
  if (!s) return false;
  if (s.includes(q)) return true;
  if (q.length >= 6) {
    // Allow minor punctuation/spacing drift if at least 80% of 3-grams appear in scanText.
    let hits = 0;
    const total = q.length - 2;
    for (let i = 0; i < total; i++) {
      if (s.includes(q.slice(i, i + 3))) hits++;
    }
    return hits / total >= 0.8;
  }
  return false;
}

/** 4-Signal Objective Confidence Engine (0–100) + Caps + 4 Hard Redlines. */
export function computeObjectiveConfidence(params: {
  scan: Stage1ScanResult;
  adoptions: PointAdoption[];
  rubric: Rubric;
  ruleError: string;
  threshold: number;
}): ConfidenceBreakdown {
  const { scan, adoptions, rubric, ruleError, threshold } = params;
  const redlines: string[] = [];
  let cap = 100;
  let cappedBy: string | null = null;
  const applyCap = (limit: number, reason: string) => {
    if (limit < cap) {
      cap = limit;
      cappedBy = reason;
    }
  };

  // Signal 1: VLM × OCR consistency (0–40)
  const ocrScore = scan.ocr.agreementScore;
  if (!scan.ocr.enabled) {
    applyCap(82, '未开启 OCR 交叉核对（单路封顶 82%）');
  } else if (scan.ocr.hasCriticalConflict) {
    applyCap(65, 'VLM 与 OCR 存在关键数值/单位分歧（封顶 65%）');
  }

  // Signal 2: Image clarity & blank gate (0–20)
  let clarityScore = 20;
  if (!scan.imageGate.ok) {
    clarityScore = 0;
    redlines.push(`废图熔断：${scan.imageGate.reason}`);
  } else if (scan.imageGate.blankSuspected || scan.legibility === 'blank') {
    clarityScore = 0;
    redlines.push('疑似空白答卷：严禁静默判 0 分，请人工看原图确认');
  } else if (scan.legibility === 'illegible' || scan.legibility === 'truncated') {
    clarityScore = 0;
    redlines.push(`图像${LEGIBILITY_LABELS[scan.legibility]}：实在无法可靠识别，已暂停提醒人工打分`);
  } else if (!scan.restoredText.trim()) {
    clarityScore = 0;
    redlines.push('扫描复原内容为空：请人工看原图裁定');
  } else if (scan.legibility === 'minor_edits') {
    clarityScore = 12;
  } else if (scan.legibility === 'messy') {
    clarityScore = 5;
    applyCap(75, '笔迹较潦草（封顶 75%）');
  }

  // Signal 3: Adoption certainty & quote grounding (0–25)
  let adoptionScore = 25;
  const uncertainCount = adoptions.filter((a) => a.status === 'uncertain').length;
  if (uncertainCount > 0) {
    adoptionScore = Math.max(0, adoptionScore - uncertainCount * 12);
    applyCap(78, `有 ${uncertainCount} 个得分点处于边界存疑（封顶 78%）`);
  }
  const fabricatedQuotes = adoptions.filter((a) => a.suggestedUnits > 0 && !a.quoteVerified).length;
  if (fabricatedQuotes > 0) {
    adoptionScore = 0;
    applyCap(60, `有 ${fabricatedQuotes} 处给分依据未在扫描原文中锚定（封顶 60%）`);
  }

  // Signal 4: Rule & format integrity (0–15)
  let ruleScore = 15;
  if (ruleError) {
    ruleScore = 0;
    redlines.push(`评分规则校验失败：${ruleError}`);
  } else if (adoptions.length !== rubric.criteria.length) {
    ruleScore = 0;
    redlines.push('模型返回的得分点数量与评分细则不匹配');
  } else {
    for (const a of adoptions) {
      const c = rubric.criteria.find((x) => x.id === a.criterionId);
      if (!c) {
        ruleScore = 0;
        redlines.push('模型返回了未知的得分点编号');
        break;
      }
      if (a.status === 'none' && a.suggestedUnits > 0) {
        ruleScore = 0;
        redlines.push(`逻辑矛盾：得分点标为「未命中」却给了 ${points(a.suggestedUnits)} 分`);
        break;
      }
      if (a.status === 'full' && a.suggestedUnits < c.maxUnits) {
        ruleScore = 0;
        redlines.push(`逻辑矛盾：得分点标为「满分命中」但分值不足上限`);
        break;
      }
    }
  }

  const rawSum = ocrScore + clarityScore + adoptionScore + ruleScore;
  const total = redlines.length > 0 ? 0 : Math.max(0, Math.min(cap, rawSum));
  const decision: 'auto' | 'manual' =
    redlines.length === 0 && threshold < 100 && total >= threshold ? 'auto' : 'manual';

  let summary = '';
  if (redlines.length > 0) {
    summary = redlines[0];
  } else if (threshold >= 100) {
    summary = `当前为纯人工把关模式（置信度 ${total}%），请核对后确认`;
  } else if (decision === 'auto') {
    summary = `置信度 ${total}% >= 设定阈值 ${threshold}%，满足自动直出条件`;
  } else {
    summary = `置信度 ${total}% < 设定阈值 ${threshold}%${cappedBy ? `（${cappedBy}）` : ''}，已暂停提醒人工`;
  }

  return {
    total,
    ocrScore,
    clarityScore,
    adoptionScore,
    ruleScore,
    cappedBy: redlines.length > 0 ? null : cappedBy,
    redlines,
    decision,
    threshold,
    summary,
  };
}

/** Reference answer (text and/or image) -> AI one-click rubric scoring points breakdown. */
export async function breakdownReferenceAnswer(
  gateway: AiGateway,
  params: { prompt: string; referenceAnswer: string; referenceImages: string[]; totalScoreHint?: string },
  signal?: AbortSignal,
): Promise<BreakdownResult> {
  const hasImages = params.referenceImages.length > 0;
  if (!params.referenceAnswer.trim() && !hasImages) {
    throw new AppError('GRADING', '请先粘贴参考答案文字或上传参考答案图片，再点击 AI 拆解');
  }
  const sys =
    '你是资深中学理科阅卷教研员。请把参考答案拆解为清晰、可独立判定、互不重叠的「得分点清单」。' +
    '严格输出纯 JSON（不要加多余解释），格式如下：\n' +
    '{"referenceAnswer":"整理后的完整参考答案","criteria":[{"unitLabel":"第 1 小题","unitMax":"6","description":"写出牛顿第二定律 F=ma（等价表达式亦可）","maxScore":"2","stepScore":"1","exclusiveGroup":""}]}\n' +
    '要求：1) 每个得分点对应明确步骤/公式/结论；2) 同题若含多小题请分别用 unitLabel 区分，且同一 unitLabel 下所有非互斥得分点 maxScore 之和严格等于 unitMax；3) 分值必须是合法非负数字（如 1、2、0.5），stepScore 通常为 0.5 或 1。';
  const userText = [
    params.prompt.trim() ? `【题干】\n${params.prompt.trim()}` : '',
    params.referenceAnswer.trim() ? `【参考答案】\n${params.referenceAnswer.trim()}` : '【参考答案】请识别参考答案图片并整理文字。',
    params.totalScoreHint ? `【参考总分提示】${params.totalScoreHint} 分` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const userContent = hasImages
    ? [
        { type: 'text', text: userText },
        ...params.referenceImages.slice(0, 4).map((url) => ({ type: 'image_url', image_url: { url } })),
      ]
    : userText;

  const raw = await gateway.chatCompletion(
    hasImages ? 'vision' : 'judge',
    [
      { role: 'system', content: sys },
      { role: 'user', content: userContent },
    ],
    { signal, maxTokens: 2048, temperature: 0.1 },
  );
  const parsed = extractJsonObject<{ referenceAnswer?: unknown; criteria?: unknown[] }>(raw);
  const rows = Array.isArray(parsed.criteria) ? parsed.criteria : [];
  if (!rows.length) throw new AppError('AI_FORMAT', 'AI 未能拆出有效得分点，请补充参考答案后重试');

  const criteria: DraftCriterion[] = rows.slice(0, 30).map((item, idx) => {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const maxScore = String(r.maxScore ?? '2').trim();
    const stepScore = String(r.stepScore ?? '0.5').trim();
    const unitMax = String(r.unitMax ?? maxScore).trim();
    // Validate numeric strings safely; fall back to clean defaults
    const safeScore = (s: string, fb: string) => {
      try {
        return points(parsePoints(s));
      } catch {
        return fb;
      }
    };
    const m = safeScore(maxScore, '2');
    const st = safeScore(stepScore, '0.5');
    return {
      unitLabel: String(r.unitLabel || '第 1 小题').trim().slice(0, 60),
      unitMax: safeScore(unitMax, m),
      description: String(r.description || `得分点 ${idx + 1}`).trim().slice(0, 500),
      maxScore: m,
      stepScore: parsePoints(st) > parsePoints(m) || parsePoints(st) === 0 ? m : st,
      exclusiveGroup: String(r.exclusiveGroup || '').trim().slice(0, 60),
    };
  });

  return {
    referenceAnswer: String(parsed.referenceAnswer || params.referenceAnswer || '').trim(),
    criteria,
  };
}

/** Stage 1: Blind VLM Restoration (ZERO reference answer!) + parallel independent OCR cross-check. */
export async function runBlindScanStage(
  gateway: AiGateway,
  params: {
    imageDataUrls: string[];
    imageGate: ImageGateResult;
    typedText?: string;
    subjectHint?: string;
  },
  signal?: AbortSignal,
): Promise<Stage1ScanResult> {
  // Fast local hard-redline short-circuit for broken / blank images (saves model cost!)
  if (!params.imageDataUrls.length && params.typedText?.trim()) {
    return {
      restoredText: params.typedText.trim(),
      formulas: [],
      legibility: 'clear',
      legibilityNote: '文字作答（无需识图）',
      ocr: compareVlmWithOcr(params.typedText.trim(), null),
      imageGate: { ok: true, width: 0, height: 0, inkRatio: null, blankSuspected: false, reason: '纯文字作答' },
    };
  }
  if (!params.imageDataUrls.length) {
    throw new AppError('GRADING', '请先上传或粘贴学生答卷图片');
  }
  if (!params.imageGate.ok || params.imageGate.blankSuspected) {
    return {
      restoredText: '',
      formulas: [],
      legibility: params.imageGate.blankSuspected ? 'blank' : 'illegible',
      legibilityNote: params.imageGate.reason,
      ocr: compareVlmWithOcr('', null),
      imageGate: params.imageGate,
    };
  }

  const blindSystem =
    '你是严谨的手写答卷盲识图复原员。你的唯一任务是客观、逐字、逐公式复原学生在答题卡上手写的原始内容。\n' +
    '严禁事项：\n' +
    '1. 严禁改正学生的计算错误、符号错误或单位错误；学生写错什么就如实还原什么！\n' +
    '2. 严禁凭空脑补学生没写的步骤；涂改划掉的内容用 [涂改] 标出，实在看不清的字标 [模糊]；\n' +
    '3. 仅返回严格 JSON（不要附加其他文字）：\n' +
    '{"restoredText":"逐行复原的学生完整手写文字与公式","formulas":["提取的关键公式1","结果2"],"legibility":"clear|minor_edits|messy|illegible|blank|truncated","legibilityNote":"一句简短客观的字迹清晰度说明"}';

  const userParts = [
    {
      type: 'text',
      text: `请复原以下学生手写答卷图片中的原始内容${params.subjectHint ? `（学科背景：${params.subjectHint}，注意区分数字、正负号、小数点与单位）` : ''}：`,
    },
    ...params.imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];

  // Run Blind VLM and Independent OCR in parallel
  const [vlmRaw, ocrTexts] = await Promise.all([
    gateway.chatCompletion(
      'vision',
      [
        { role: 'system', content: blindSystem },
        { role: 'user', content: userParts },
      ],
      { signal, maxTokens: 2048, temperature: 0 },
    ),
    Promise.all(
      params.imageDataUrls.map(async (url) => {
        try {
          return await gateway.runOcr(url, signal);
        } catch (err) {
          if ((err as Error).name === 'AbortError') throw err;
          return `【OCR调用失败: ${(err as Error).message}】`;
        }
      }),
    ),
  ]);

  const parsed = extractJsonObject<{
    restoredText?: unknown;
    formulas?: unknown[];
    legibility?: unknown;
    legibilityNote?: unknown;
  }>(vlmRaw);
  const restoredText = String(parsed.restoredText ?? '').trim();
  const formulas = Array.isArray(parsed.formulas) ? parsed.formulas.map((x) => String(x).trim()).filter(Boolean) : [];
  const rawLeg = String(parsed.legibility || 'clear') as Legibility;
  const legibility: Legibility = LEGIBILITY_SET.has(rawLeg) ? rawLeg : 'messy';
  const legibilityNote = String(parsed.legibilityNote || LEGIBILITY_LABELS[legibility]).trim();

  const ocrEnabled = ocrTexts.some((t) => t !== null);
  const combinedOcr = ocrEnabled ? ocrTexts.filter((t): t is string => t !== null).join('\n').trim() : null;
  const ocr = compareVlmWithOcr(restoredText, combinedOcr);

  return {
    restoredText,
    formulas,
    legibility,
    legibilityNote,
    ocr,
    imageGate: params.imageGate,
  };
}

/** Stage 2: Score adoption against rubric points based purely on scanned/edited text + objective confidence. */
export async function runScoringStage(
  gateway: AiGateway,
  params: {
    scan: Stage1ScanResult;
    scanText: string;
    rubric: Rubric;
    itemPrompt: string;
    threshold: number;
  },
  signal?: AbortSignal,
): Promise<GradingResult> {
  const { scan, scanText, rubric, itemPrompt, threshold } = params;
  const maxUnits = rubric.criteria.reduce((s, c) => s + c.maxUnits, 0);

  // If Stage 1 already hit blank/illegible/broken-image redline and teacher hasn't manually typed restored text, stop immediately.
  if (
    (!scan.imageGate.ok || scan.imageGate.blankSuspected || ['illegible', 'blank', 'truncated'].includes(scan.legibility)) &&
    !scanText.trim()
  ) {
    const emptyAdoptions: PointAdoption[] = rubric.criteria.map((c) => ({
      criterionId: c.id,
      status: 'uncertain',
      suggestedUnits: 0,
      suggestedValue: '',
      quote: '',
      quoteVerified: false,
      reason: '答卷无法可靠识别，等待人工查看原图判分',
    }));
    const confidence = computeObjectiveConfidence({
      scan,
      adoptions: emptyAdoptions,
      rubric,
      ruleError: '',
      threshold,
    });
    return {
      scan,
      adoptions: emptyAdoptions,
      totalUnits: 0,
      maxUnits,
      overallComment: '图像疑似空白或无法识别，已暂停提醒人工打分',
      confidence,
      ruleError: '',
    };
  }

  const criteriaSpec = rubric.criteria.map((c, idx) => ({
    index: idx + 1,
    criterionId: c.id,
    description: c.description,
    maxScore: points(c.maxUnits),
    stepScore: points(c.stepUnits),
    exclusiveGroup: c.exclusiveGroup || '',
  }));

  const judgeSystem =
    '你是严谨的中学阅卷得分点采纳评审器。请仅根据「扫描复原出的学生作答」对照「参考答案与得分点清单」，逐条判定得分点采纳情况。\n' +
    '硬性要求：\n' +
    '1. 只能依据学生作答中真实写出的内容给分，严禁脑补未写出的公式或步骤；\n' +
    '2. 每条得分点必须返回 suggestedScore（必须是 0 到 maxScore 之间、且是 stepScore 的整数倍）；\n' +
    '3. 若给分大于 0，quote 必须逐字摘录「学生作答」中的真实原文片段作为证据；\n' +
    '4. 遇到跳步、涂改歧义或边缘写法请将 status 标为 "uncertain"，不要强行武断；\n' +
    '5. 仅输出严格 JSON（不要加多余文字）：\n' +
    '{"adoptions":[{"criterionId":"对应ID","status":"full|partial|none|uncertain","suggestedScore":"2","quote":"摘自学生作答的原文","reason":"简短判定理由"}],"overallComment":"一句简短总评"}';

  const judgeUser = JSON.stringify(
    {
      questionPrompt: itemPrompt.trim() || '（未填题干）',
      referenceAnswer: rubric.referenceAnswer.trim() || '（见得分点清单）',
      criteria: criteriaSpec,
      studentScannedAnswer: scanText.trim(),
    },
    null,
    2,
  );

  const raw = await gateway.chatCompletion(
    'judge',
    [
      { role: 'system', content: judgeSystem },
      { role: 'user', content: judgeUser },
    ],
    { signal, maxTokens: 2048, temperature: 0 },
  );

  const parsed = extractJsonObject<{ adoptions?: unknown[]; overallComment?: unknown }>(raw);
  const rawList = Array.isArray(parsed.adoptions) ? parsed.adoptions : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rawList) {
    if (row && typeof row === 'object' && typeof (row as Record<string, unknown>).criterionId === 'string') {
      byId.set((row as Record<string, unknown>).criterionId as string, row as Record<string, unknown>);
    }
  }

  let ruleError = '';
  const adoptions: PointAdoption[] = rubric.criteria.map((c) => {
    const r = byId.get(c.id);
    if (!r) {
      ruleError = ruleError || `缺少得分点「${c.description.slice(0, 18)}」的判定`;
      return {
        criterionId: c.id,
        status: 'uncertain',
        suggestedUnits: 0,
        suggestedValue: '0',
        quote: '',
        quoteVerified: false,
        reason: '模型遗漏该得分点',
      };
    }
    const rawVal = String(r.suggestedScore ?? '0').trim();
    let units = 0;
    try {
      units = parsePoints(rawVal);
    } catch (e) {
      ruleError = ruleError || (e as Error).message;
    }
    const rawStatus = String(r.status || 'uncertain');
    const status: PointAdoption['status'] =
      rawStatus === 'full' || rawStatus === 'partial' || rawStatus === 'none' || rawStatus === 'uncertain'
        ? rawStatus
        : 'uncertain';
    const quote = String(r.quote || '').trim();
    const quoteVerified = units === 0 ? true : verifyQuoteInText(quote, scanText);
    return {
      criterionId: c.id,
      status,
      suggestedUnits: units,
      suggestedValue: rawVal,
      quote,
      quoteVerified,
      reason: String(r.reason || '').trim(),
    };
  });

  // Deterministic total score + policy check via existing score-policy.ts!
  let totalUnits = 0;
  if (!ruleError) {
    try {
      const scoreInputs: ScoreInput[] = adoptions.map((a) => ({
        criterionId: a.criterionId,
        value: a.suggestedValue,
        reason: a.reason,
      }));
      const calc = calculateScores(rubric, scoreInputs);
      totalUnits = calc.totalUnits;
    } catch (e) {
      ruleError = (e as Error).message;
      totalUnits = adoptions.reduce((s, a) => s + a.suggestedUnits, 0);
    }
  } else {
    totalUnits = adoptions.reduce((s, a) => s + a.suggestedUnits, 0);
  }

  // Re-evaluate confidence with teacher's possibly edited scanText (if teacher manually fixed text, reflect it cleanly)
  const effectiveScan: Stage1ScanResult =
    scanText.trim() !== scan.restoredText.trim()
      ? { ...scan, restoredText: scanText.trim() }
      : scan;

  const confidence = computeObjectiveConfidence({
    scan: effectiveScan,
    adoptions,
    rubric,
    ruleError,
    threshold,
  });

  return {
    scan: effectiveScan,
    adoptions,
    totalUnits,
    maxUnits,
    overallComment: String(parsed.overallComment || '').trim(),
    confidence,
    ruleError,
  };
}
