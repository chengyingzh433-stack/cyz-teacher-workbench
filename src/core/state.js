import { ensureStudentCharacters } from './characters.js';
// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE

var S = null;

function replaceState(next) {
  ensureStudentCharacters(next);
  S = next;
}

export { S, replaceState };
