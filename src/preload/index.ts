import { contextBridge, ipcRenderer } from 'electron';
import type { WorkbenchApi } from '../shared/ipc';
import type { ZhixueState } from '../shared/types';

declare const __APP_VERSION__: string;

const api: WorkbenchApi = {
  platform: process.platform,
  appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.3.1',
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  vault: {
    getInfo: () => ipcRenderer.invoke('vault:getInfo'),
    getPreferences: () => ipcRenderer.invoke('vault:getPreferences'),
    updatePreferences: (patch) => ipcRenderer.invoke('vault:updatePreferences', patch),
    chooseFolder: () => ipcRenderer.invoke('vault:chooseFolder'),
    switchVault: (dirPath) => ipcRenderer.invoke('vault:switchVault', dirPath),
    openInFinder: () => ipcRenderer.invoke('vault:openInFinder'),
    exportSnapshot: () => ipcRenderer.invoke('vault:exportSnapshot'),
  },

  teacher: {
    get: () => ipcRenderer.invoke('teacher:get'),
    save: (profile) => ipcRenderer.invoke('teacher:save', profile),
  },

  classes: {
    list: () => ipcRenderer.invoke('classes:list'),
    create: (input) => ipcRenderer.invoke('classes:create', input),
    update: (id, input) => ipcRenderer.invoke('classes:update', id, input),
    setStatus: (id, status) => ipcRenderer.invoke('classes:setStatus', id, status),
    softDelete: (id) => ipcRenderer.invoke('classes:softDelete', id),
    createDemo: () => ipcRenderer.invoke('classes:createDemo'),
  },

  roster: {
    list: (classId, includeRemoved) => ipcRenderer.invoke('roster:list', classId, includeRemoved),
    saveStudent: (classId, input, membershipId) =>
      ipcRenderer.invoke('roster:saveStudent', classId, input, membershipId),
    batchImport: (classId, rows) => ipcRenderer.invoke('roster:batchImport', classId, rows),
    setStatus: (membershipId, status) => ipcRenderer.invoke('roster:setStatus', membershipId, status),
    getGrowthProfile: (membershipId) => ipcRenderer.invoke('roster:getGrowthProfile', membershipId),
  },

  seating: {
    listPlans: (classId) => ipcRenderer.invoke('seating:listPlans', classId),
    createPlan: (classId, name, copyFromPlanId) =>
      ipcRenderer.invoke('seating:createPlan', classId, name, copyFromPlanId),
    renamePlan: (planId, name) => ipcRenderer.invoke('seating:renamePlan', planId, name),
    deletePlan: (planId) => ipcRenderer.invoke('seating:deletePlan', planId),
    savePlanLayout: (planId, rows, cols, assignments) =>
      ipcRenderer.invoke('seating:savePlanLayout', planId, rows, cols, assignments),
    arrangeByExam: (params) => ipcRenderer.invoke('seating:arrangeByExam', params),
  },

  exams: {
    list: (classId) => ipcRenderer.invoke('exams:list', classId),
    getDetail: (examId) => ipcRenderer.invoke('exams:getDetail', examId),
    create: (input) => ipcRenderer.invoke('exams:create', input),
    updateMeta: (examId, input) => ipcRenderer.invoke('exams:updateMeta', examId, input),
    softDelete: (examId) => ipcRenderer.invoke('exams:softDelete', examId),
    parseWorkbook: (payload) => ipcRenderer.invoke('exams:parseWorkbook', payload),
    commitImport: (payload) => ipcRenderer.invoke('exams:commitImport', payload),
    updateScoreCell: (payload) => ipcRenderer.invoke('exams:updateScoreCell', payload),
    getClassTrends: (classId, subjectHint) =>
      ipcRenderer.invoke('exams:getClassTrends', classId, subjectHint),
    exportReport: (payload) => ipcRenderer.invoke('exams:exportReport', payload),
  },

  grading: {
    saveItem: (payload) => ipcRenderer.invoke('grading:saveItem', payload),
    freezeRubric: (rubricId) => ipcRenderer.invoke('grading:freezeRubric', rubricId),
    deleteItem: (itemId) => ipcRenderer.invoke('grading:deleteItem', itemId),
    uploadPhoto: (payload) => ipcRenderer.invoke('grading:uploadPhoto', payload),
    listSubmissions: (examId, itemId) => ipcRenderer.invoke('grading:listSubmissions', examId, itemId),
    saveSubmission: (payload) => ipcRenderer.invoke('grading:saveSubmission', payload),
    softDeleteSubmission: (submissionId) =>
      ipcRenderer.invoke('grading:softDeleteSubmission', submissionId),
    confirmDecision: (payload) => ipcRenderer.invoke('grading:confirmDecision', payload),
    saveKnowledgePoints: (examId, names) =>
      ipcRenderer.invoke('grading:saveKnowledgePoints', examId, names),
    saveItemKnowledgeMap: (itemId, allocations) =>
      ipcRenderer.invoke('grading:saveItemKnowledgeMap', itemId, allocations),
    getKnowledgeStats: (examId) => ipcRenderer.invoke('grading:getKnowledgeStats', examId),
  },

  trash: {
    list: () => ipcRenderer.invoke('trash:list'),
    restore: (kind, id) => ipcRenderer.invoke('trash:restore', kind, id),
    purge: (kind, id) => ipcRenderer.invoke('trash:purge', kind, id),
    emptyAll: () => ipcRenderer.invoke('trash:emptyAll'),
  },

  ai: {
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    saveConfig: (input) => ipcRenderer.invoke('ai:saveConfig', input),
    clearKeys: () => ipcRenderer.invoke('ai:clearKeys'),
    listModels: (params) => ipcRenderer.invoke('ai:listModels', params),
    breakdownReference: (params) => ipcRenderer.invoke('ai:breakdownReference', params),
    runBlindScan: (params) => ipcRenderer.invoke('ai:runBlindScan', params),
    runScoring: (params) => ipcRenderer.invoke('ai:runScoring', params),
    chatExamTutor: (params) => ipcRenderer.invoke('ai:chatExamTutor', params),
    generateHomeroomMaterial: (params) => ipcRenderer.invoke('ai:generateHomeroomMaterial', params),
  },

  homeroom: {
    getDashboard: (classId, todayDate) =>
      ipcRenderer.invoke('homeroom:getDashboard', classId, todayDate),
    toggleCheckin: (classId, type, date, forceValue) =>
      ipcRenderer.invoke('homeroom:toggleCheckin', classId, type, date, forceValue),
    addFocusMinutes: (classId, minutes, date) =>
      ipcRenderer.invoke('homeroom:addFocusMinutes', classId, minutes, date),
    listNotes: (classId, limitDays) => ipcRenderer.invoke('homeroom:listNotes', classId, limitDays),
    addNote: (classId, text, date, time) =>
      ipcRenderer.invoke('homeroom:addNote', classId, text, date, time),
    deleteNote: (classId, date, noteId) =>
      ipcRenderer.invoke('homeroom:deleteNote', classId, date, noteId),
    listTasks: (classId) => ipcRenderer.invoke('homeroom:listTasks', classId),
    saveTask: (payload) => ipcRenderer.invoke('homeroom:saveTask', payload),
    toggleTask: (taskId) => ipcRenderer.invoke('homeroom:toggleTask', taskId),
    delayTask: (taskId, days) => ipcRenderer.invoke('homeroom:delayTask', taskId, days),
    deleteTask: (taskId) => ipcRenderer.invoke('homeroom:deleteTask', taskId),
    listComms: (classId, membershipId) =>
      ipcRenderer.invoke('homeroom:listComms', classId, membershipId),
    saveComm: (payload) => ipcRenderer.invoke('homeroom:saveComm', payload),
    toggleCommStatus: (commId) => ipcRenderer.invoke('homeroom:toggleCommStatus', commId),
    deleteComm: (commId) => ipcRenderer.invoke('homeroom:deleteComm', commId),
    listMemos: (classId) => ipcRenderer.invoke('homeroom:listMemos', classId),
    saveMemo: (payload) => ipcRenderer.invoke('homeroom:saveMemo', payload),
    deleteMemo: (memoId) => ipcRenderer.invoke('homeroom:deleteMemo', memoId),
    listSavedMaterials: (classId) => ipcRenderer.invoke('homeroom:listSavedMaterials', classId),
    saveMaterial: (payload) => ipcRenderer.invoke('homeroom:saveMaterial', payload),
    deleteMaterial: (materialId) => ipcRenderer.invoke('homeroom:deleteMaterial', materialId),
    listCheckBatches: (classId, yearMonth) =>
      ipcRenderer.invoke('homeroom:listCheckBatches', classId, yearMonth),
    saveCheckBatch: (payload) => ipcRenderer.invoke('homeroom:saveCheckBatch', payload),
    deleteCheckBatch: (batchId) => ipcRenderer.invoke('homeroom:deleteCheckBatch', batchId),
    getMonthlyStats: (classId, yearMonth) =>
      ipcRenderer.invoke('homeroom:getMonthlyStats', classId, yearMonth),
    saveMonthlyManualStats: (payload) =>
      ipcRenderer.invoke('homeroom:saveMonthlyManualStats', payload),
    clearMonthlyManualStats: (classId, yearMonth) =>
      ipcRenderer.invoke('homeroom:clearMonthlyManualStats', classId, yearMonth),
  },

  zhixue: {
    attach: (bounds, url) => ipcRenderer.invoke('zhixue:attach', bounds, url),
    resize: (bounds) => ipcRenderer.invoke('zhixue:resize', bounds),
    detach: () => ipcRenderer.invoke('zhixue:detach'),
    navigate: (url) => ipcRenderer.invoke('zhixue:navigate', url),
    goBack: () => ipcRenderer.invoke('zhixue:goBack'),
    goForward: () => ipcRenderer.invoke('zhixue:goForward'),
    reload: () => ipcRenderer.invoke('zhixue:reload'),
    captureRegion: (rect) => ipcRenderer.invoke('zhixue:captureRegion', rect),
    getSiteProfile: (url) => ipcRenderer.invoke('zhixue:getSiteProfile', url),
    saveSiteProfile: (patch) => ipcRenderer.invoke('zhixue:saveSiteProfile', patch),
    pickRegion: () => ipcRenderer.invoke('zhixue:pickRegion'),
    cancelPickRegion: () => ipcRenderer.invoke('zhixue:cancelPickRegion'),
    setRoiHighlight: (rect, visible) => ipcRenderer.invoke('zhixue:setRoiHighlight', rect, visible),
    crawlControls: (hints) => ipcRenderer.invoke('zhixue:crawlControls', hints),
    pickElement: (role) => ipcRenderer.invoke('zhixue:pickElement', role),
    cancelPickElement: () => ipcRenderer.invoke('zhixue:cancelPickElement'),
    applyScore: (params) => ipcRenderer.invoke('zhixue:applyScore', params),
    markPaperBaseline: (rect) => ipcRenderer.invoke('zhixue:markPaperBaseline', rect),
    checkPaperChanged: (rect) => ipcRenderer.invoke('zhixue:checkPaperChanged', rect),
    fillScore: (scoreText, selectorHint) =>
      ipcRenderer.invoke('zhixue:fillScore', scoreText, selectorHint),
    onStateChange: (cb) => {
      const listener = (_event: Electron.IpcRendererEvent, state: ZhixueState) => cb(state);
      ipcRenderer.on('zhixue:state', listener);
      return () => ipcRenderer.removeListener('zhixue:state', listener);
    },
    onEscapePressed: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('zhixue:escape', listener);
      return () => ipcRenderer.removeListener('zhixue:escape', listener);
    },
  },

  qbank: {
    taxonomy: {
      get: () => ipcRenderer.invoke('qbank:taxonomy:get'),
      addKnowledgePoint: (name) => ipcRenderer.invoke('qbank:taxonomy:addKp', name),
    },
    intake: {
      listSources: () => ipcRenderer.invoke('qbank:intake:listSources'),
      pickAndImport: () => ipcRenderer.invoke('qbank:intake:pickAndImport'),
      importBytes: (input) => ipcRenderer.invoke('qbank:intake:importBytes', input),
      getWorkspace: (sourceId) => ipcRenderer.invoke('qbank:intake:getWorkspace', sourceId),
      deleteSource: (sourceId) => ipcRenderer.invoke('qbank:intake:deleteSource', sourceId),
      createDraft: (sourceId, inheritMetadata) =>
        ipcRenderer.invoke('qbank:intake:createDraft', sourceId, inheritMetadata),
      updateDraft: (draftId, patch) => ipcRenderer.invoke('qbank:intake:updateDraft', draftId, patch),
      deleteDraft: (draftId) => ipcRenderer.invoke('qbank:intake:deleteDraft', draftId),
      saveCroppedImage: (sourceId, input) =>
        ipcRenderer.invoke('qbank:intake:saveCroppedImage', sourceId, input),
      publishDraft: (draftId, originalBytes) =>
        ipcRenderer.invoke('qbank:intake:publishDraft', draftId, originalBytes),
    },
    content: {
      getEditable: (questionId) => ipcRenderer.invoke('qbank:content:getEditable', questionId),
      saveEdits: (questionId, input) => ipcRenderer.invoke('qbank:content:saveEdits', questionId, input),
      listRevisions: (questionId) => ipcRenderer.invoke('qbank:content:listRevisions', questionId),
      restoreRevision: (questionId, revision) =>
        ipcRenderer.invoke('qbank:content:restoreRevision', questionId, revision),
      saveAsset: (questionId, bytes, name) =>
        ipcRenderer.invoke('qbank:content:saveAsset', questionId, bytes, name),
    },
    bank: {
      search: (filter) => ipcRenderer.invoke('qbank:bank:search', filter),
      createManual: (input) => ipcRenderer.invoke('qbank:bank:createManual', input),
      deleteQuestion: (questionId) => ipcRenderer.invoke('qbank:bank:deleteQuestion', questionId),
    },
    folders: {
      list: () => ipcRenderer.invoke('qbank:folders:list'),
      create: (name) => ipcRenderer.invoke('qbank:folders:create', name),
      rename: (id, name) => ipcRenderer.invoke('qbank:folders:rename', id, name),
      delete: (id) => ipcRenderer.invoke('qbank:folders:delete', id),
      setMembership: (folderId, questionId, included) =>
        ipcRenderer.invoke('qbank:folders:setMembership', folderId, questionId, included),
    },
    basket: {
      listSets: () => ipcRenderer.invoke('qbank:basket:listSets'),
      createSet: (title) => ipcRenderer.invoke('qbank:basket:createSet', title),
      deleteSet: (setId) => ipcRenderer.invoke('qbank:basket:deleteSet', setId),
      getSetDetail: (setId) => ipcRenderer.invoke('qbank:basket:getSetDetail', setId),
      add: (setId, questionId) => ipcRenderer.invoke('qbank:basket:add', setId, questionId),
      remove: (setId, questionId) => ipcRenderer.invoke('qbank:basket:remove', setId, questionId),
      clear: (setId) => ipcRenderer.invoke('qbank:basket:clear', setId),
      reorder: (setId, itemIds) => ipcRenderer.invoke('qbank:basket:reorder', setId, itemIds),
      updateItem: (itemId, patch) => ipcRenderer.invoke('qbank:basket:updateItem', itemId, patch),
      saveOptions: (setId, options) => ipcRenderer.invoke('qbank:basket:saveOptions', setId, options),
    },
    export: {
      docx: (setId, options) => ipcRenderer.invoke('qbank:export:docx', setId, options),
      pdf: (setId, options) => ipcRenderer.invoke('qbank:export:pdf', setId, options),
      pptx: (setId, options) => ipcRenderer.invoke('qbank:export:pptx', setId, options),
    },
    ocr: {
      listJobs: (questionId, part) => ipcRenderer.invoke('qbank:ocr:listJobs', questionId, part),
      run: (params) => ipcRenderer.invoke('qbank:ocr:run', params),
      adopt: (jobId) => ipcRenderer.invoke('qbank:ocr:adopt', jobId),
    },
  },
};

contextBridge.exposeInMainWorld('workbenchApi', api);
