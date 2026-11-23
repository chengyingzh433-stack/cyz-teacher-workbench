import crypto from 'node:crypto';
import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { unzipSync } from 'fflate';
import { AppError } from '../../../shared/types';
import type { EditableDocument, QuestionAssetDTO } from '../../../shared/qbank/editable';
import type {
  EditableQuestionDTO,
  QbankOcrIssue,
  QbankOcrJobDTO,
  QbankOcrPart,
  QbankOcrProvider,
} from '../../../shared/qbank/types';
import type { MainAiProxy } from '../../ai-proxy';
import type { AiKeychainStore } from '../../keychain';
import { resolveSafeQbankPath, saveQuestionAssetFile } from '../assets';
import { getEditableQuestion, saveQuestionEdits } from '../content';
import { convertMarkdownToDoc } from './markdown-to-doc';

const DOC2X_BASE = 'https://v2.doc2x.noedgeai.com';

const PHYSICS_OCR_PROMPT = `你是高中物理试卷排版与公式转写助手。请严格按图片原文忠实转写这张物理题目（或答案）图片：
1. 输出纯 Markdown，不要加代码块围栏，不要自行解题或补充图片中没有的内容；
2. 行内数学/物理公式使用 $...$，独立公式使用 $$...$$（标准 LaTeX，避免使用 \\overline 改用 \\bar）；
3. 保留原有选项格式（A. B. C. D.）和物理单位（如 m/s^2、N、J、Ω）；
4. 如遇插图或电路图，可在对应位置留空行，由教师从原图裁切插入。`;

