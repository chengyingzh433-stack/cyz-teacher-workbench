import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiKeychainStore, normalizeModelsEndpoint } from '../src/main/keychain';
import { AI_PLATFORM_LINKS, AI_PRESETS, findPlatformLinkForUrl } from '../src/shared/ai-presets';
import { MainAiProxy } from '../src/main/ai-proxy';
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
} from '../src/shared/ai-engine';
import type { Rubric } from '../src/shared/types';

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

test('AI 主进程代理：统一模型默认复用、自定义视觉分工与本机免 Key HTTP OCR', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyz-ai-'));
  const kc = new AiKeychainStore(dir);
  const proxy = new MainAiProxy(kc);

  kc.save({
    general: { provider: 'deepseek', url: '', model: 'deepseek-chat', key: 'ds-key' },
    vision: { mode: 'custom', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max', key: 'qwen-key' },
    judge: { mode: 'inherit', url: '', model: '' },
    ocr: { mode: 'http-ocr', url: 'http://127.0.0.1:8500/ocr', model: '' },
  });

  const calls: Array<{ url: string; auth: string }> = [];
  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers || {}) as Record<string, string>;
    calls.push({ url, auth: headers.Authorization || '' });
    if (url.includes('127.0.0.1:8500')) {
      return new Response(JSON.stringify({ text: 'F = ma, a = 2.5 m/s²' }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  }) as typeof fetch;

  await proxy.chatCompletion('vision', [{ role: 'user', content: 'hi' }]);
  await proxy.chatCompletion('judge', [{ role: 'user', content: 'hi' }]);
  const ocrText = await proxy.runOcr('data:image/png;base64,AAAA');

  assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(calls[0].auth, 'Bearer qwen-key');
  assert.equal(calls[1].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(calls[1].auth, 'Bearer ds-key');
  assert.equal(calls[2].url, 'http://127.0.0.1:8500/ocr');
  assert.equal(calls[2].auth, '');
  assert.equal(ocrText, 'F = ma, a = 2.5 m/s²');
});

test('本地图像预检：拦截 942×4 残片废图与纯白空白卡，放行正常墨迹答卷', () => {
  const garbage = analyzeRgbaInk(new Uint8ClampedArray(942 * 4 * 4), 942, 4);
  assert.equal(garbage.ok, false);

  const white = new Uint8ClampedArray(200 * 100 * 4).fill(255);
  const blank = analyzeRgbaInk(white, 200, 100);
  assert.equal(blank.ok, true);
  assert.equal(blank.blankSuspected, true);

  const ink = new Uint8ClampedArray(200 * 100 * 4).fill(255);
  for (let i = 0; i < 1200; i++) {
    ink[i * 4] = 20;
    ink[i * 4 + 1] = 20;
    ink[i * 4 + 2] = 20;
  }
  const normal = analyzeRgbaInk(ink, 200, 100);
  assert.equal(normal.ok, true);
  assert.equal(normal.blankSuspected, false);
});

test('VLM × OCR 关键符号交叉比对与标黄高亮', () => {
  const ok = compareVlmWithOcr('由 F = ma 得 a = 2.5 m/s²', 'F = ma, a = 2.5 m/s2');
  assert.equal(ok.hasCriticalConflict, false);
  assert.ok(ok.agreementScore >= 36);

  const diff = compareVlmWithOcr('由 F = ma 得 a = 2.5 m/s', 'F = ma, a = 25 m/s²');
  assert.equal(diff.hasCriticalConflict, true);
  assert.ok(diff.conflicts.some((c) => c.kind === 'number' && c.vlm === '2.5' && c.ocr === '25'));
  assert.ok(highlightScanSegments('a = 2.5 m/s', diff.conflicts).some((s) => s.conflict));
});

test('两段防幻觉流水线：阶段一盲识图隔离 + 功率阈值与红线熔断', async () => {
  let stage1Prompt = '';
  const gateway: AiGateway = {
    async chatCompletion(role, messages) {
      if (role === 'vision') {
        stage1Prompt = JSON.stringify(messages);
        return JSON.stringify({
          restoredText: '解：根据牛顿第二定律 F = ma，代入得 a = 5/2 = 2.5 m/s²',
          formulas: ['F = ma', 'a = 2.5 m/s²'],
          legibility: 'clear',
          legibilityNote: '字迹清晰',
        });
      }
      return JSON.stringify({
        adoptions: [
          { criterionId: 'c1', status: 'full', suggestedScore: '2', quote: 'F = ma', reason: '公式正确' },
          { criterionId: 'c2', status: 'full', suggestedScore: '2', quote: 'a = 5/2 = 2.5 m/s²', reason: '结果正确' },
        ],
        overallComment: '步骤完整',
      });
    },
    async runOcr() {
      return '解：F = ma，a = 5/2 = 2.5 m/s2';
    },
  };

  const scan = await runBlindScanStage(gateway, { imageDataUrls: ['data:image/png;base64,AA'], imageGate: clearGate });
  assert.equal(stage1Prompt.includes('参考答案'), false);
  const res = await runScoringStage(gateway, {
    scan,
    scanText: scan.restoredText,
    rubric: sampleRubric,
    itemPrompt: '求加速度',
    threshold: 88,
  });
  assert.equal(res.totalUnits, 400);
  assert.equal(res.confidence.decision, 'auto');
  assert.equal(verifyQuoteInText('F = ma', scan.restoredText), true);

  const blankRes = computeObjectiveConfidence({
    scan: { ...scan, imageGate: { ...clearGate, blankSuspected: true } },
    adoptions: res.adoptions,
    rubric: sampleRubric,
    ruleError: '',
    threshold: 50,
  });
  assert.equal(blankRes.total, 0);
  assert.equal(blankRes.decision, 'manual');
});

test('参考答案 AI 一键拆解得分点 + 拉取模型地址规范化', async () => {
  assert.equal(
    normalizeModelsEndpoint('https://api.deepseek.com/chat/completions'),
    'https://api.deepseek.com/models',
  );
  const gateway: AiGateway = {
    async chatCompletion() {
      return JSON.stringify({
        referenceAnswer: 'F=ma',
        criteria: [{ unitLabel: '第1问', unitMax: '4', description: '公式正确', maxScore: '2', stepScore: '1' }],
      });
    },
    async runOcr() {
      return null;
    },
  };
  const out = await breakdownReferenceAnswer(gateway, {
    prompt: '求加速度',
    referenceAnswer: 'F=ma',
    referenceImages: [],
  });
  assert.equal(out.criteria.length, 1);
  assert.equal(out.criteria[0].maxScore, '2');
});

test('AI 开放平台跳转链接与 OCR/视觉预设完整性校验', () => {
  for (const link of Object.values(AI_PLATFORM_LINKS)) {
    const u = new URL(link.url);
    assert.equal(u.protocol, 'https:', `平台链接 ${link.id} 必须为 HTTPS`);
  }
  assert.ok(AI_PRESETS.general.some((p) => p.id === 'deepseek'));
  assert.ok(AI_PRESETS.general.some((p) => p.id === 'siliconflow'));
  assert.ok(AI_PRESETS.ocrModel.some((p) => p.model.includes('DeepSeek-OCR')));
  assert.ok(AI_PRESETS.ocrModel.some((p) => p.model.includes('qwen-vl-ocr')));
  assert.ok(AI_PRESETS.ocrHttp.some((p) => p.id === 'pix2text'));
  assert.equal(findPlatformLinkForUrl('https://api.siliconflow.cn/v1')?.id, 'siliconflow');
  assert.equal(findPlatformLinkForUrl('https://api.deepseek.com')?.id, 'deepseek');
});
