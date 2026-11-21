import { parseGradeWorkbook } from './workbook';
self.onmessage = (event: MessageEvent<{ bytes: ArrayBuffer; name: string; encoding: string }>) => {
  try {
    const { bytes, name, encoding } = event.data;
    self.postMessage({ ok: true, book: parseGradeWorkbook(new Uint8Array(bytes), name, encoding) });
  } catch (error) {
    self.postMessage({ ok: false, error: (error as Error).message || '无法读取表格' });
  }
};
