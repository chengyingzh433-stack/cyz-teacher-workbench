import { AppError, id } from '../../app/model';
import { inspectImage, LIMITS } from './index';
import type { AnswerAsset } from '../grading/model';
export type PreparedAsset = { asset: AnswerAsset; blob: Blob };
export function checkPreparationBudget(assets: AnswerAsset[], incoming: Blob[] = []) {
  const unique = [...new Map(assets.map((a) => [a.hash, a])).values()];
  if (
    assets.length + incoming.length > LIMITS.assets ||
    unique.reduce((sum, a) => sum + a.bytes, 0) + incoming.reduce((sum, f) => sum + f.size, 0) >
      LIMITS.totalAssetBytes ||
    unique.reduce((sum, a) => sum + a.width * a.height, 0) > LIMITS.totalPixels
  )
    throw new AppError(
      'ASSET_LIMIT',
      '工作区与当前整理中的附件超过预算，请减少本批文件或取消未保存的整理',
    );
}
export async function prepareBatch(
  files: File[],
  role: AnswerAsset['role'],
  existing: AnswerAsset[],
): Promise<PreparedAsset[]> {
  checkPreparationBudget(existing, files);
  const batch: PreparedAsset[] = [];
  for (const file of files) {
    try {
      batch.push(await prepareOriginal(file, role));
    } catch (error) {
      throw new AppError('INVALID_ASSET', `${file.name}：${(error as Error).message}`);
    }
    checkPreparationBudget([...existing, ...batch.map((p) => p.asset)]);
  }
  return batch;
}
export async function prepareOriginal(
  file: Blob,
  role: AnswerAsset['role'],
): Promise<PreparedAsset> {
  const { blob, ...metadata } = await inspectImage(file);
  return {
    asset: {
      ...metadata,
      id: id(),
      role,
      originalId: null,
      transforms: [],
      createdAt: new Date().toISOString(),
    },
    blob,
  };
}
export async function transformAsset(
  source: PreparedAsset,
  transform: AnswerAsset['transforms'][number],
): Promise<PreparedAsset> {
  const a = source.asset;
  if (a.transforms.length >= 20)
    throw new AppError('ASSET_LIMIT', '变换次数已达上限，请从原件重新整理');
  let width = a.width,
    height = a.height;
  if (transform.kind === 'crop') {
    const t = transform;
    if (
      ![t.x, t.y, t.width, t.height].every(Number.isInteger) ||
      t.x < 0 ||
      t.y < 0 ||
      t.width <= 0 ||
      t.height <= 0 ||
      t.x + t.width > width ||
      t.y + t.height > height
    )
      throw new AppError('CROP', '请输入图片范围内的整数裁剪坐标和尺寸');
    width = t.width;
    height = t.height;
  } else if (transform.degrees !== 180) [width, height] = [height, width];
  const bitmap = await createImageBitmap(source.blob, { imageOrientation: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new AppError('CAPABILITY', '浏览器无法创建图片处理画布');
    if (transform.kind === 'crop')
      context.drawImage(
        bitmap,
        transform.x,
        transform.y,
        transform.width,
        transform.height,
        0,
        0,
        width,
        height,
      );
    else {
      context.translate(width / 2, height / 2);
      context.rotate((transform.degrees * Math.PI) / 180);
      context.drawImage(bitmap, -a.width / 2, -a.height / 2);
    }
    const output = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new AppError('IMAGE', '生成图片失败'))),
        'image/png',
      ),
    );
    const { blob, ...metadata } = await inspectImage(output);
    return {
      asset: {
        ...metadata,
        id: id(),
        role: a.role,
        originalId: a.originalId || a.id,
        transforms: [...a.transforms, transform],
        createdAt: new Date().toISOString(),
      },
      blob,
    };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
