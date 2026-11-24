import type {
  HomeroomCheckKind,
  HomeroomCheckinType,
  HomeroomCommStatus,
  HomeroomCommType,
  HomeroomMemoTag,
  HomeroomTaskCategory,
  HomeroomTaskPriority,
} from './homeroom-materials';

export type {
  HomeroomCheckKind,
  HomeroomCheckinType,
  HomeroomCommStatus,
  HomeroomCommType,
  HomeroomMemoTag,
  HomeroomTaskCategory,
  HomeroomTaskPriority,
};

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export type Gender = 'male' | 'female' | 'unspecified';
export type ScoreStatus = 'score' | 'missing' | 'absent' | 'exempt';
export type ExamColumnSource = 'import' | 'grading' | 'manual';
export type ScoreSeatingStrategy = 'snake' | 'pair-help' | 'high-front' | 'group-balanced';

export type NavSpace = 'hub' | 'classroom' | 'roster' | 'exams' | 'homeroom' | 'qbank' | 'zhixue';
export type PinnableSpace = Exclude<NavSpace, 'hub'>;
export const DEFAULT_PINNED_SPACES: PinnableSpace[] = [
  'classroom',
  'roster',
  'exams',
  'homeroom',
  'qbank',
  'zhixue',
];

export interface TeacherProfile {
  name: string;
  gender: Gender;
  characterId: string | null;
}

export interface VaultInfo {
  path: string;
  name: string;
  schemaVersion: number;
  createdAt: string;
  dbBytes: number;
  photoCount: number;
  photoBytes: number;
  qbankQuestionCount: number;
  qbankBytes: number;
}

export interface AppPreferences {
  themeId: string;
  vaultPath: string;
  sidebarCollapsed: boolean;
  recentVaults: string[];
  pinnedSpaces: PinnableSpace[];
  updateMirrorUrl?: string;
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'error';

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseNotes: string;
  releaseUrl: string;
  publishedAt: string | null;
  assetName: string | null;
  assetSize: number;
  downloadedBytes: number;
  progressPct: number;
  sha256Verified: boolean;
  stagedAppPath: string | null;
  downloadedFilePath: string | null;
  canAutoInstall: boolean;
  checkedAt: string | null;
  error: string | null;
}

export interface ClassRecord {
  id: string;
  name: string;
  school: string;
  termLabel: string;
  status: 'active' | 'archived';
  createdAt: string;
  deletedAt: string | null;
  memberCount: number;
  examCount: number;
}

export interface StudentMember {
  membershipId: string;
  studentId: string;
  classId: string;
  name: string;
  gender: Gender;
  characterId: string | null;
  rosterNo: string;
  sortOrder: number;
  status: 'active' | 'removed';
}

export interface StudentInput {
  name: string;
  rosterNo: string;
  gender: Gender;
  characterId?: string | null;
}

export interface SeatAssignment {
  membershipId: string;
  row: number;
  col: number;
}

export interface SeatPlan {
  id: string;
  classId: string;
  name: string;
  rows: number;
  cols: number;
  assignments: SeatAssignment[];
  createdAt: string;
}

export interface StudentExamPoint {
  examId: string;
  examTitle: string;
  examDate: string;
  columnId: string;
  columnLabel: string;
  units: number | null;
  maxUnits: number | null;
  status: ScoreStatus;
  rank: number | null;
  totalScored: number;
  classMeanUnits: number | null;
}

export interface StudentSubmissionBrief {
  submissionId: string;
  examId: string;
  examTitle: string;
  itemId: string;
  itemLabel: string;
  assetRelPaths: string[];
  scoreUnits: number | null;
  maxUnits: number;
  updatedAt: string;
}

export interface StudentDailySummary {
  attendanceAnomalies: number;
  homeworkMissing: number;
  receiptMissing: number;
  disciplineCount: number;
  recentBatches: Array<{
    id: string;
    checkDate: string;
    kind: HomeroomCheckKind;
    title: string;
  }>;
}

export interface StudentGrowthProfile {
  member: StudentMember;
  seat: { planId: string; planName: string; row: number; col: number } | null;
  examHistory: StudentExamPoint[];
  recentSubmissions: StudentSubmissionBrief[];
  comms: StudentCommRecord[];
  dailySummary: StudentDailySummary;
}

export interface ExamSummary {
  id: string;
  classId: string;
  title: string;
  examDate: string;
  notes: string;
  sourceFile: string | null;
  createdAt: string;
  deletedAt: string | null;
  columnCount: number;
  gradingItemCount: number;
  scoredStudents: number;
  meanUnits: number | null;
  maxUnits: number | null;
}

