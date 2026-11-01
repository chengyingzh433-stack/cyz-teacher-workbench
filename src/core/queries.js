// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { S } from './state.js';
import { daysBetween, parseDate, todayStr } from './utils.js';

/* ---------- 查询 ---------- */
function stuById(id) {
  for (var i = 0; i < S.students.length; i++) if (S.students[i].id === id) return S.students[i];
  return null;
}

function examById(id) {
  for (var i = 0; i < S.exams.length; i++) if (S.exams[i].id === id) return S.exams[i];
  return null;
}

function examsSorted() {
  return S.exams.slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
}

function latestExam() {
  var e = examsSorted();
  return e.length ? e[e.length - 1] : null;
}

function prevExam(ex) {
  var e = examsSorted();
  var i = e.indexOf(ex);
  return i > 0 ? e[i - 1] : null;
}

function seatMap() {
  var m = {};
  S.students.forEach(function (s) {
    if (s.seat) m[s.seat] = s;
  });
  return m;
}

function studentsByNo() {
  return S.students.slice().sort(function (a, b) {
    return String(a.no).localeCompare(String(b.no), 'zh', { numeric: true });
  });
}

function pointsOf(sid) {
  var t = 0;
  S.points.forEach(function (p) {
    if (p.sid === sid) t += p.d;
  });
  return t;
}

function attToday(sid) {
  var a = S.attendance[todayStr()];
  return a ? a[sid] || null : null;
}

function age(st) {
  var b = parseDate(st.birthday);
  if (!b) return null;
  var n = new Date();
  var a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate()))
    a--;
  return a;
}

function daysToBirthday(st) {
  var b = parseDate(st.birthday);
  if (!b) return null;
  var n = new Date();
  n = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  var next = new Date(n.getFullYear(), b.getMonth(), b.getDate());
  if (next < n) next = new Date(n.getFullYear() + 1, b.getMonth(), b.getDate());
  return daysBetween(n, next);
}

function weekNo() {
  var st = parseDate(S.settings.termStart);
  if (!st) return null;
  var n = new Date();
  n = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  var d = daysBetween(st, n);
  if (d < 0) return null;
  return Math.floor(d / 7) + 1;
}

function countdownDays() {
  var d = parseDate(S.settings.countdown.date);
  if (!d) return null;
  var n = new Date();
  n = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  var v = daysBetween(n, d);
  return v < 0 ? null : v;
}

export {
  age,
  attToday,
  countdownDays,
  daysToBirthday,
  examById,
  examsSorted,
  latestExam,
  pointsOf,
  prevExam,
  seatMap,
  stuById,
  studentsByNo,
  weekNo
};
