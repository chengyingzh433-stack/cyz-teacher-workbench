import type {
  AiChatMessage,
  AiConfigInput,
  AiConfigView,
  AppPreferences,
  ClassExamTrendPoint,
  ClassRecord,
  ExamDetail,
  ExamSummary,
  GradingItemDetail,
  GradingSubmission,
  HomeroomCheckBatch,
  HomeroomCheckKind,
  HomeroomCheckinType,
  HomeroomCommStatus,
  HomeroomCommType,
  HomeroomDashboardSummary,
  HomeroomMemo,
  HomeroomMemoTag,
  HomeroomMonthlyStatsNumbers,
  HomeroomMonthlyStatsView,
  HomeroomNoteDayGroup,
  HomeroomNoteEntry,
  HomeroomTask,
  HomeroomTaskCategory,
  HomeroomTaskPriority,
  KnowledgeStatRow,
  PhotoAsset,
  RemoteModelInfo,
  SavedMaterialRecord,
  ScoreSeatingStrategy,
  ScoreStatus,
  SeatAssignment,
  SeatPlan,
  StudentCommRecord,
  StudentGrowthProfile,
  StudentInput,
  StudentMember,
  TeacherProfile,
  TrashItem,
  VaultInfo,
  ZhixueState,
} from './types';
import type { TableBook, TableMapping } from './gradebook/table';
import type { BreakdownResult, GradingResult, Stage1ScanResult } from './ai-engine';

export interface ImportedStudentRow {
  name: string;
  rosterNo: string;
  gender: 'male' | 'female' | 'unspecified';
  updateMembershipId?: string;
}

export interface CommitGradeImportPayload {
  classId: string;
  examId?: string;
  title: string;
  examDate: string;
  notes?: string;
  sourceFile: string;
  columns: Array<{
    key: string;
    label: string;
    role: 'score' | 'total';
    maxUnits: number | null;
  }>;
  rows: Array<{
    membershipId?: string;
    createStudent?: { name: string; rosterNo: string };
    cells: Array<{
      columnKey: string;
      status: ScoreStatus;
      units: number | null;
      rawText: string;
      correctedText: string | null;
      fromFormula: boolean;
    }>;
  }>;
}

export interface SaveGradingItemPayload {
  examId: string;
  itemId?: string;
  label: string;
  prompt: string;
  referenceAnswer: string;
  scoringUnits: Array<{ id?: string; label: string; maxUnits: number }>;
  criteria: Array<{
    id?: string;
    scoringUnitIndex: number;
    description: string;
    maxUnits: number;
    stepUnits: number;
    exclusiveGroup: string | null;
  }>;
  referenceAssetIds?: string[];
}

export interface WorkbenchApi {
  platform: string;
  appVersion: string;

  // Vault & Preferences
  vault: {
    getInfo: () => Promise<VaultInfo>;
    getPreferences: () => Promise<AppPreferences>;
    updatePreferences: (patch: Partial<AppPreferences>) => Promise<AppPreferences>;
    chooseFolder: () => Promise<VaultInfo | null>;
    switchVault: (dirPath: string) => Promise<VaultInfo>;
    openInFinder: () => Promise<void>;
    exportSnapshot: () => Promise<{ path: string } | null>;
  };

  // Teacher profile
  teacher: {
    get: () => Promise<TeacherProfile>;
    save: (profile: TeacherProfile) => Promise<TeacherProfile>;
  };

  // Classes & Roster
  classes: {
    list: () => Promise<ClassRecord[]>;
    create: (input: { name: string; school: string; termLabel: string }) => Promise<ClassRecord>;
    update: (id: string, input: { name: string; school: string; termLabel: string }) => Promise<ClassRecord>;
    setStatus: (id: string, status: 'active' | 'archived') => Promise<ClassRecord>;
    softDelete: (id: string) => Promise<void>;
    createDemo: () => Promise<ClassRecord>;
  };

  roster: {
    list: (classId: string, includeRemoved?: boolean) => Promise<StudentMember[]>;
    saveStudent: (classId: string, input: StudentInput, membershipId?: string) => Promise<StudentMember>;
    batchImport: (classId: string, rows: ImportedStudentRow[]) => Promise<{ added: number; updated: number }>;
    setStatus: (membershipId: string, status: 'active' | 'removed') => Promise<void>;
    getGrowthProfile: (membershipId: string) => Promise<StudentGrowthProfile>;
  };

  // Seating
  seating: {
    listPlans: (classId: string) => Promise<SeatPlan[]>;
    createPlan: (classId: string, name: string, copyFromPlanId?: string) => Promise<SeatPlan>;
    renamePlan: (planId: string, name: string) => Promise<SeatPlan>;
    deletePlan: (planId: string) => Promise<void>;
    savePlanLayout: (planId: string, rows: number, cols: number, assignments: SeatAssignment[]) => Promise<SeatPlan>;
    arrangeByExam: (params: {
      planId: string;
      examId: string;
      columnId?: string;
      strategy: ScoreSeatingStrategy;
    }) => Promise<SeatPlan>;
  };

