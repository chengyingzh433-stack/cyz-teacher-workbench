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
  Rubric,
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
  ZhixueApplyScoreResult,
  ZhixueCrawledControls,
  ZhixuePaperChangeResult,
  ZhixueRoiRect,
  ZhixueSiteProfile,
  ZhixueState,
} from './types';
import type { TableBook, TableMapping } from './gradebook/table';
import type { BreakdownResult, GradingResult, Stage1ScanResult } from './ai-engine';
import type {
  ContentRevisionDTO,
  QuestionAssetDTO,
  WordExportOptions,
} from './qbank/editable';
import type {
  BankFilterInput,
  BankQuestionDTO,
  EditableQuestionDTO,
  IntakeBlock,
  IntakeDraftDTO,
  IntakeSourceDTO,
  IntakeSourceKind,
  IntakeWorkspaceDTO,
  KnowledgePointDTO,
  PaperSetDetailDTO,
  PaperSetDTO,
  QbankOcrJobDTO,
  QbankOcrPart,
  QbankOcrProvider,
  QbankTaxonomyDTO,
  QuestionFolderDTO,
  QuestionMetadataInput,
  SaveQuestionEditsInput,
} from './qbank/types';

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
  openExternal: (url: string) => Promise<void>;

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
      rubricId?: string;
      inlineRubric?: Rubric;
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
    captureRegion: (rect?: ZhixueRoiRect) => Promise<{
      dataUrl: string;
      width: number;
      height: number;
    }>;
    getSiteProfile: (url?: string) => Promise<ZhixueSiteProfile>;
    saveSiteProfile: (patch: Partial<ZhixueSiteProfile> & { url?: string }) => Promise<ZhixueSiteProfile>;
    pickRegion: () => Promise<ZhixueRoiRect | null>;
    cancelPickRegion: () => Promise<void>;
    setRoiHighlight: (rect: ZhixueRoiRect | null, visible: boolean) => Promise<void>;
    crawlControls: (hints?: {
      scoreGroupSelector?: string;
      submitSelector?: string;
    }) => Promise<ZhixueCrawledControls>;
    pickElement: (role: 'score-group' | 'submit') => Promise<{ selector: string; label: string } | null>;
    cancelPickElement: () => Promise<void>;
    applyScore: (params: {
      scoreText: string;
      optionId?: string;
      autoSubmit?: boolean;
      scoreGroupSelector?: string;
      submitSelector?: string;
    }) => Promise<ZhixueApplyScoreResult>;
    markPaperBaseline: (rect?: ZhixueRoiRect) => Promise<void>;
    checkPaperChanged: (rect?: ZhixueRoiRect) => Promise<ZhixuePaperChangeResult>;
    fillScore: (scoreText: string, selectorHint?: string) => Promise<{ ok: boolean; detail: string }>;
    onStateChange: (cb: (state: ZhixueState) => void) => () => void;
    onEscapePressed: (cb: () => void) => () => void;
  };

  // Physics Question Bank (物理题库)
  qbank: {
    taxonomy: {
      get: () => Promise<QbankTaxonomyDTO>;
      addKnowledgePoint: (name: string) => Promise<KnowledgePointDTO>;
    };
    intake: {
      listSources: () => Promise<IntakeSourceDTO[]>;
      pickAndImport: () => Promise<IntakeWorkspaceDTO | null>;
      importBytes: (input: {
        name: string;
        kind: IntakeSourceKind;
        bytes: number[];
        pageCount?: number;
      }) => Promise<IntakeWorkspaceDTO>;
      getWorkspace: (sourceId: string) => Promise<IntakeWorkspaceDTO>;
      deleteSource: (sourceId: string) => Promise<void>;
      createDraft: (
        sourceId: string,
        inheritMetadata?: QuestionMetadataInput,
      ) => Promise<IntakeDraftDTO>;
      updateDraft: (
        draftId: string,
        patch: {
          questionBlocks?: IntakeBlock[];
          answerBlocks?: IntakeBlock[];
          metadata?: QuestionMetadataInput;
          originalRelPath?: string | null;
        },
      ) => Promise<IntakeDraftDTO>;
      deleteDraft: (draftId: string) => Promise<void>;
      saveCroppedImage: (
        sourceId: string,
        input: { bytes: number[]; name?: string; cropWidthRatio?: number | null },
      ) => Promise<{ relPath: string; widthPx: number; heightPx: number; widthPercent: number }>;
      publishDraft: (
        draftId: string,
        originalBytes?: number[] | null,
      ) => Promise<{ questionId: number; draft: IntakeDraftDTO; nextDraft: IntakeDraftDTO }>;
    };
    content: {
      getEditable: (questionId: number) => Promise<EditableQuestionDTO>;
      saveEdits: (questionId: number, input: SaveQuestionEditsInput) => Promise<EditableQuestionDTO>;
      listRevisions: (questionId: number) => Promise<ContentRevisionDTO[]>;
      restoreRevision: (questionId: number, revision: number) => Promise<EditableQuestionDTO>;
      saveAsset: (questionId: number, bytes: number[], name: string) => Promise<QuestionAssetDTO>;
    };
    bank: {
      search: (filter?: BankFilterInput) => Promise<BankQuestionDTO[]>;
      createManual: (input: {
        questionText: string;
        answerText?: string;
        metadata?: QuestionMetadataInput;
      }) => Promise<BankQuestionDTO>;
      deleteQuestion: (questionId: number) => Promise<void>;
    };
    folders: {
      list: () => Promise<QuestionFolderDTO[]>;
      create: (name: string) => Promise<QuestionFolderDTO>;
      rename: (id: number, name: string) => Promise<QuestionFolderDTO>;
      delete: (id: number) => Promise<void>;
      setMembership: (folderId: number, questionId: number, included: boolean) => Promise<void>;
    };
    basket: {
      listSets: () => Promise<PaperSetDTO[]>;
      createSet: (title: string) => Promise<PaperSetDTO>;
      deleteSet: (setId: number) => Promise<void>;
      getSetDetail: (setId: number) => Promise<PaperSetDetailDTO>;
      add: (setId: number, questionId: number) => Promise<PaperSetDetailDTO>;
      remove: (setId: number, questionId: number) => Promise<PaperSetDetailDTO>;
      clear: (setId: number) => Promise<PaperSetDetailDTO>;
      reorder: (setId: number, itemIds: number[]) => Promise<PaperSetDetailDTO>;
      updateItem: (
        itemId: number,
        patch: { displayNumber?: string; groupHeader?: string },
      ) => Promise<PaperSetDetailDTO>;
      saveOptions: (setId: number, options: WordExportOptions) => Promise<WordExportOptions>;
    };
    export: {
      docx: (setId: number, options: Partial<WordExportOptions>) => Promise<{ path: string } | null>;
      pdf: (setId: number, options: Partial<WordExportOptions>) => Promise<{ path: string } | null>;
      pptx: (setId: number, options: Partial<WordExportOptions>) => Promise<{ path: string } | null>;
    };
    ocr: {
      listJobs: (questionId: number, part?: QbankOcrPart) => Promise<QbankOcrJobDTO[]>;
      run: (params: {
        questionId: number;
        part: QbankOcrPart;
        provider: QbankOcrProvider;
        imageBytes?: number[] | null;
      }) => Promise<QbankOcrJobDTO>;
      adopt: (jobId: string) => Promise<EditableQuestionDTO>;
    };
  };
}
