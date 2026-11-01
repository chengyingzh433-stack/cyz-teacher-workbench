// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uid(p) {
  return (p || 'id') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function $(sel, root) {
  return (root || document).querySelector(sel);
}

function $$(sel, root) {
  return Array.prototype.slice.call((root || document).querySelectorAll(sel));
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function todayStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function parseDate(s) {
  if (!s) return null;
  var p = String(s).split(/[-\/.]/);
  if (p.length < 3) return null;
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

var WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function fmtMD(s) {
  var d = parseDate(s);
  return d ? d.getMonth() + 1 + '月' + d.getDate() + '日' : '';
}

function fmtShort(s) {
  var d = parseDate(s);
  return d ? pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) : '';
}

function fmtTime(ts) {
  var d = new Date(ts);
  return (
    pad2(d.getMonth() + 1) +
    '-' +
    pad2(d.getDate()) +
    ' ' +
    pad2(d.getHours()) +
    ':' +
    pad2(d.getMinutes())
  );
}

function sum(a) {
  var s = 0;
  for (var i = 0; i < a.length; i++) s += a[i];
  return s;
}

function avg(a) {
  return a.length ? sum(a) / a.length : 0;
}

function fmtNum(v, d) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  d = d === undefined ? 1 : d;
  var m = Math.pow(10, d);
  var r = Math.round(v * m) / m;
  return String(r);
}

function pct(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return Math.round(v * 1000) / 10 + '%';
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

export {
  $,
  $$,
  WEEK,
  avg,
  clamp,
  daysBetween,
  deepClone,
  esc,
  fmtMD,
  fmtNum,
  fmtTime,
  pad2,
  parseDate,
  pct,
  round1,
  sum,
  todayStr,
  uid
};
