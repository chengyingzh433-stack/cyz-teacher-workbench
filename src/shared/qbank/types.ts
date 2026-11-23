import type {
  ContentMode,
  EditableDocument,
  QuestionAssetDTO,
  QuestionContentDTO,
  QuestionContentInput,
  WordExportOptions,
} from './editable';

export interface QuestionTypeDTO {
  id: number;
  name: string;
}

export interface ChapterNodeDTO {
  id: number;
  key: string;
  name: string;
  parentId: number | null;
  sortOrder: number;
}

export interface KnowledgePointDTO {
  id: number;
  name: string;
}

export interface DifficultyDTO {
  id: number;
  level: number;
  name: string;
}

export interface QbankTaxonomyDTO {
  types: QuestionTypeDTO[];
  chapters: ChapterNodeDTO[];
  knowledgePoints: KnowledgePointDTO[];
  difficulties: DifficultyDTO[];
}

export interface QuestionMetadataInput {
  typeId: number | null;
  chapterId: number | null;
  difficultyId: number | null;
  knowledgePointIds: number[];
  year: number | null;
  source: string | null;
}

export const emptyQuestionMetadata = (): QuestionMetadataInput => ({
  typeId: null,
  chapterId: null,
  difficultyId: null,
  knowledgePointIds: [],
  year: null,
  source: null,
});

export interface BankQuestionDTO {
  id: number;
  paperId: number | null;
  imageRelPath: string | null;
  answerImageRelPath: string | null;
  typeId: number | null;
  typeName: string | null;
  chapterId: number | null;
  chapterName: string | null;
  difficultyId: number | null;
  difficultyName: string | null;
  knowledgePoints: KnowledgePointDTO[];
  year: number | null;
  source: string | null;
  questionMode: ContentMode;
  answerMode: ContentMode;
  previewText: string;
  snippet: string | null;
  assetCount: number;
  hasAnswer: boolean;
  folderIds: number[];
  inBasket: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BankFilterInput {
  query?: string;
  typeId?: number | null;
  chapterId?: number | null;
  difficultyId?: number | null;
  knowledgePointId?: number | null;
  folderId?: number | null;
  year?: number | null;
  limit?: number;
}

export interface EditableQuestionDTO {
  question: BankQuestionDTO;
  content: QuestionContentDTO;
  assets: QuestionAssetDTO[];
  metadata: QuestionMetadataInput;
}

export interface SaveQuestionEditsInput {
  content: QuestionContentInput;
  expectedRevision: number;
  metadata: QuestionMetadataInput;
}

// ============================================================================
// Continuous Intake (连续录题)
// ============================================================================

export type IntakeSourceKind = 'pdf' | 'docx' | 'image';

export interface IntakeSourceDTO {
  id: string;
  name: string;
  kind: IntakeSourceKind;
  relPath: string;
  pageCount: number;
  draftCount: number;
  publishedCount: number;
  createdAt: string;
}

export type IntakeBlock =
  | { id: string; kind: 'text'; text: string }
  | {
      id: string;
      kind: 'image';
      relPath: string;
      widthPx: number;
      heightPx: number;
      widthPercent: number;
      caption: string;
    };

export interface IntakeDraftDTO {
  id: string;
  sourceId: string;
  status: 'draft' | 'published';
  questionId: number | null;
  questionBlocks: IntakeBlock[];
  answerBlocks: IntakeBlock[];
  metadata: QuestionMetadataInput;
  originalRelPath: string | null;
  updatedAt: string;
}

export interface IntakeWorkspaceDTO {
  source: IntakeSourceDTO;
  drafts: IntakeDraftDTO[];
}

// ============================================================================
// Folders & Basket (收藏夹与组卷篮)
// ============================================================================

export interface QuestionFolderDTO {
  id: number;
  name: string;
  questionCount: number;
  createdAt: string;
}

export interface PaperSetDTO {
  id: number;
  title: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaperSetItemDTO {
  id: number;
  setId: number;
  questionId: number;
  sortOrder: number;
  displayNumber: string;
  groupHeader: string;
  question: BankQuestionDTO;
}

export interface PaperSetDetailDTO {
  set: PaperSetDTO;
  items: PaperSetItemDTO[];
  wordOptions: WordExportOptions;
}

// ============================================================================
// AI / OCR Recognition (统一 AI + 可选 Doc2X)
// ============================================================================

export type QbankOcrProvider = 'workbench-ai' | 'doc2x';
export type QbankOcrPart = 'question' | 'answer';

export interface QbankOcrCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QbankOcrIssue {
  id: string;
  kind: 'formula' | 'missing_image' | 'table' | 'unsupported' | 'conversion';
  message: string;
  original: string;
}

export interface QbankOcrJobDTO {
  id: string;
  questionId: number;
  part: QbankOcrPart;
  provider: QbankOcrProvider;
  status: 'processing' | 'paused' | 'ready' | 'failed';
  remoteUid: string | null;
  rawMarkdown: string | null;
  candidateDoc: EditableDocument | null;
  issues: QbankOcrIssue[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
