export type TableCell = {
  text: string;
  value: string | number | null;
  formula: boolean;
  error?: string;
};

export type TableSheet = {
  name: string;
  rows: TableCell[][];
  merges: { startRow: number; endRow: number; startCol: number; endCol: number }[];
  warnings: string[];
};

export type TableBook = { sheets: TableSheet[] };

export type ColumnRole = 'ignore' | 'name' | 'number' | 'class' | 'gender' | 'score' | 'total';

export type ColumnMapping = {
  index: number;
  label: string;
  role: ColumnRole;
  max: string;
};

export type TableMapping = {
  headerStart: number;
  headerEnd: number;
  sourceClass: string;
  columns: ColumnMapping[];
};

export const TABLE_LIMITS = {
  fileBytes: 12 * 1024 ** 2,
  expandedBytes: 48 * 1024 ** 2,
  rows: 5000,
  cols: 200,
  cells: 200000,
};
