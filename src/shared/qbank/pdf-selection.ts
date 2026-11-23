import type { QbankOcrCrop } from './types';

export interface PdfTextGlyph {
  text: string;
  x: number;
  y: number;
  end: boolean;
  run: number;
}

const CJK_OR_FULLWIDTH = /[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;
const OPEN_BRACKET = /[（(\[【《「『“‘]/;
const CLOSE_PUNCT = /[，。、；：？！．,.;:?!）)\]】》」』”’]/;

/**
 * Extract clean text inside a normalized selection box without stray spaces
 * around CJK characters, fullwidth/halfwidth punctuation, or opening brackets.
 */
export function extractSelectionText(
  glyphs: PdfTextGlyph[],
  crop: QbankOcrCrop | null,
): string {
  const selected = glyphs.filter(
    (g) =>
      !crop ||
      (g.x >= crop.x &&
        g.x <= crop.x + crop.width &&
        g.y >= crop.y &&
        g.y <= crop.y + crop.height),
  );
  let result = '';
  let previous: PdfTextGlyph | undefined;

  for (const glyph of selected) {
    if (previous && glyph.run !== previous.run && !result.endsWith('\n')) {
      if (Math.abs(glyph.y - previous.y) > 0.008) {
        result += '\n';
      } else if (!/\s$/.test(result) && !/^\s/.test(glyph.text)) {
        const dx = glyph.x - previous.x;
        const wideVisualGap = dx > 0.022;
        const sameScriptAscii = /[A-Za-z0-9%]$/.test(result) && /^[A-Za-z0-9]/.test(glyph.text);
        const cjkAdjacency =
          (CJK_OR_FULLWIDTH.test(previous.text) || CJK_OR_FULLWIDTH.test(glyph.text)) &&
          !wideVisualGap;
        const tightPunct = CLOSE_PUNCT.test(glyph.text) && !wideVisualGap;
        const tightOpen = OPEN_BRACKET.test(previous.text) && !wideVisualGap;
        if (sameScriptAscii || wideVisualGap || (!cjkAdjacency && !tightPunct && !tightOpen)) {
          result += ' ';
        }
      }
    }
    result += glyph.text + (glyph.end ? '\n' : '');
    previous = glyph;
  }

  return result
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .trim();
}
