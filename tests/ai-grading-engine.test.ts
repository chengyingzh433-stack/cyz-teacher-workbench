import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistantConnection, normalizeModelsEndpoint } from '../src/modules/assistant/provider';
import {
  analyzeRgbaInk,
  breakdownReferenceAnswer,
  compareVlmWithOcr,
  computeObjectiveConfidence,
  highlightScanSegments,
  runBlindScanStage,
  runScoringStage,
  verifyQuoteInText,
  type AiGateway,
  type ImageGateResult,
} from '../src/modules/grading/ai-engine';
import type { Rubric } from '../src/modules/grading/score-policy';

const sampleRubric: Rubric = {
  id: 'rubric-1',
  itemId: 'item-1',
  version: 1,
  createdAt: '2026-11-19T00:00:00Z',
  frozenAt: '2026-11-19T00:01:00Z',
  referenceAnswer: '由牛顿第二定律 F = ma 得 a = F/m = 5/2 = 2.5 m/s²',
  criteria: [
    {
      id: 'c1',
      scoringUnitId: 'u1',
      description: '正确列出牛顿第二定律 F = ma',
      maxUnits: 200,
      stepUnits: 100,
      exclusiveGroup: null,
    },
    {
      id: 'c2',
      scoringUnitId: 'u1',
      description: '代入数据算出加速度 a = 2.5 m/s²',
      maxUnits: 200,
      stepUnits: 100,
      exclusiveGroup: null,
    },
  ],
};

const clearGate: ImageGateResult = {
  ok: true,
  width: 600,
  height: 300,
  inkRatio: 0.08,
  blankSuspected: false,
  reason: '本地图像闸门通过',
};

test('工作台统一模型默认复用，视觉与采分支持按需单独自定义，本机 HTTP OCR 可免 Key 调用', async (t) => {
  const conn = new AssistantConnection();
  conn.configure({ provider: 'deepseek', url: '', model: 'deepseek-flash', key: 'ds-key' });
  assert.equal(conn.gradingView().vision.mode, 'inherit');
  assert.equal(conn.gradingView().judge.mode, 'inherit');
  assert.equal(conn.gradingView().ocr.mode, 'off');

  conn.configureGrading({
    vision: {
      mode: 'custom',
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-vl-max',
      key: 'qwen-key',
    },
    judge: { mode: 'inherit', url: '', model: '', key: '' },
    ocr: { mode: 'http-ocr', url: 'http://127.0.0.1:8500/ocr', model: '', key: '' },
  });

  const called: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    called.push(url);
    const body = JSON.parse(String(init.body));
    if (url.includes('dashscope')) {
      assert.equal(body.model, 'qwen-vl-max');
      return Response.json({ choices: [{ message: { content: 'ok-vision' } }] });
    }
    if (url.includes('deepseek')) {
      assert.equal(body.model, 'deepseek-flash');
      return Response.json({ choices: [{ message: { content: 'ok-judge' } }] });
    }
    if (url === 'http://127.0.0.1:8500/ocr') {
      assert.ok(body.image_base64);
      return Response.json({ markdown: 'F = ma, a = 2.5 m/s^2' });
    }
    throw new Error('unexpected url: ' + url);
  });

  assert.equal(await conn.chatCompletion('vision', [{ role: 'user', content: 'hi' }]), 'ok-vision');
  assert.equal(await conn.chatCompletion('judge', [{ role: 'user', content: 'hi' }]), 'ok-judge');
  assert.equal(await conn.runOcr('data:image/png;base64,AAAA'), 'F = ma, a = 2.5 m/s^2');
  assert.equal(called.length, 3);
});

test('本地图像预检：拦截 942×4 残片废图与纯白空白卡，放行正常墨迹答卷', () => {
  const sliver = analyzeRgbaInk(new Uint8ClampedArray(942 * 4 * 4), 942, 4);
  assert.equal(sliver.ok, false);

  // Pure white 100x100 sheet -> suspected blank
  const white = new Uint8ClampedArray(100 * 100 * 4).fill(255);
  const blank = analyzeRgbaInk(white, 100, 100);
  assert.equal(blank.ok, true);
  assert.equal(blank.blankSuspected, true);

  // Sheet with ~5% dark handwriting pixels -> valid non-blank
  const written = new Uint8ClampedArray(100 * 100 * 4).fill(250);
  for (let i = 0; i < 500; i++) {
    written[i * 4] = 25;
    written[i * 4 + 1] = 25;
    written[i * 4 + 2] = 25;
  }
  const ok = analyzeRgbaInk(written, 100, 100);
  assert.equal(ok.ok, true);
  assert.equal(ok.blankSuspected, false);
  assert.ok((ok.inkRatio || 0) > 0.04);
});