export interface ExamColumn {
  id: string;
  examId: string;
  key: string;
  label: string;
  role: 'score' | 'total';
  source: ExamColumnSource;
  gradingItemId: string | null;
  maxUnits: number | null;
  sortOrder: number;
}

export interface ExamScoreCell {
  id: string;
  examId: string;
  columnId: string;
  membershipId: string;
  status: ScoreStatus;
  units: number | null;
  rawText: string;
  correctedText: string | null;
  fromFormula: boolean;
  updatedAt: string;
}

export interface ScoringUnit {
  id: string;
  label: string;
  maxUnits: number;
}

export interface RubricCriterion {
  id: string;
  scoringUnitId: string;
  description: string;
  maxUnits: number;
  stepUnits: number;
  exclusiveGroup: string | null;
}

export interface Rubric {
  id: string;
  itemId: string;
  version: number;
  referenceAnswer: string;
  frozenAt: string | null;
  criteria: RubricCriterion[];
  createdAt: string;
}

export interface PhotoAsset {
  id: string;
  examId: string;
  hash: string;
  relPath: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  role: 'answer' | 'reference';
  createdAt: string;
}

export interface KnowledgePoint {
  id: string;
  examId: string;
  name: string;
}

export interface KnowledgeAllocation {
  knowledgeId: string;
  knowledgeName: string;
  weightBps: number;
}

export interface GradingItemDetail {
  id: string;
  examId: string;
  label: string;
  prompt: string;
  maxUnits: number;
  referenceAssets: PhotoAsset[];
  scoringUnits: ScoringUnit[];
  rubric: Rubric | null;
  submissionCount: number;
  confirmedCount: number;
  linkedColumnId: string | null;
  knowledgeMappings: KnowledgeAllocation[];
}

export interface GradingDecision {
  id: string;
  submissionId: string;
  rubricId: string;
  totalUnits: number;
  scores: Array<{ criterionId: string; units: number; reason: string }>;
  comment: string;
  source: 'manual' | 'ai-auto' | 'ai-assisted';
  confidence: number | null;
  confirmedAt: string;
}

