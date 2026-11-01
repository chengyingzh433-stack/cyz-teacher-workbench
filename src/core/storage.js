import { ensureStudentCharacters } from './characters.js';
// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { S } from './state.js';
import { STORE_KEY } from './constants.js';

import { migrate } from './schema.js';

/* ---------- 存储（禁用 localStorage 时自动降级为内存） ---------- */
var Store = (function () {
  var mem = {},
    ok = true;
  try {
    localStorage.setItem('__bzr_t', '1');
    localStorage.removeItem('__bzr_t');
  } catch (e) {
    ok = false;
  }
  return {
    ok: function () {
      return ok;
    },
    get: function (k) {
      try {
        return ok ? localStorage.getItem(k) : mem[k] || null;
      } catch (e) {
        return mem[k] || null;
      }
    },
    set: function (k, v) {
      try {
        if (ok) localStorage.setItem(k, v);
        else mem[k] = v;
        return true;
      } catch (e) {
        mem[k] = v;
        return false;
      }
    },
    del: function (k) {
      try {
        if (ok) localStorage.removeItem(k);
      } catch (e) {}
      delete mem[k];
    }
  };
})();

var saveTimer = null;
let onStorageError = () => {};
export function setStorageErrorHandler(handler) {
  onStorageError = handler;
}

function save(now) {
  if (!S) return;
  ensureStudentCharacters(S);
  clearTimeout(saveTimer);
  var run = function () {
    var ok = Store.set(STORE_KEY, JSON.stringify(S));
    if (!ok) onStorageError('存储空间不足，请到设置里导出备份');
  };
  if (now) run();
  else saveTimer = setTimeout(run, 250);
}

function load() {
  var raw = Store.get(STORE_KEY);
  if (!raw) return null;
  try {
    return migrate(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

export { Store, load, save };