test('VLM × OCR 关键符号交叉比对：精准匹配物理数字与单位，冲突处标黄高亮', () => {
  const match = compareVlmWithOcr('解：F=ma，代入得 a = 5/2 = 2.5 m/s²，合外力 5N', '解: F = ma, a = 5/2 = 2.5 m/s^2, 5 N');
  assert.equal(match.hasCriticalConflict, false);
  assert.ok(match.agreementScore >= 36);

  const conflict = compareVlmWithOcr('解：F=ma，算出 a = 2.5 m/s²', '解：F=ma，算出 a = 2.8 m/s²');
  assert.equal(conflict.hasCriticalConflict, true);
  assert.ok(conflict.agreementScore <= 10);
  assert.equal(conflict.conflicts[0].vlm, '2.5');
  assert.equal(conflict.conflicts[0].ocr, '2.8');

  const segs = highlightScanSegments('算出 a = 2.5 m/s²', conflict.conflicts);
  assert.ok(segs.some((s) => s.text === '2.5' && s.conflict?.ocr === '2.8'));

  const unitDiff = compareVlmWithOcr('a = 2.5 m/s', 'a = 2.5 m/s^2');
  assert.equal(unitDiff.hasCriticalConflict, true);
  assert.equal(unitDiff.conflicts[0].kind, 'unit');
});

