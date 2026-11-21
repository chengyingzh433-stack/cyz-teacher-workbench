import { read, utils, SSF, type WorkBook } from 'xlsx';
import { TABLE_LIMITS, type TableBook, type TableCell } from './table';
// Parsing only: no workbook formulas, macros, URLs or business mutations are executed.
function inspectContainer(bytes: Uint8Array) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('Excel 压缩目录损坏');
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true),
    offset = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    count > 2000 ||
    offset + size !== end
  )
    throw new Error('不支持分卷、ZIP64 或过多内部文件的 Excel');
  let cursor = offset,
    total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error('Excel 压缩目录不完整');
    const flags = view.getUint16(cursor + 8, true),
      method = view.getUint16(cursor + 10, true),
      expanded = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true),
      extra = view.getUint16(cursor + 30, true),
      comment = view.getUint16(cursor + 32, true);
    if (flags & 1 || ![0, 8].includes(method) || expanded > TABLE_LIMITS.expandedBytes)
      throw new Error('不支持加密或超大 Excel 内容');
    if (cursor + 46 + nameLength + extra + comment > end) throw new Error('Excel 目录越界');
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (names.has(name) || name.includes('..') || name.startsWith('/') || name.includes('\\'))
      throw new Error('Excel 内部路径无效');
    names.add(name);
    total += expanded;
    if (total > TABLE_LIMITS.expandedBytes)
      throw new Error('Excel 解压内容超过 48 MiB，请另存精简工作簿');
    cursor += 46 + nameLength + extra + comment;
  }
  if (cursor !== end) throw new Error('Excel 目录长度不一致');
}
export function parseGradeWorkbook(bytes: Uint8Array, name: string, encoding: string): TableBook {
  if (bytes.length > TABLE_LIMITS.fileBytes) throw new Error('成绩单超过 12 MiB，请拆分工作簿');
  const textFile = /\.(csv|tsv|txt)$/i.test(name);
  if (!textFile && !/\.(xlsx|xls)$/i.test(name))
    throw new Error('请选择 XLSX、XLS、CSV、TSV 或 TXT 文件');
  if (!textFile) {
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b,
      cfb = bytes[0] === 0xd0 && bytes[1] === 0xcf;
    if (!zip && !cfb) throw new Error('文件字节不是受支持的 Excel，请从表格软件另存为 XLSX');
    inspectContainer(bytes);
  }
  const input = textFile
    ? new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\ufeff/, '')
    : bytes;
  const workbook: WorkBook = read(input, {
    type: textFile ? 'string' : 'array',
    raw: true,
    cellFormula: true,
    sheetStubs: true,
    cellNF: true,
    cellText: true,
    cellStyles: true,
    cellHTML: false,
    bookVBA: false,
    sheetRows: TABLE_LIMITS.rows + 1,
    ...(name.toLowerCase().endsWith('.tsv') ? { FS: '\t' } : {}),
  });
  if (workbook.SheetNames.length > 50) throw new Error('工作表超过 50 张，请拆分');
  let count = 0;
  const sheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName],
      warnings: string[] = [];
    const ref = sheet['!fullref'] || sheet['!ref'];
    if (!ref) return { name: sheetName, rows: [], merges: [], warnings };
    const range = utils.decode_range(ref);
    if (range.e.r >= TABLE_LIMITS.rows || range.e.c >= TABLE_LIMITS.cols)
      throw new Error(`“${sheetName}”超过 5000 行或 200 列（含表头），请删除多余格式或拆分`);
    count += (range.e.r + 1) * (range.e.c + 1);
    if (count > TABLE_LIMITS.cells) throw new Error('工作簿超过 20 万个表格单元，请拆分');
    const merges = sheet['!merges'] || [];
    if (
      merges.length > 10000 ||
      merges.some(
        (m) =>
          m.s.r < 0 ||
          m.s.c < 0 ||
          m.e.r >= TABLE_LIMITS.rows ||
          m.e.c >= TABLE_LIMITS.cols ||
          m.s.r > m.e.r ||
          m.s.c > m.e.c,
      )
    )
      throw new Error('合并单元格数量或范围超过限制，请简化表头');
    const rows: TableCell[][] = [];
    for (let r = 0; r <= range.e.r; r++) {
      const row: TableCell[] = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = sheet[utils.encode_cell({ r, c })];
        const formula = Boolean(cell?.f || cell?.F);
        // In the pinned SheetJS reader an OOXML formula without <v> can have t='z'
        // and v=0. A genuine cached numeric zero has t='n'. Never read a stub's payload.
        const value = cell?.t === 'z' ? null : cell?.v;
        const missingCache = formula && (value == null || value === '');
        const text = !cell || missingCache ? '' : String(cell.w ?? value ?? '');
        if (text.length > 2000)
          throw new Error(`“${sheetName}”第 ${r + 1} 行单元格文字过长，请移出说明性长文本`);
        row.push({
          text,
          value: typeof value === 'number' || typeof value === 'string' ? value : null,
          formula,
          ...(missingCache
            ? { error: '公式没有可核对的缓存结果，请重算保存或手动填写' }
            : cell?.t === 'e'
              ? { error: 'Excel 错误单元格' }
              : cell?.t === 'd' || (cell?.z && SSF.is_date(cell.z) && cell?.t === 'n')
                ? { error: '日期格式不能作为分数或编号' }
                : cell?.t === 'n' && cell?.z?.includes('%')
                  ? { error: '百分比不是原始分数，请按实际满分更正，或忽略该列' }
                  : {}),
        });
      }
      rows.push(row);
    }
    if (sheet['!rows']?.some((r) => r?.hidden) || sheet['!cols']?.some((c) => c?.hidden))
      warnings.push('本表包含隐藏行或列，预览中仍会列出，请核对排除范围');
    if (workbook.Workbook?.Sheets?.find((s) => s.name === sheetName)?.Hidden)
      warnings.push('这是隐藏工作表');
    return {
      name: sheetName,
      rows,
      merges: (sheet['!merges'] || []).map((m) => ({
        startRow: m.s.r,
        endRow: m.e.r,
        startCol: m.s.c,
        endCol: m.e.c,
      })),
      warnings,
    };
  });
  return { sheets };
}
