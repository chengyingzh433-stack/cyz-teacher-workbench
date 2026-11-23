import type { PDFPageProxy } from 'pdfjs-dist';
import { extractSelectionText, type PdfTextGlyph } from '../../../shared/qbank/pdf-selection';

export { extractSelectionText, type PdfTextGlyph };

/**
 * Derive normalized viewport coordinates for every glyph on a PDF page.
 * Handles page rotation and estimates within-run glyph advances via canvas metrics.
 */
export async function pdfTextGlyphs(
  page: PDFPageProxy,
  viewport: ReturnType<PDFPageProxy['getViewport']>,
): Promise<PdfTextGlyph[]> {
  const content = await page.getTextContent();
  const result: PdfTextGlyph[] = [];
  const measure = document.createElement('canvas').getContext('2d')!;
  let run = 0;

  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue;
    const chars = Array.from(item.str);
    const t = item.transform;
    const style = content.styles[item.fontName];
    const length = Math.hypot(t[0], t[1]) || 1;
    const height = Math.hypot(t[2], t[3]) || item.height || 1;
    measure.font = `100px ${style?.fontFamily || 'sans-serif'}`;
    const widths = chars.map((c) => Math.max(measure.measureText(c).width, 1));
    const total = widths.reduce((a, b) => a + b, 0);
    const vertical = style?.vertical === true;
    const advance = vertical ? item.height : item.width;
    const dx = vertical ? -t[2] / height : t[0] / length;
    const dy = vertical ? -t[3] / height : t[1] / length;
    const ascent = style?.ascent ?? 0.8;
    const descent = style?.descent ?? -0.2;
    let consumed = 0;

    chars.forEach((char, index) => {
      const offset = ((consumed + widths[index] / 2) / total) * advance;
      const center = (ascent + descent) / 2;
      const x = t[4] + dx * offset + (vertical ? t[0] : t[2]) * center;
      const y = t[5] + dy * offset + (vertical ? t[1] : t[3]) * center;
      const point = viewport.convertToViewportPoint(x, y);
      result.push({
        text: char,
        x: point[0] / viewport.width,
        y: point[1] / viewport.height,
        end: index === chars.length - 1 && item.hasEOL,
        run,
      });
      consumed += widths[index];
    });
    run++;
  }
  return result;
}