test('两段防幻觉流水线：阶段一盲识图不含参考答案；可调半自动功率阈值与四条硬红线严格生效', async () => {
  let blindPromptSawAnswer = false;
  const makeGateway = (opts: {
    vlmJson: object;
    ocrText: string | null;
    judgeJson: object;
  }): AiGateway => ({
    async chatCompletion(role, messages) {
      if (role === 'vision') {
        const dump = JSON.stringify(messages);
        if (dump.includes('参考答案') || dump.includes('得分点')) blindPromptSawAnswer = true;
        return JSON.stringify(opts.vlmJson);
      }
      return JSON.stringify(opts.judgeJson);
    },
    async runOcr() {
      return opts.ocrText;
    },
  });

  // Case 1: High confidence with matching OCR -> Auto at 88%, Manual at 100%
  const cleanGw = makeGateway({
    vlmJson: { restoredText: '由 F=ma 得 a = 5/2 = 2.5 m/s²', formulas: ['F=ma', 'a=2.5m/s²'], legibility: 'clear', legibilityNote: '字迹工整' },
    ocrText: '由 F=ma 得 a = 5/2 = 2.5 m/s^2',
    judgeJson: {
      adoptions: [
        { criterionId: 'c1', status: 'full', suggestedScore: '2', quote: 'F=ma', reason: '公式正确' },
        { criterionId: 'c2', status: 'full', suggestedScore: '2', quote: 'a = 5/2 = 2.5 m/s²', reason: '数值单位均正确' },
      ],
      overallComment: '步骤清晰满分',
    },
  });
  const scan1 = await runBlindScanStage(cleanGw, { imageDataUrls: ['data:image/png;base64,AA'], imageGate: clearGate });
  assert.equal(blindPromptSawAnswer, false);
  const resAuto = await runScoringStage(cleanGw, { scan: scan1, scanText: scan1.restoredText, rubric: sampleRubric, itemPrompt: '求加速度', threshold: 88 });
  assert.equal(resAuto.totalUnits, 400);
  assert.equal(resAuto.confidence.total, 100);
  assert.equal(resAuto.confidence.decision, 'auto');

  const resPureManual = computeObjectiveConfidence({ scan: scan1, adoptions: resAuto.adoptions, rubric: sampleRubric, ruleError: '', threshold: 100 });
  assert.equal(resPureManual.decision, 'manual');

  // Case 2: OCR disabled -> capped at 82% -> pauses at 88% (稳健), passes at 78% (提速)
  const noOcrGw = makeGateway({
    vlmJson: { restoredText: 'F=ma，a = 2.5 m/s²', formulas: [], legibility: 'clear', legibilityNote: '清晰' },
    ocrText: null,
    judgeJson: {
      adoptions: [
        { criterionId: 'c1', status: 'full', suggestedScore: '2', quote: 'F=ma', reason: '正确' },
        { criterionId: 'c2', status: 'full', suggestedScore: '2', quote: 'a = 2.5 m/s²', reason: '正确' },
      ],
      overallComment: '',
    },
  });
  const scanNoOcr = await runBlindScanStage(noOcrGw, { imageDataUrls: ['data:image/png;base64,AA'], imageGate: clearGate });
  const r88 = await runScoringStage(noOcrGw, { scan: scanNoOcr, scanText: scanNoOcr.restoredText, rubric: sampleRubric, itemPrompt: '', threshold: 88 });
  assert.ok(r88.confidence.total <= 82);
  assert.equal(r88.confidence.decision, 'manual');
  const r78 = await runScoringStage(noOcrGw, { scan: scanNoOcr, scanText: scanNoOcr.restoredText, rubric: sampleRubric, itemPrompt: '', threshold: 78 });
  assert.equal(r78.confidence.decision, 'auto');

  // Case 3: VLM vs OCR numerical conflict -> capped <= 65% -> pauses even at 68% 极限挡!
  const conflictGw = makeGateway({
    vlmJson: { restoredText: 'F=ma，a = 2.5 m/s²', formulas: [], legibility: 'clear', legibilityNote: '清晰' },
    ocrText: 'F=ma，a = 2.8 m/s²',
    judgeJson: {
      adoptions: [
        { criterionId: 'c1', status: 'full', suggestedScore: '2', quote: 'F=ma', reason: '正确' },
        { criterionId: 'c2', status: 'full', suggestedScore: '2', quote: 'a = 2.5 m/s²', reason: '正确' },
      ],
      overallComment: '',
    },
  });
  const scanConf = await runBlindScanStage(conflictGw, { imageDataUrls: ['data:image/png;base64,AA'], imageGate: clearGate });
  const rConf = await runScoringStage(conflictGw, { scan: scanConf, scanText: scanConf.restoredText, rubric: sampleRubric, itemPrompt: '', threshold: 68 });
  assert.ok(rConf.confidence.total <= 65);
  assert.equal(rConf.confidence.decision, 'manual');

  // Case 4: Fabricated quote grounding check -> capped <= 60%
  assert.equal(verifyQuoteInText('F = ma', '学生写了 F=ma 得出结果'), true);
  assert.equal(verifyQuoteInText('E = mc^2', '学生写了 F=ma 得出结果'), false);
  const halluGw = makeGateway({
    vlmJson: { restoredText: '学生只写了乱码和涂鸦', formulas: [], legibility: 'clear', legibilityNote: '清晰' },
    ocrText: '学生只写了乱码和涂鸦',
    judgeJson: {
      adoptions: [
        { criterionId: 'c1', status: 'full', suggestedScore: '2', quote: 'F = ma', reason: '编造了不存在的引用' },
        { criterionId: 'c2', status: 'none', suggestedScore: '0', quote: '', reason: '未算出' },
      ],
      overallComment: '',
    },
  });
  const scanHallu = await runBlindScanStage(halluGw, { imageDataUrls: ['data:image/png;base64,AA'], imageGate: clearGate });
  const rHallu = await runScoringStage(halluGw, { scan: scanHallu, scanText: scanHallu.restoredText, rubric: sampleRubric, itemPrompt: '', threshold: 68 });
  assert.equal(rHallu.adoptions[0].quoteVerified, false);
  assert.ok(rHallu.confidence.total <= 60);
  assert.equal(rHallu.confidence.decision, 'manual');

  // Case 5: Hard Redline — illegible / blank image -> forced 0%, always manual!
  const blankScan = await runBlindScanStage(cleanGw, {
    imageDataUrls: ['data:image/png;base64,AA'],
    imageGate: { ...clearGate, blankSuspected: true, inkRatio: 0.0005, reason: '疑似空白' },
  });
  const rBlank = await runScoringStage(cleanGw, { scan: blankScan, scanText: '', rubric: sampleRubric, itemPrompt: '', threshold: 68 });
  assert.equal(rBlank.confidence.total, 0);
  assert.equal(rBlank.confidence.decision, 'manual');
  assert.ok(rBlank.confidence.redlines.length > 0);

  // Case 6: Hard Redline — illegal score step (1.5 on step=1) -> forced 0%, always manual!
  const badStepGw = makeGateway({
    vlmJson: { restoredText: 'F=ma', formulas: [], legibility: 'clear', legibilityNote: '清晰' },
    ocrText: 'F=ma',
    judgeJson: {
      adoptions: [
        { criterionId: 'c1', status: 'partial', suggestedScore: '1.5', quote: 'F=ma', reason: '步长不合法' },
        { criterionId: 'c2', status: 'none', suggestedScore: '0', quote: '', reason: '无' },
      ],
      overallComment: '',
    },
  });
  const scanBad = await runBlindScanStage(badStepGw, { imageDataUrls: ['data:image/png;base64,AA'], imageGate: clearGate });
  const rBad = await runScoringStage(badStepGw, { scan: scanBad, scanText: scanBad.restoredText, rubric: sampleRubric, itemPrompt: '', threshold: 68 });
  assert.equal(rBad.confidence.total, 0);
  assert.equal(rBad.confidence.decision, 'manual');
  assert.ok(rBad.ruleError.includes('步长'));
});

