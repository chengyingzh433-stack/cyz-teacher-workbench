import fs from 'node:fs';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { breakdownReferenceAnswer, runBlindScanStage, runScoringStage } from '../shared/ai-engine';
import { inferMapping } from '../shared/gradebook/recognize';
import { parseGradeWorkbook } from '../shared/gradebook/workbook';
import { buildExamCsv, buildExamHtmlReport } from '../shared/gradebook/export';
import type { VaultManager } from './vault';
import type { AiKeychainStore } from './keychain';
import type { MainAiProxy } from './ai-proxy';
import type { ZhixueCompanionManager } from './zhixue-view';
import * as classesRepo from './repositories/classes';
import * as seatingRepo from './repositories/seating';
import * as examsRepo from './repositories/exams';
import * as gradingRepo from './repositories/grading';
import * as homeroomRepo from './repositories/homeroom';
import * as trashRepo from './repositories/trash';
import { registerQbankIpcHandlers } from './question-bank/ipc';

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

export function registerIpcHandlers(deps: {
  vault: VaultManager;
  keychain: AiKeychainStore;
  aiProxy: MainAiProxy;
  zhixue: ZhixueCompanionManager;
  getWindow: () => BrowserWindow | null;
  onThemeChanged?: (themeId: string) => void;
}) {
  const { vault, keychain, aiProxy, zhixue, getWindow, onThemeChanged } = deps;
  const db = () => vault.getDb();

  // Safe external HTTPS link opener (for AI provider consoles / docs)
  ipcMain.handle(
    'app:openExternal',
    wrap(async (rawUrl: string) => {
      let parsed: URL;
      try {
        parsed = new URL(String(rawUrl || '').trim());
      } catch {
        throw new Error('无效的外部链接地址');
      }
      if (parsed.protocol !== 'https:') {
        throw new Error('仅允许使用系统浏览器打开 HTTPS 安全链接');
      }
      await shell.openExternal(parsed.toString());
    }),
  );

  // Vault & Preferences
  ipcMain.handle('vault:getInfo', wrap(() => vault.getInfo()));
  ipcMain.handle('vault:getPreferences', wrap(() => vault.getPreferences()));
  ipcMain.handle(
    'vault:updatePreferences',
    wrap((patch) => {
      const updated = vault.updatePreferences(patch);
      if (patch && typeof patch.themeId === 'string') {
        onThemeChanged?.(updated.themeId);
      }
      return updated;
    }),
  );
  ipcMain.handle(
    'vault:chooseFolder',
    wrap(async () => {
      const win = getWindow();
      const res = await dialog.showOpenDialog(win || undefined!, {
        title: '选择或新建教师工作台资料库文件夹',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (res.canceled || !res.filePaths[0]) return null;
      return vault.open(res.filePaths[0]);
    }),
  );
  ipcMain.handle('vault:switchVault', wrap((dirPath: string) => vault.open(dirPath)));
  ipcMain.handle('vault:openInFinder', wrap(async () => { await shell.openPath(vault.getPath()); }));
  ipcMain.handle(
    'vault:exportSnapshot',
    wrap(async () => {
      const win = getWindow();
      const res = await dialog.showOpenDialog(win || undefined!, {
        title: '选择备份文件夹存放位置',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (res.canceled || !res.filePaths[0]) return null;
      const exported = vault.exportCopyTo(res.filePaths[0]);
      return { path: exported };
    }),
  );

  // Teacher
  ipcMain.handle('teacher:get', wrap(() => classesRepo.getTeacher(db())));
  ipcMain.handle('teacher:save', wrap((p) => classesRepo.saveTeacher(db(), p)));

  // Classes & Roster
  ipcMain.handle('classes:list', wrap(() => classesRepo.listClasses(db())));
  ipcMain.handle('classes:create', wrap((input) => classesRepo.createClass(db(), input)));
  ipcMain.handle('classes:update', wrap((id, input) => classesRepo.updateClass(db(), id, input)));
  ipcMain.handle('classes:setStatus', wrap((id, status) => classesRepo.setClassStatus(db(), id, status)));
  ipcMain.handle('classes:softDelete', wrap((id) => classesRepo.softDeleteClass(db(), id)));
  ipcMain.handle('classes:createDemo', wrap(() => classesRepo.createDemoClass(db())));

  ipcMain.handle('roster:list', wrap((classId, inc) => classesRepo.listRoster(db(), classId, inc)));
  ipcMain.handle(
    'roster:saveStudent',
    wrap((classId, input, mid) => classesRepo.saveStudent(db(), classId, input, mid)),
  );
  ipcMain.handle(
    'roster:batchImport',
    wrap((classId, rows) => classesRepo.batchImportRoster(db(), classId, rows)),
  );
  ipcMain.handle('roster:setStatus', wrap((mid, st) => classesRepo.setMembershipStatus(db(), mid, st)));
  ipcMain.handle('roster:getGrowthProfile', wrap((mid) => classesRepo.getStudentGrowthProfile(db(), mid)));

  // Seating
  ipcMain.handle('seating:listPlans', wrap((cid) => seatingRepo.listSeatPlans(db(), cid)));
  ipcMain.handle(
    'seating:createPlan',
    wrap((cid, name, copyId) => seatingRepo.createSeatPlan(db(), cid, name, copyId)),
  );
  ipcMain.handle('seating:renamePlan', wrap((pid, name) => seatingRepo.renameSeatPlan(db(), pid, name)));
  ipcMain.handle('seating:deletePlan', wrap((pid) => seatingRepo.deleteSeatPlan(db(), pid)));
  ipcMain.handle(
    'seating:savePlanLayout',
    wrap((pid, rows, cols, assigns) => seatingRepo.saveSeatPlanLayout(db(), pid, rows, cols, assigns)),
  );
  ipcMain.handle('seating:arrangeByExam', wrap((params) => seatingRepo.arrangePlanByExam(db(), params)));

  // Unified Exam Center
  ipcMain.handle('exams:list', wrap((cid) => examsRepo.listExams(db(), cid)));
  ipcMain.handle('exams:getDetail', wrap((eid) => examsRepo.getExamDetail(db(), eid)));
  ipcMain.handle('exams:create', wrap((input) => examsRepo.createExam(db(), input)));
  ipcMain.handle('exams:updateMeta', wrap((eid, input) => examsRepo.updateExamMeta(db(), eid, input)));
  ipcMain.handle('exams:softDelete', wrap((eid) => examsRepo.softDeleteExam(db(), eid)));
  ipcMain.handle(
    'exams:parseWorkbook',
    wrap((payload: { bytes: number[]; fileName: string; encoding?: string }) => {
      const book = parseGradeWorkbook(new Uint8Array(payload.bytes), payload.fileName, payload.encoding || 'utf-8');
      const first = book.sheets[0] || { name: 'Sheet1', rows: [], merges: [], warnings: [] };
      return { book, inferred: inferMapping(first) };
    }),
  );
  ipcMain.handle('exams:commitImport', wrap((payload) => examsRepo.commitGradeImport(db(), payload)));
  ipcMain.handle('exams:updateScoreCell', wrap((payload) => examsRepo.updateScoreCell(db(), payload)));
  ipcMain.handle('exams:getClassTrends', wrap((cid, hint) => examsRepo.getClassTrends(db(), cid, hint)));
  ipcMain.handle(
    'exams:exportReport',
    wrap(async (payload: {
      examId: string;
      format: 'csv' | 'html';
      identified: boolean;
      passPercent: number;
      excellentPercent: number;
    }) => {
      const detail = examsRepo.getExamDetail(db(), payload.examId);
      const members = classesRepo.listRoster(db(), detail.exam.classId, false);
      const ext = payload.format;
      const content =
        ext === 'csv'
          ? buildExamCsv(detail, members, payload.identified)
          : buildExamHtmlReport(detail, members, payload.identified, payload.passPercent, payload.excellentPercent);

      const safeTitle = detail.exam.title.replace(/[\\/:*?"<>|]/g, '_');
      const win = getWindow();
      const res = await dialog.showSaveDialog(win || undefined!, {
        title: '导出成绩分析报告',
        defaultPath: `${safeTitle}-${payload.identified ? '实名版' : '匿名版'}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (res.canceled || !res.filePath) return null;
      fs.writeFileSync(res.filePath, content, 'utf8');
      return { path: res.filePath };
    }),
  );

  // Grading (attached to unified exam)
  ipcMain.handle('grading:saveItem', wrap((p) => gradingRepo.saveGradingItem(db(), p)));
  ipcMain.handle('grading:freezeRubric', wrap((rid) => gradingRepo.freezeRubric(db(), rid)));
  ipcMain.handle('grading:deleteItem', wrap((iid) => gradingRepo.deleteGradingItem(db(), iid)));
  ipcMain.handle(
    'grading:uploadPhoto',
    wrap((p: { examId: string; role: 'answer' | 'reference'; bytes: number[]; mime: string; width: number; height: number }) =>
      gradingRepo.registerPhotoAsset(db(), vault.getPath(), {
        ...p,
        bytes: new Uint8Array(p.bytes),
      }),
    ),
  );
  ipcMain.handle('grading:listSubmissions', wrap((eid, iid) => gradingRepo.listSubmissions(db(), eid, iid)));
  ipcMain.handle('grading:saveSubmission', wrap((p) => gradingRepo.saveSubmission(db(), p)));
  ipcMain.handle('grading:softDeleteSubmission', wrap((sid) => gradingRepo.softDeleteSubmission(db(), sid)));
  ipcMain.handle('grading:confirmDecision', wrap((p) => gradingRepo.confirmGradingDecision(db(), p)));
  ipcMain.handle('grading:saveKnowledgePoints', wrap((eid, names) => gradingRepo.saveKnowledgePoints(db(), eid, names)));
  ipcMain.handle('grading:saveItemKnowledgeMap', wrap((iid, allocs) => gradingRepo.saveItemKnowledgeMap(db(), iid, allocs)));
  ipcMain.handle('grading:getKnowledgeStats', wrap((eid) => gradingRepo.getKnowledgeStats(db(), eid)));

  // Trash Bin
  ipcMain.handle('trash:list', wrap(() => trashRepo.listTrash(db())));
  ipcMain.handle('trash:restore', wrap((k, id) => trashRepo.restoreTrashItem(db(), k, id)));
  ipcMain.handle('trash:purge', wrap((k, id) => trashRepo.purgeTrashItem(db(), vault.getPath(), k, id)));
  ipcMain.handle('trash:emptyAll', wrap(() => trashRepo.emptyAllTrash(db(), vault.getPath())));

  // AI & Keychain (zero-CORS main process)
  ipcMain.handle('ai:getConfig', wrap(() => keychain.getView()));
  ipcMain.handle('ai:saveConfig', wrap((input) => keychain.save(input)));
  ipcMain.handle('ai:clearKeys', wrap(() => keychain.clearAllKeys()));
  ipcMain.handle('ai:listModels', wrap((p) => aiProxy.listModels(p)));
  ipcMain.handle(
    'ai:breakdownReference',
    wrap((p) =>
      breakdownReferenceAnswer(aiProxy, {
        prompt: p.prompt,
        referenceAnswer: p.referenceAnswer,
        referenceImages: p.referenceImageDataUrls,
        totalScoreHint: p.totalScoreHint,
      }),
    ),
  );
  ipcMain.handle('ai:runBlindScan', wrap((p) => runBlindScanStage(aiProxy, p)));
  ipcMain.handle(
    'ai:runScoring',
    wrap((p) => {
      const rubric = p.inlineRubric
        ? p.inlineRubric
        : p.rubricId
          ? gradingRepo.getRubricById(db(), p.rubricId)
          : null;
      if (!rubric) throw new Error('请先配置本题评分细则再执行 AI 判分');
      return runScoringStage(aiProxy, {
        scan: p.scan,
        scanText: p.scanText,
        rubric,
        itemPrompt: p.itemPrompt,
        threshold: p.threshold,
      });
    }),
  );
  ipcMain.handle('ai:chatExamTutor', wrap((p) => aiProxy.chatExamTutor(db(), p)));
  ipcMain.handle(
    'ai:generateHomeroomMaterial',
    wrap((p) => aiProxy.generateHomeroomMaterial(db(), p)),
  );

  // Homeroom Workbench (带班工作台)
  ipcMain.handle(
    'homeroom:getDashboard',
    wrap((cid, today) => homeroomRepo.getDashboardSummary(db(), cid, today)),
  );
  ipcMain.handle(
    'homeroom:toggleCheckin',
    wrap((cid, type, date, forceVal) => homeroomRepo.toggleCheckin(db(), cid, type, date, forceVal)),
  );
  ipcMain.handle(
    'homeroom:addFocusMinutes',
    wrap((cid, mins, date) => homeroomRepo.addFocusMinutes(db(), cid, mins, date)),
  );
  ipcMain.handle(
    'homeroom:listNotes',
    wrap((cid, limit) => homeroomRepo.listNotes(db(), cid, limit)),
  );
  ipcMain.handle(
    'homeroom:addNote',
    wrap((cid, text, date, time) => homeroomRepo.addNote(db(), cid, text, date, time)),
  );
  ipcMain.handle(
    'homeroom:deleteNote',
    wrap((cid, date, nid) => homeroomRepo.deleteNote(db(), cid, date, nid)),
  );
  ipcMain.handle('homeroom:listTasks', wrap((cid) => homeroomRepo.listTasks(db(), cid)));
  ipcMain.handle('homeroom:saveTask', wrap((p) => homeroomRepo.saveTask(db(), p)));
  ipcMain.handle('homeroom:toggleTask', wrap((tid) => homeroomRepo.toggleTask(db(), tid)));
  ipcMain.handle(
    'homeroom:delayTask',
    wrap((tid, days) => homeroomRepo.delayTask(db(), tid, days)),
  );
  ipcMain.handle('homeroom:deleteTask', wrap((tid) => homeroomRepo.deleteTask(db(), tid)));
  ipcMain.handle(
    'homeroom:listComms',
    wrap((cid, mid) => homeroomRepo.listComms(db(), cid, mid)),
  );
  ipcMain.handle('homeroom:saveComm', wrap((p) => homeroomRepo.saveComm(db(), p)));
  ipcMain.handle('homeroom:toggleCommStatus', wrap((id) => homeroomRepo.toggleCommStatus(db(), id)));
  ipcMain.handle('homeroom:deleteComm', wrap((id) => homeroomRepo.deleteComm(db(), id)));
  ipcMain.handle('homeroom:listMemos', wrap((cid) => homeroomRepo.listMemos(db(), cid)));
  ipcMain.handle('homeroom:saveMemo', wrap((p) => homeroomRepo.saveMemo(db(), p)));
  ipcMain.handle('homeroom:deleteMemo', wrap((id) => homeroomRepo.deleteMemo(db(), id)));
  ipcMain.handle(
    'homeroom:listSavedMaterials',
    wrap((cid) => homeroomRepo.listSavedMaterials(db(), cid)),
  );
  ipcMain.handle('homeroom:saveMaterial', wrap((p) => homeroomRepo.saveMaterial(db(), p)));
  ipcMain.handle('homeroom:deleteMaterial', wrap((id) => homeroomRepo.deleteMaterial(db(), id)));
  ipcMain.handle(
    'homeroom:listCheckBatches',
    wrap((cid, ym) => homeroomRepo.listCheckBatches(db(), cid, ym)),
  );
  ipcMain.handle('homeroom:saveCheckBatch', wrap((p) => homeroomRepo.saveCheckBatch(db(), p)));
  ipcMain.handle('homeroom:deleteCheckBatch', wrap((id) => homeroomRepo.deleteCheckBatch(db(), id)));
  ipcMain.handle(
    'homeroom:getMonthlyStats',
    wrap((cid, ym) => homeroomRepo.getMonthlyStats(db(), cid, ym)),
  );
  ipcMain.handle(
    'homeroom:saveMonthlyManualStats',
    wrap((p) => homeroomRepo.saveMonthlyManualStats(db(), p)),
  );
  ipcMain.handle(
    'homeroom:clearMonthlyManualStats',
    wrap((cid, ym) => homeroomRepo.clearMonthlyManualStats(db(), cid, ym)),
  );

  // Zhixuewang & Universal WebContentsView Companion
  ipcMain.handle('zhixue:attach', wrap((bounds, url) => zhixue.attach(bounds, url)));
  ipcMain.handle('zhixue:resize', wrap((bounds) => zhixue.resize(bounds)));
  ipcMain.handle('zhixue:detach', wrap(() => zhixue.detach()));
  ipcMain.handle('zhixue:navigate', wrap((url) => zhixue.navigate(url)));
  ipcMain.handle('zhixue:goBack', wrap(() => zhixue.goBack()));
  ipcMain.handle('zhixue:goForward', wrap(() => zhixue.goForward()));
  ipcMain.handle('zhixue:reload', wrap(() => zhixue.reload()));
  ipcMain.handle('zhixue:captureRegion', wrap((rect) => zhixue.captureRegion(rect)));
  ipcMain.handle('zhixue:getSiteProfile', wrap((url) => zhixue.getSiteProfile(url)));
  ipcMain.handle('zhixue:saveSiteProfile', wrap((patch) => zhixue.saveSiteProfile(patch)));
  ipcMain.handle('zhixue:pickRegion', wrap(() => zhixue.pickRegion()));
  ipcMain.handle('zhixue:cancelPickRegion', wrap(() => zhixue.cancelPickRegion()));
  ipcMain.handle('zhixue:setRoiHighlight', wrap((rect, visible) => zhixue.setRoiHighlight(rect, visible)));
  ipcMain.handle('zhixue:crawlControls', wrap((hints) => zhixue.crawlControls(hints)));
  ipcMain.handle('zhixue:pickElement', wrap((role) => zhixue.pickElement(role)));
  ipcMain.handle('zhixue:cancelPickElement', wrap(() => zhixue.cancelPickElement()));
  ipcMain.handle('zhixue:applyScore', wrap((params) => zhixue.applyScore(params)));
  ipcMain.handle('zhixue:markPaperBaseline', wrap((rect) => zhixue.markPaperBaseline(rect)));
  ipcMain.handle('zhixue:checkPaperChanged', wrap((rect) => zhixue.checkPaperChanged(rect)));
  ipcMain.handle('zhixue:fillScore', wrap((score, hint) => zhixue.fillScore(score, hint)));

  // Physics Question Bank (isolated <vault>/question-bank/ sub-DB)
  registerQbankIpcHandlers({ vault, keychain, aiProxy, getWindow });
}
