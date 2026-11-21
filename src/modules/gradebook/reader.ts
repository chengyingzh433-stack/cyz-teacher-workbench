import { AppError } from '../../app/model';
import { sha256 } from '../assets';
import { TABLE_LIMITS, type TableBook } from './table';
declare const __GRADEBOOK_WORKER__: string;
export async function readGradeTable(
  file: File,
  encoding = 'utf-8',
  signal?: AbortSignal,
): Promise<{ book: TableBook; hash: string }> {
  if (file.size > TABLE_LIMITS.fileBytes)
    throw new AppError('TABLE_LIMIT', '文件超过 12 MiB，请拆分');
  const bytes = await file.arrayBuffer();
  if (signal?.aborted) throw new AppError('CANCELLED', '读取已取消');
  const hash = await sha256(new Uint8Array(bytes));
  if (signal?.aborted) throw new AppError('CANCELLED', '读取已取消');
  const url = URL.createObjectURL(new Blob([__GRADEBOOK_WORKER__], { type: 'text/javascript' }));
  let worker: Worker;
  try {
    worker = new Worker(url);
  } catch {
    URL.revokeObjectURL(url);
    throw new AppError('WORKER', '当前浏览器不能启动本地表格解析，请换用支持本地 Worker 的浏览器');
  }
  return new Promise((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      URL.revokeObjectURL(url);
    };
    const cancel = () => {
      clean();
      reject(new AppError('CANCELLED', '读取已取消'));
    };
    const timer = setTimeout(() => {
      clean();
      reject(
        new AppError('TABLE_TIMEOUT', '表格解析超过 20 秒，已停止；请减少工作表或另存精简文件'),
      );
    }, 20000);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onerror = () => {
      clean();
      reject(new AppError('TABLE_PARSE', '表格解析失败，请检查文件或另存为 XLSX/CSV'));
    };
    worker.onmessage = (e: MessageEvent<{ ok: boolean; book: TableBook; error: string }>) => {
      clean();
      if (e.data.ok) resolve({ book: e.data.book, hash });
      else reject(new AppError('TABLE_PARSE', e.data.error));
    };
    worker.postMessage({ bytes, name: file.name, encoding }, [bytes]);
  });
}
