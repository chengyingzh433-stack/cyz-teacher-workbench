import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { VaultManager } from '../vault';
import type { AiKeychainStore } from '../keychain';
import type { MainAiProxy } from '../ai-proxy';
import type { IntakeSourceKind } from '../../shared/qbank/types';
import { saveQuestionAssetFile } from './assets';
import * as contentRepo from './content';
import * as intakeRepo from './intake';
import * as bankRepo from './bank';
import * as basketRepo from './basket';
import { exportBasketDocxToPath, normalizeWordOptions, sanitizeExportFilename } from './export/docx';
import { exportBasketPdfToPath, exportBasketPptxToPath } from './export/raster';
import { adoptOcrJob, listOcrJobs, runQuestionOcr } from './ocr/service';

function wrap<T extends unknown[], R>(fn: (...args: T) => R | Promise<R>) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(msg);
    }
  };
}

function inferSourceKind(filePath: string): IntakeSourceKind {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  return 'image';
}

export function registerQbankIpcHandlers(deps: {
  vault: VaultManager;
  keychain: AiKeychainStore;
  aiProxy: MainAiProxy;
  getWindow: () => BrowserWindow | null;
}) {
  const { vault, keychain, aiProxy, getWindow } = deps;
  const qdb = () => vault.getQbankDb();
  const vpath = () => vault.getPath();

  // Taxonomy
  ipcMain.handle('qbank:taxonomy:get', wrap(() => contentRepo.getTaxonomy(qdb())));
  ipcMain.handle(
    'qbank:taxonomy:addKp',
    wrap((name: string) => contentRepo.addKnowledgePoint(qdb(), name)),
  );

  // Continuous Intake
  ipcMain.handle('qbank:intake:listSources', wrap(() => intakeRepo.listIntakeSources(qdb())));
  ipcMain.handle(
    'qbank:intake:pickAndImport',
    wrap(async () => {
      const win = getWindow();
      const res = await dialog.showOpenDialog(win || undefined!, {
        title: '选择物理试卷源文件（PDF / DOCX / 图片）',
        properties: ['openFile'],
        filters: [
          { name: '试卷文件', extensions: ['pdf', 'docx', 'png', 'jpg', 'jpeg', 'webp'] },
        ],
      });
      if (res.canceled || !res.filePaths[0]) return null;
      const fp = res.filePaths[0];
      const bytes = fs.readFileSync(fp);
      return intakeRepo.importIntakeSource(qdb(), vpath(), {
        name: path.basename(fp),
        kind: inferSourceKind(fp),
        bytes,
      });
    }),
  );
  ipcMain.handle(
    'qbank:intake:importBytes',
    wrap((input: { name: string; kind: IntakeSourceKind; bytes: number[]; pageCount?: number }) =>
      intakeRepo.importIntakeSource(qdb(), vpath(), {
        ...input,
        bytes: Buffer.from(input.bytes),
      }),
    ),
  );
  ipcMain.handle(
    'qbank:intake:getWorkspace',
    wrap((sourceId: string) => intakeRepo.getIntakeWorkspace(qdb(), sourceId)),
  );
  ipcMain.handle(
    'qbank:intake:deleteSource',
    wrap((sourceId: string) => intakeRepo.deleteIntakeSource(qdb(), vpath(), sourceId)),
  );
  ipcMain.handle(
    'qbank:intake:createDraft',
    wrap((sourceId, inheritMeta) => intakeRepo.createIntakeDraft(qdb(), sourceId, inheritMeta)),
  );
  ipcMain.handle(
    'qbank:intake:updateDraft',
    wrap((draftId, patch) => intakeRepo.updateIntakeDraft(qdb(), draftId, patch)),
  );
  ipcMain.handle(
    'qbank:intake:deleteDraft',
    wrap((draftId: string) => intakeRepo.deleteIntakeDraft(qdb(), draftId)),
  );
  ipcMain.handle(
    'qbank:intake:saveCroppedImage',
    wrap((sourceId: string, input: { bytes: number[]; name?: string; cropWidthRatio?: number | null }) =>
      intakeRepo.saveIntakeCroppedImage(vpath(), sourceId, {
        ...input,
        bytes: Buffer.from(input.bytes),
      }),
    ),
  );
  ipcMain.handle(
    'qbank:intake:publishDraft',
    wrap((draftId: string, originalBytes?: number[] | null) =>
      intakeRepo.publishIntakeDraft(
        qdb(),
        vpath(),
        draftId,
        originalBytes?.length ? Buffer.from(originalBytes) : null,
      ),
    ),
  );

  // Content & Revisions
  ipcMain.handle(
    'qbank:content:getEditable',
    wrap((questionId: number) => contentRepo.getEditableQuestion(qdb(), questionId)),
  );
  ipcMain.handle(
    'qbank:content:saveEdits',
    wrap((questionId, input) => contentRepo.saveQuestionEdits(qdb(), questionId, input)),
  );
  ipcMain.handle(
    'qbank:content:listRevisions',
    wrap((questionId: number) => contentRepo.listContentRevisions(qdb(), questionId)),
  );
  ipcMain.handle(
    'qbank:content:restoreRevision',
    wrap((questionId: number, revision: number) =>
      contentRepo.restoreContentRevision(qdb(), questionId, revision),
    ),
  );
  ipcMain.handle(
    'qbank:content:saveAsset',
    wrap((questionId: number, bytes: number[], name: string) =>
      saveQuestionAssetFile(qdb(), vpath(), questionId, Buffer.from(bytes), name),
    ),
  );

  // Bank & Folders
  ipcMain.handle('qbank:bank:search', wrap((filter) => bankRepo.searchBankQuestions(qdb(), filter)));
  ipcMain.handle('qbank:bank:createManual', wrap((input) => bankRepo.createManualQuestion(qdb(), input)));
  ipcMain.handle(
    'qbank:bank:deleteQuestion',
    wrap((questionId: number) => bankRepo.deleteBankQuestion(qdb(), vpath(), questionId)),
  );
  ipcMain.handle('qbank:folders:list', wrap(() => bankRepo.listFolders(qdb())));
  ipcMain.handle('qbank:folders:create', wrap((name: string) => bankRepo.createFolder(qdb(), name)));
  ipcMain.handle(
    'qbank:folders:rename',
    wrap((id: number, name: string) => bankRepo.renameFolder(qdb(), id, name)),
  );
  ipcMain.handle('qbank:folders:delete', wrap((id: number) => bankRepo.deleteFolder(qdb(), id)));
  ipcMain.handle(
    'qbank:folders:setMembership',
    wrap((folderId: number, questionId: number, included: boolean) =>
      bankRepo.setQuestionFolderMembership(qdb(), folderId, questionId, included),
    ),
  );

  // Basket (Paper Sets)
  ipcMain.handle('qbank:basket:listSets', wrap(() => {
    basketRepo.ensureDefaultPaperSet(qdb());
    return basketRepo.listPaperSets(qdb());
  }));
  ipcMain.handle('qbank:basket:createSet', wrap((title: string) => basketRepo.createPaperSet(qdb(), title)));
  ipcMain.handle('qbank:basket:deleteSet', wrap((setId: number) => basketRepo.deletePaperSet(qdb(), setId)));
  ipcMain.handle('qbank:basket:getSetDetail', wrap((setId: number) => basketRepo.getPaperSetDetail(qdb(), setId)));
  ipcMain.handle(
    'qbank:basket:add',
    wrap((setId: number, questionId: number) => basketRepo.addToPaperSet(qdb(), setId, questionId)),
  );
  ipcMain.handle(
    'qbank:basket:remove',
    wrap((setId: number, questionId: number) => basketRepo.removeFromPaperSet(qdb(), setId, questionId)),
  );
  ipcMain.handle('qbank:basket:clear', wrap((setId: number) => basketRepo.clearPaperSet(qdb(), setId)));
  ipcMain.handle(
    'qbank:basket:reorder',
    wrap((setId: number, itemIds: number[]) => basketRepo.reorderPaperSetItems(qdb(), setId, itemIds)),
  );
  ipcMain.handle(
    'qbank:basket:updateItem',
    wrap((itemId: number, patch) => basketRepo.updatePaperSetItem(qdb(), itemId, patch)),
  );
  ipcMain.handle(
    'qbank:basket:saveOptions',
    wrap((setId: number, options) => basketRepo.saveWordExportOptions(qdb(), setId, options)),
  );

  // Exports (Word OMML / PDF / PPTX)
  const runSaveExport = async (
    format: 'docx' | 'pdf' | 'pptx',
    setId: number,
    rawOptions: Parameters<typeof normalizeWordOptions>[0],
  ): Promise<{ path: string } | null> => {
    const norm = normalizeWordOptions(rawOptions);
    const safeTitle = sanitizeExportFilename(norm.title);
    const labels = { docx: 'Word 试卷', pdf: 'PDF 试卷', pptx: 'PPTX 讲评课件' };
    const win = getWindow();
    const res = await dialog.showSaveDialog(win || undefined!, {
      title: `导出${labels[format]}`,
      defaultPath: path.join(app.getPath('documents'), `${safeTitle}.${format}`),
      filters: [{ name: labels[format], extensions: [format] }],
    });
    if (res.canceled || !res.filePath) return null;
    const outPath =
      format === 'docx'
        ? await exportBasketDocxToPath(qdb(), vpath(), setId, norm, res.filePath)
        : format === 'pdf'
          ? await exportBasketPdfToPath(qdb(), vpath(), setId, norm, res.filePath)
          : await exportBasketPptxToPath(qdb(), vpath(), setId, norm, res.filePath);
    return { path: outPath };
  };

  ipcMain.handle('qbank:export:docx', wrap((setId, options) => runSaveExport('docx', setId, options)));
  ipcMain.handle('qbank:export:pdf', wrap((setId, options) => runSaveExport('pdf', setId, options)));
  ipcMain.handle('qbank:export:pptx', wrap((setId, options) => runSaveExport('pptx', setId, options)));

  // AI / Doc2X OCR (strictly teacher-triggered)
  ipcMain.handle(
    'qbank:ocr:listJobs',
    wrap((questionId: number, part?: 'question' | 'answer') => listOcrJobs(qdb(), questionId, part)),
  );
  ipcMain.handle(
    'qbank:ocr:run',
    wrap((params: { questionId: number; part: 'question' | 'answer'; provider: 'workbench-ai' | 'doc2x'; imageBytes?: number[] | null }) =>
      runQuestionOcr({
        db: qdb(),
        vaultPath: vpath(),
        aiProxy,
        keychain,
        questionId: params.questionId,
        part: params.part,
        provider: params.provider,
        imageBytes: params.imageBytes?.length ? Buffer.from(params.imageBytes) : null,
      }),
    ),
  );
  ipcMain.handle('qbank:ocr:adopt', wrap((jobId: string) => adoptOcrJob(qdb(), jobId)));
}