export interface GradingSubmission {
  id: string;
  examId: string;
  itemId: string;
  membershipId: string;
  studentName: string;
  rosterNo: string;
  typedText: string;
  assets: PhotoAsset[];
  completeness: 'complete' | 'needs-attention';
  decision: GradingDecision | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreAuditLog {
  id: string;
  examId: string;
  membershipId: string;
  studentName: string;
  targetLabel: string;
  oldValue: string;
  newValue: string;
  reason: string;
  createdAt: string;
}

export interface ExamDetail {
  exam: ExamSummary;
  columns: ExamColumn[];
  scores: ExamScoreCell[];
  gradingItems: GradingItemDetail[];
  knowledgePoints: KnowledgePoint[];
  auditLogs: ScoreAuditLog[];
}

export interface ClassExamTrendPoint {
  examId: string;
  title: string;
  examDate: string;
  columnLabel: string;
  count: number;
  meanUnits: number | null;
  medianUnits: number | null;
  maxUnits: number | null;
  passRate: number | null;
  excellentRate: number | null;
}

export interface KnowledgeStatRow {
  knowledgeId: string;
  name: string;
  earnedUnits: number;
  possibleUnits: number;
  rate: number;
  itemLabels: string[];
}

export interface TrashItem {
  kind: 'class' | 'exam' | 'submission';
  id: string;
  title: string;
  subtitle: string;
  deletedAt: string;
  photoCount: number;
  photoBytes: number;
}

export interface AiRoleConfigInput {
  mode: 'inherit' | 'custom';
  url: string;
  model: string;
  key?: string;
}

export interface AiOcrConfigInput {
  mode: 'off' | 'vision-model' | 'http-ocr';
  url: string;
  model: string;
  key?: string;
}

export interface AiConfigInput {
  general?: {
    provider: 'deepseek' | 'custom';
    url: string;
    model: string;
    key?: string;
  };
  vision?: AiRoleConfigInput;
  judge?: AiRoleConfigInput;
  ocr?: AiOcrConfigInput;
  doc2x?: {
    enabled: boolean;
    key?: string;
  };
}

export interface AiRoleConfigView {
  mode: 'inherit' | 'custom';
  url: string;
  model: string;
  hasKey: boolean;
  ready: boolean;
  effectiveLabel: string;
}

export interface AiConfigView {
  secureStorageAvailable: boolean;
  general: {
    provider: 'deepseek' | 'custom';
    url: string;
    model: string;
    hasKey: boolean;
    ready: boolean;
  };
  vision: AiRoleConfigView;
  judge: AiRoleConfigView;
  ocr: {
    mode: 'off' | 'vision-model' | 'http-ocr';
    url: string;
    model: string;
    hasKey: boolean;
    ready: boolean;
    effectiveLabel: string;
  };
  doc2x: {
    enabled: boolean;
    hasKey: boolean;
    ready: boolean;
  };
}

export interface RemoteModelInfo {
  id: string;
  name?: string;
  vision?: boolean;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ZhixueState {
  attached: boolean;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface ZhixueRoiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ZhixueScoreOption {
  id: string;
  label: string;
  value: number | null;
  selector: string;
}

export interface ZhixueScoreInputInfo {
  id: string;
  label: string;
  placeholder: string;
  selector: string;
}

export interface ZhixueSubmitControl {
  id: string;
  label: string;
  selector: string;
}

export interface ZhixueCrawledControls {
  url: string;
  crawledAt: string;
  scoreOptions: ZhixueScoreOption[];
  scoreInputs: ZhixueScoreInputInfo[];
  submitButton: ZhixueSubmitControl | null;
  inferredMax: number | null;
  inferredStep: number | null;
  summary: string;
}

export interface ZhixueSiteProfile {
  origin: string;
  roi: ZhixueRoiRect | null;
  scoreGroupSelector?: string;
  submitSelector?: string;
  autoDelaySec?: number;
}

export interface ZhixueApplyScoreResult {
  ok: boolean;
  clickedOptionLabel?: string;
  filledInput?: boolean;
  submitted: boolean;
  detail: string;
}

export interface ZhixuePaperChangeResult {
  diffFromBaseline: number;
  diffFromPrev: number;
  stableChanged: boolean;
}

export interface CharacterCatalog {
  teacherDefaults: { male: string; female: string };
  characters: Array<{
    id: string;
    name: string;
    gender: 'male' | 'female';
    sheetId: string;
    front: [number, number, number, number];
    back: [number, number, number, number];
  }>;
  scene: {
    desk: { sheetId: string; rect: [number, number, number, number] };
    chairFront: { sheetId: string; rect: [number, number, number, number] };
  };
}

// ============================================================================
// Homeroom Workbench (带班工作台) Types
// ============================================================================

export interface HomeroomNoteEntry {
  id: string;
  time: string;
  text: string;
}

export interface HomeroomNoteDayGroup {
  date: string;
  entries: HomeroomNoteEntry[];
}

export interface HomeroomTask {
  id: string;
  classId: string;
  title: string;
  category: HomeroomTaskCategory;
  priority: HomeroomTaskPriority;
  taskDate: string;
  done: boolean;
  createdAt: string;
}

export interface StudentCommRecord {
  id: string;
  classId: string;
  membershipId: string | null;
  studentName: string;
  commType: HomeroomCommType;
  commDate: string;
  reason: string;
  studentPerf: string;
  parentFeedback: string;
  actionPlan: string;
  followUpDate: string;
  status: HomeroomCommStatus;
  createdAt: string;
  updatedAt: string;
}

export interface HomeroomMemo {
  id: string;
  classId: string;
  title: string;
  tag: HomeroomMemoTag;
  content: string;
  memoDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedMaterialRecord {
  id: string;
  classId: string;
  themeKey: string;
  title: string;
  content: string;
  savedDate: string;
  createdAt: string;
}

export interface HomeroomCheckBatch {
  id: string;
  classId: string;
  checkDate: string;
  kind: HomeroomCheckKind;
  title: string;
  totalCount: number;
  anomalyMemberIds: string[];
  createdAt: string;
}

export interface HomeroomMonthlyStatsNumbers {
  classSize: number;
  attendCount: number;
  absentCount: number;
  hwShould: number;
  hwMiss: number;
  disciplineCount: number;
  receiptShould: number;
  receiptGot: number;
}

export interface HomeroomMonthlyStatsView {
  yearMonth: string;
  hasManualOverride: boolean;
  manual: (HomeroomMonthlyStatsNumbers & { updatedAt: string }) | null;
  auto: HomeroomMonthlyStatsNumbers & {
    meetingCount: number;
    commCount: number;
    batchCount: number;
  };
  effective: HomeroomMonthlyStatsNumbers & {
    meetingCount: number;
    commCount: number;
  };
}

export interface HomeroomDashboardSummary {
  todayDate: string;
  todayTodoCount: number;
  todayDoneCount: number;
  pendingFollowUpCount: number;
  pendingSafetyTaskCount: number;
  pendingFollowUpMemberIds: string[];
  todayFocusMinutes: number;
  checkinTotals: Record<HomeroomCheckinType, number>;
  todayCheckins: Record<HomeroomCheckinType, boolean>;
  recent7Days: Array<{
    date: string;
    checkins: Record<HomeroomCheckinType, boolean>;
  }>;
}
