import { ASSETS, ATLAS_SIZES } from './assets.js';
import { characterOf, teacherCharacter } from '../core/characters.js';
import { esc } from '../core/utils.js';

// Atlases occur once per document. Each SVG viewport references a cropped region.
// This avoids repeating megabytes of data URLs for every student in the offline build.
export function mountPixelAssets() {
  if (document.getElementById('pixel-assets')) return;
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.id = 'pixel-assets';
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('width', '0');
  host.setAttribute('height', '0');
  host.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden';
  host.innerHTML =
    '<defs><filter id="pixel-cutout" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="discrete" tableValues="0 0 0 1 1"/></feComponentTransfer></filter>' +
    Object.entries(ASSETS)
      .map(
        ([key, url]) =>
          `<image id="pixel-atlas-${key}" href="${url}" width="${ATLAS_SIZES[key][0]}" height="${ATLAS_SIZES[key][1]}"/>`
      )
      .join('') +
    '</defs>';
  document.body.prepend(host);
}
export function crop(
  sheet,
  box,
  x,
  y,
  width,
  height,
  className = '',
  align = 'xMidYMid meet',
  cutout = true
) {
  return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${box.join(' ')}" preserveAspectRatio="${align}" class="pixel-sprite ${className}" overflow="hidden"><use href="#pixel-atlas-${sheet}"${cutout ? ' filter="url(#pixel-cutout)"' : ''}/></svg>`;
}
export function characterSprite(character, side, x, y, width, height, className = '') {
  return crop(character.sheet, character[side], x, y, width, height, className);
}
function portrait(character, size) {
  const box = character.front.slice();
  box[3] = Math.round(box[3] * 0.76);
  return `<svg class="pixel-avatar" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${esc(character.name)}"><rect width="100" height="100" rx="24" fill="#e8ede2"/>${crop(character.sheet, box, 4, 4, 92, 96)}</svg>`;
}
export function avatar(student, size = 40) {
  return portrait(characterOf(student), size);
}
export function teacherAvatar(teacher, size = 40) {
  return portrait(teacherCharacter(teacher), size);
}