test('参考答案 AI 一键拆解得分点：解析结构并自动兜底合法分值步长', async () => {
  const gw: AiGateway = {
    async chatCompletion() {
      return '```json\n{"referenceAnswer":"F=ma, a=2.5m/s²","criteria":[{"unitLabel":"第 1 小题","unitMax":"4","description":"写出 F=ma","maxScore":"2","stepScore":"1"},{"unitLabel":"第 1 小题","unitMax":"4","description":"算出 a=2.5m/s²","maxScore":"2","stepScore":"0.5"}]}\n```';
    },
    async runOcr() {
      return null;
    },
  };
  const res = await breakdownReferenceAnswer(gw, {
    prompt: '质量2kg物体受5N合外力，求加速度',
    referenceAnswer: 'F=ma, a=2.5m/s²',
    referenceImages: [],
  });
  assert.equal(res.criteria.length, 2);
  assert.equal(res.criteria[0].maxScore, '2');
  assert.equal(res.criteria[1].stepScore, '0.5');
});

test('拉取模型列表：各家官方地址规范化为 /models，支持解析 DeepSeek-V4.1-Flash 多模态标记与内存 Key 复用', async (t) => {
  assert.equal(normalizeModelsEndpoint('https://api.deepseek.com'), 'https://api.deepseek.com/models');
  assert.equal(normalizeModelsEndpoint('https://api.deepseek.com/chat/completions'), 'https://api.deepseek.com/models');
  assert.equal(
    normalizeModelsEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
  );
  assert.equal(normalizeModelsEndpoint('https://api.siliconflow.cn/v1'), 'https://api.siliconflow.cn/v1/models');
  assert.equal(
    normalizeModelsEndpoint('https://ark.cn-beijing.volces.com/api/v3'),
    'https://ark.cn-beijing.volces.com/api/v3/models',
  );
  assert.equal(
    normalizeModelsEndpoint('https://open.bigmodel.cn/api/paas/v4'),
    'https://open.bigmodel.cn/api/paas/v4/models',
  );
  assert.equal(normalizeModelsEndpoint('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1/models');

  const conn = new AssistantConnection();
  conn.configure({ provider: 'deepseek', url: '', model: 'deepseek-flash', key: 'ds-saved-key' });

  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.deepseek.com/models');
    assert.equal(init.method, 'GET');
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer ds-saved-key');
    return Response.json({
      object: 'list',
      data: [
        {
          id: 'deepseek-flash',
          name: 'DeepSeek-V4.1-Flash',
          input_modalities: ['text', 'image'],
        },
        {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek-V4-Pro',
          input_modalities: ['text'],
        },
      ],
    });
  });

  // Empty key input reuses in-memory saved key for the same endpoint
  const models = await conn.listModels({ url: 'https://api.deepseek.com', key: '', fallbackRole: 'general' });
  assert.equal(models.length, 2);
  assert.deepEqual(models[0], { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', vision: true });
  assert.deepEqual(models[1], { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', vision: false });
});