  // Unified Exam Center
  exams: {
    list: (classId: string) => Promise<ExamSummary[]>;
    getDetail: (examId: string) => Promise<ExamDetail>;
    create: (input: { classId: string; title: string; examDate: string; notes?: string }) => Promise<ExamSummary>;
    updateMeta: (examId: string, input: { title: string; examDate: string; notes?: string }) => Promise<ExamSummary>;
    softDelete: (examId: string) => Promise<void>;
    parseWorkbook: (payload: { bytes: number[]; fileName: string; encoding?: string }) => Promise<{
      book: TableBook;
      inferred: TableMapping;
    }>;
    commitImport: (payload: CommitGradeImportPayload) => Promise<ExamSummary>;
    updateScoreCell: (payload: {
      examId: string;
      columnId: string;
      membershipId: string;
      status: ScoreStatus;
      units: number | null;
      reason: string;
    }) => Promise<ExamDetail>;
    getClassTrends: (classId: string, subjectHint?: string) => Promise<ClassExamTrendPoint[]>;
    exportReport: (payload: {
      examId: string;
      format: 'csv' | 'html';
      identified: boolean;
      passPercent: number;
      excellentPercent: number;
    }) => Promise<{ path: string } | null>;
  };

  // Grading (attached to unified Exam)
  grading: {
    saveItem: (payload: SaveGradingItemPayload) => Promise<GradingItemDetail>;
    freezeRubric: (rubricId: string) => Promise<GradingItemDetail>;
    deleteItem: (itemId: string) => Promise<void>;
    uploadPhoto: (payload: {
      examId: string;
      role: 'answer' | 'reference';
      bytes: number[];
      mime: string;
      width: number;
      height: number;
    }) => Promise<PhotoAsset>;
    listSubmissions: (examId: string, itemId?: string) => Promise<GradingSubmission[]>;
    saveSubmission: (payload: {
      examId: string;
      itemId: string;
      membershipId: string;
      assetIds: string[];
      typedText?: string;
      completeness?: 'complete' | 'needs-attention';
    }) => Promise<GradingSubmission>;
    softDeleteSubmission: (submissionId: string) => Promise<void>;
    confirmDecision: (payload: {
      submissionId: string;
      rubricId: string;
      scores: Array<{ criterionId: string; units: number; reason: string }>;
      comment: string;
      source: 'manual' | 'ai-auto' | 'ai-assisted';
      confidence: number | null;
    }) => Promise<{ submission: GradingSubmission; syncedColumnId: string }>;
    saveKnowledgePoints: (examId: string, names: string[]) => Promise<Array<{ id: string; examId: string; name: string }>>;
    saveItemKnowledgeMap: (
      itemId: string,
      allocations: Array<{ knowledgeId: string; weightBps: number }>,
    ) => Promise<void>;
    getKnowledgeStats: (examId: string) => Promise<KnowledgeStatRow[]>;
  };

  // Trash Bin
  trash: {
    list: () => Promise<TrashItem[]>;
    restore: (kind: TrashItem['kind'], id: string) => Promise<void>;
    purge: (kind: TrashItem['kind'], id: string) => Promise<{ freedBytes: number }>;
    emptyAll: () => Promise<{ freedBytes: number }>;
  };

  // AI & Keychain (Main-process no-CORS proxy)
  ai: {
    getConfig: () => Promise<AiConfigView>;
    saveConfig: (input: AiConfigInput) => Promise<AiConfigView>;
    clearKeys: () => Promise<AiConfigView>;
    listModels: (params: {
      url: string;
      key?: string;
      fallbackRole?: 'general' | 'vision' | 'judge' | 'ocr';
    }) => Promise<RemoteModelInfo[]>;
    breakdownReference: (params: {
      prompt: string;
      referenceAnswer: string;
      referenceImageDataUrls: string[];
      totalScoreHint?: string;
    }) => Promise<BreakdownResult>;
    runBlindScan: (params: {
      imageDataUrls: string[];
      imageGate: Stage1ScanResult['imageGate'];
      typedText?: string;
      subjectHint?: string;
    }) => Promise<Stage1ScanResult>;
    runScoring: (params: {
      scan: Stage1ScanResult;
      scanText: string;
      rubricId: string;
      itemPrompt: string;
      threshold: number;
    }) => Promise<GradingResult>;
    chatExamTutor: (params: {
      examId: string;
      columnId?: string;
      privacyMode: 'summary-only' | 'anonymized-rows';
      messages: AiChatMessage[];
    }) => Promise<{ reply: string; sentPreview: string }>;
    generateHomeroomMaterial: (params: {
      classId: string;
      theme: string;
      partLabel: string;
      baseContent?: string;
      customPrompt?: string;
    }) => Promise<{ content: string }>;
  };