function mapJob(r: Record<string, unknown>): QbankOcrJobDTO {
  let candidateDoc: EditableDocument | null = null;
  let issues: QbankOcrIssue[] = [];
  try {
    if (r.candidate_doc_json) candidateDoc = JSON.parse(String(r.candidate_doc_json));
  } catch {
    candidateDoc = null;
  }
  try {
    if (r.issues_json) issues = JSON.parse(String(r.issues_json));
  } catch {
    issues = [];
  }
  return {
    id: String(r.id),
    questionId: Number(r.question_id),
    part: r.part === 'answer' ? 'answer' : 'question',
    provider: r.provider === 'doc2x' ? 'doc2x' : 'workbench-ai',
    status: String(r.status) as QbankOcrJobDTO['status'],
    remoteUid: r.remote_uid ? String(r.remote_uid) : null,
    rawMarkdown: r.raw_markdown ? String(r.raw_markdown) : null,
    candidateDoc,
    issues,
    error: r.error ? String(r.error) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function listOcrJobs(
  db: DatabaseSync,
  questionId: number,
  part?: QbankOcrPart,
): QbankOcrJobDTO[] {
  const rows = (
    part
      ? db
          .prepare(
            `SELECT * FROM ocr_jobs WHERE question_id = ? AND part = ? ORDER BY created_at DESC LIMIT 20`,
          )
          .all(questionId, part)
      : db
          .prepare(`SELECT * FROM ocr_jobs WHERE question_id = ? ORDER BY created_at DESC LIMIT 20`)
          .all(questionId)
  ) as Array<Record<string, unknown>>;
  return rows.map(mapJob);
}

function resolveImageBytes(
  db: DatabaseSync,
  vaultPath: string,
  questionId: number,
  part: QbankOcrPart,
  customBytes?: Uint8Array | Buffer | null,
): Buffer {
  if (customBytes && customBytes.length > 0) {
    return Buffer.isBuffer(customBytes) ? customBytes : Buffer.from(customBytes);
  }
  const q = db
    .prepare(`SELECT image_rel_path, answer_image_rel_path FROM questions WHERE id = ?`)
    .get(questionId) as
    | { image_rel_path: string | null; answer_image_rel_path: string | null }
    | undefined;
  if (!q) throw new AppError('NOT_FOUND', `未找到题目 #${questionId}`);
  const rel = part === 'answer' ? q.answer_image_rel_path : q.image_rel_path;
  if (!rel) {
    throw new AppError('VALIDATION', '当前题目暂无原图快照，请先上传/框选一张识别截图');
  }
  const abs = resolveSafeQbankPath(vaultPath, rel);
  if (!fs.existsSync(abs)) throw new AppError('NOT_FOUND', '原图文件不存在');
  return fs.readFileSync(abs);
}

function unpackDoc2xZip(rawZip: unknown): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (typeof rawZip !== 'string' || !rawZip) return out;
  try {
    const buf = Buffer.from(rawZip, 'base64');
    const files = unzipSync(new Uint8Array(buf));
    for (const [name, data] of Object.entries(files)) {
      if (/\.(png|jpe?g|webp)$/i.test(name) && data.byteLength <= 10 * 1024 * 1024) {
        out.set(name.replace(/^\/+/, ''), Buffer.from(data));
      }
    }
  } catch {
    // ignore corrupt optional zip
  }
  return out;
}

/**
 * Teacher-triggered image-to-editable-question recognition.
 * Supports Workbench Unified AI (`workbench-ai`, default) and optional `doc2x`.
 * Never invoked passively on view load or app startup.
 */
export async function runQuestionOcr(params: {
  db: DatabaseSync;
  vaultPath: string;
  aiProxy: MainAiProxy;
  keychain: AiKeychainStore;
  questionId: number;
  part: QbankOcrPart;
  provider: QbankOcrProvider;
  imageBytes?: Uint8Array | Buffer | null;
}): Promise<QbankOcrJobDTO> {
  const { db, vaultPath, aiProxy, keychain, questionId, part, provider } = params;
  const imgBuf = resolveImageBytes(db, vaultPath, questionId, part, params.imageBytes);
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO ocr_jobs (id, question_id, part, provider, status, issues_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'processing', '[]', ?, ?)`,
  ).run(jobId, questionId, part, provider, now, now);

  try {
    let rawMarkdown = '';
    let zipImages = new Map<string, Buffer>();
    let remoteUid: string | null = null;

    if (provider === 'workbench-ai') {
      const mime = imgBuf[0] === 0xff && imgBuf[1] === 0xd8 ? 'image/jpeg' : 'image/png';
      const dataUrl = `data:${mime};base64,${imgBuf.toString('base64')}`;
      rawMarkdown = await aiProxy.chatCompletion(
        'vision',
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: PHYSICS_OCR_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        { temperature: 0.1, maxTokens: 4096 },
      );
    } else {
      const doc2x = keychain.resolveDoc2x();
      if (!doc2x.enabled || !doc2x.key) {
        throw new AppError('AI_CONFIG', '请先在「设置 → AI 模型与系统钥匙串」启用并填写 Doc2X API Key');
      }
      const uploadRes = await fetch(`${DOC2X_BASE}/api/v2/async/parse/img/layout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${doc2x.key}`,
          'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array(imgBuf),
      });
      if (!uploadRes.ok) {
        throw new AppError('OCR_HTTP', `Doc2X 提交失败（HTTP ${uploadRes.status}）`);
      }
      const uploadJson = (await uploadRes.json()) as { code?: string; data?: { uid?: string } };
      if (uploadJson.code !== 'success' || !uploadJson.data?.uid) {
        throw new AppError('OCR_HTTP', `Doc2X 返回异常：${uploadJson.code || '未知错误'}`);
      }
      remoteUid = uploadJson.data.uid;
      db.prepare(`UPDATE ocr_jobs SET remote_uid = ?, updated_at = ? WHERE id = ?`).run(
        remoteUid,
        new Date().toISOString(),
        jobId,
      );

      // Poll up to 90s for teacher-triggered single image recognition
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const stRes = await fetch(
          `${DOC2X_BASE}/api/v2/parse/img/layout/status?uid=${encodeURIComponent(remoteUid)}`,
          { headers: { Authorization: `Bearer ${doc2x.key}` } },
        );
        if (!stRes.ok) continue;
        const stJson = (await stRes.json()) as {
          code?: string;
          data?: { status?: string; result?: { pages?: Array<{ md?: string }> }; convert_zip?: string };
        };
        const st = stJson.data?.status;
        if (st === 'failed') throw new AppError('OCR_FAILED', 'Doc2X 未能识别该图片，请调整截图重试');
        if (st === 'success') {
          rawMarkdown = (stJson.data?.result?.pages || [])
            .map((p) => String(p.md || ''))
            .join('\n\n');
          zipImages = unpackDoc2xZip(stJson.data?.convert_zip);
          break;
        }
      }
      if (!rawMarkdown) {
        db.prepare(`UPDATE ocr_jobs SET status = 'paused', error = ?, updated_at = ? WHERE id = ?`).run(
          '等待超时已暂停，可稍后重试',
          new Date().toISOString(),
          jobId,
        );
        const row = db.prepare(`SELECT * FROM ocr_jobs WHERE id = ?`).get(jobId) as Record<string, unknown>;
        return mapJob(row);
      }
    }

    const savedAssets = new Map<string, QuestionAssetDTO>();
    const converted = await convertMarkdownToDoc(rawMarkdown, async (ref) => {
      const cleanRef = ref.replace(/^\.?\//, '');
      const bytes =
        zipImages.get(cleanRef) ??
        [...zipImages.entries()].find(([k]) => k.endsWith(`/${cleanRef.split('/').pop()}`))?.[1];
      if (!bytes) return null;
      if (savedAssets.has(cleanRef)) return savedAssets.get(cleanRef)!;
      const asset = saveQuestionAssetFile(db, vaultPath, questionId, bytes, `OCR配图-${cleanRef.split('/').pop()}`);
      savedAssets.set(cleanRef, asset);
      return asset;
    });

    db.prepare(
      `UPDATE ocr_jobs
       SET status = 'ready', raw_markdown = ?, candidate_doc_json = ?, issues_json = ?, error = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      rawMarkdown,
      JSON.stringify(converted.document),
      JSON.stringify(converted.issues),
      new Date().toISOString(),
      jobId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(`UPDATE ocr_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).run(
      message.slice(0, 500),
      new Date().toISOString(),
      jobId,
    );
  }

  const row = db.prepare(`SELECT * FROM ocr_jobs WHERE id = ?`).get(jobId) as Record<string, unknown>;
  return mapJob(row);
}

export function adoptOcrJob(db: DatabaseSync, jobId: string): EditableQuestionDTO {
  const row = db.prepare(`SELECT * FROM ocr_jobs WHERE id = ?`).get(jobId) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new AppError('NOT_FOUND', '未找到识别候选记录');
  const job = mapJob(row);
  if (!job.candidateDoc) throw new AppError('VALIDATION', '该识别记录没有可采纳的正文内容');

  const current = getEditableQuestion(db, job.questionId);
  return saveQuestionEdits(db, job.questionId, {
    expectedRevision: current.content.revision,
    metadata: current.metadata,
    content: {
      ...current.content,
      ...(job.part === 'answer'
        ? { answerMode: 'editable', answerBody: job.candidateDoc }
        : { questionMode: 'editable', questionBody: job.candidateDoc }),
    },
  });
}
