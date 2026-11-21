import { contextBridge, ipcRenderer } from 'electron';
import type { WorkbenchApi } from '../shared/ipc';
import type { ZhixueState } from '../shared/types';

const api: WorkbenchApi = {
  platform: process.platform,
  appVersion: '1.1.0',

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
    fillScore: (scoreText, selectorHint) =>
      ipcRenderer.invoke('zhixue:fillScore', scoreText, selectorHint),
    onStateChange: (cb) => {
      const listener = (_event: Electron.IpcRendererEvent, state: ZhixueState) => cb(state);
      ipcRenderer.on('zhixue:state', listener);
      return () => ipcRenderer.removeListener('zhixue:state', listener);
    },
  },
};

contextBridge.exposeInMainWorld('workbenchApi', api);