  // Homeroom Workbench (带班工作台)
  homeroom: {
    getDashboard: (classId: string, todayDate?: string) => Promise<HomeroomDashboardSummary>;
    toggleCheckin: (
      classId: string,
      type: HomeroomCheckinType,
      date?: string,
      forceValue?: boolean,
    ) => Promise<HomeroomDashboardSummary>;
    addFocusMinutes: (
      classId: string,
      minutes: number,
      date?: string,
    ) => Promise<{ todayFocusMinutes: number }>;
    listNotes: (classId: string, limitDays?: number) => Promise<HomeroomNoteDayGroup[]>;
    addNote: (
      classId: string,
      text: string,
      date?: string,
      time?: string,
    ) => Promise<HomeroomNoteEntry>;
    deleteNote: (classId: string, date: string, noteId: string) => Promise<void>;
    listTasks: (classId: string) => Promise<HomeroomTask[]>;
    saveTask: (payload: {
      classId: string;
      id?: string;
      title: string;
      category: HomeroomTaskCategory;
      priority: HomeroomTaskPriority;
      taskDate: string;
    }) => Promise<HomeroomTask>;
    toggleTask: (taskId: string) => Promise<HomeroomTask>;
    delayTask: (taskId: string, days?: number) => Promise<HomeroomTask>;
    deleteTask: (taskId: string) => Promise<void>;
    listComms: (classId: string, membershipId?: string) => Promise<StudentCommRecord[]>;
    saveComm: (payload: {
      classId: string;
      id?: string;
      membershipId?: string | null;
      studentName: string;
      commType: HomeroomCommType;
      commDate?: string;
      reason: string;
      studentPerf: string;
      parentFeedback: string;
      actionPlan: string;
      followUpDate?: string;
      status?: HomeroomCommStatus;
    }) => Promise<StudentCommRecord>;
    toggleCommStatus: (commId: string) => Promise<StudentCommRecord>;
    deleteComm: (commId: string) => Promise<void>;
    listMemos: (classId: string) => Promise<HomeroomMemo[]>;
    saveMemo: (payload: {
      classId: string;
      id?: string;
      title: string;
      tag: HomeroomMemoTag;
      content: string;
      memoDate?: string;
    }) => Promise<HomeroomMemo>;
    deleteMemo: (memoId: string) => Promise<void>;
    listSavedMaterials: (classId: string) => Promise<SavedMaterialRecord[]>;
    saveMaterial: (payload: {
      classId: string;
      themeKey: string;
      title: string;
      content: string;
      savedDate?: string;
    }) => Promise<SavedMaterialRecord>;
    deleteMaterial: (materialId: string) => Promise<void>;
    listCheckBatches: (classId: string, yearMonth?: string) => Promise<HomeroomCheckBatch[]>;
    saveCheckBatch: (payload: {
      classId: string;
      id?: string;
      checkDate: string;
      kind: HomeroomCheckKind;
      title: string;
      totalCount: number;
      anomalyMemberIds: string[];
    }) => Promise<HomeroomCheckBatch>;
    deleteCheckBatch: (batchId: string) => Promise<void>;
    getMonthlyStats: (classId: string, yearMonth: string) => Promise<HomeroomMonthlyStatsView>;
    saveMonthlyManualStats: (
      payload: HomeroomMonthlyStatsNumbers & { classId: string; yearMonth: string },
    ) => Promise<HomeroomMonthlyStatsView>;
    clearMonthlyManualStats: (
      classId: string,
      yearMonth: string,
    ) => Promise<HomeroomMonthlyStatsView>;
  };

  // Built-in Zhixuewang & Universal WebView Companion (WebContentsView)
  zhixue: {
    attach: (bounds: { x: number; y: number; width: number; height: number }, url?: string) => Promise<ZhixueState>;
    resize: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
    detach: () => Promise<void>;
    navigate: (url: string) => Promise<ZhixueState>;
    goBack: () => Promise<ZhixueState>;
    goForward: () => Promise<ZhixueState>;
    reload: () => Promise<ZhixueState>;
    captureRegion: (rect?: { x: number; y: number; width: number; height: number }) => Promise<{
      dataUrl: string;
      width: number;
      height: number;
    }>;
    fillScore: (scoreText: string, selectorHint?: string) => Promise<{ ok: boolean; detail: string }>;
    onStateChange: (cb: (state: ZhixueState) => void) => () => void;
  };
}
