// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { deepClone, todayStr } from './utils.js';
import { DEFAULT_REASONS, SUBJECT_PRESETS } from './constants.js';

function migrate(s) {
  var d = defaultState();
  s.settings = Object.assign({}, d.settings, s.settings || {});
  s.settings.ai = Object.assign({}, d.settings.ai, s.settings.ai || {});
  s.settings.teacher = Object.assign({}, d.settings.teacher, s.settings.teacher || {});
  s.settings.countdown = Object.assign({}, d.settings.countdown, s.settings.countdown || {});
  if (s.settings.ai.model === 'deepseek-chat' || s.settings.ai.model === 'deepseek-reasoner')
    s.settings.ai.model = 'deepseek-flash';
  if (/^moonshot-v1/.test(s.settings.ai.model)) s.settings.ai.model = 'kimi-k3';
  ['students', 'exams', 'points', 'records', 'todos', 'chats'].forEach(function (k) {
    if (!Array.isArray(s[k])) s[k] = [];
  });
  if (!s.attendance || typeof s.attendance !== 'object') s.attendance = {};
  Object.keys(s.attendance).forEach(function (k) {
    if (!s.attendance[k] || typeof s.attendance[k] !== 'object') s.attendance[k] = {};
  });
  s.students = s.students.filter(function (st) {
    return st && st.id && st.name;
  });
  s.exams = s.exams
    .filter(function (e) {
      return e && e.id;
    })
    .map(function (e) {
      if (!Array.isArray(e.subjects)) e.subjects = [];
      e.subjects = e.subjects
        .filter(function (x) {
          return x && x.name;
        })
        .map(function (x) {
          return { name: x.name, full: +x.full > 0 ? +x.full : 100 };
        });
      if (!e.scores || typeof e.scores !== 'object') e.scores = {};
      if (!e.name) e.name = '未命名考试';
      if (!e.date) e.date = todayStr();
      return e;
    });
  s.points = s.points.filter(function (p) {
    return p && p.sid && typeof p.d === 'number';
  });
  s.records = s.records.filter(function (r) {
    return r && r.sid;
  });
  // 上次关闭页面时正在生成的回复：标记为中断，允许重试
  s.chats.forEach(function (c) {
    (c.msgs || []).forEach(function (m) {
      if (m.streaming) {
        m.streaming = false;
        if (!m.content) m.err = '上次生成被中断了（页面关闭或刷新），可以点「重试」。';
        else m.content += '\n\n（上次生成被中断，可以点「重新生成」）';
      }
      if (m.batch)
        m.batch.items.forEach(function (it) {
          if (it.st === 'run') it.st = 'wait';
        });
    });
    if (!Array.isArray(c.msgs)) c.msgs = [];
  });
  s.students.forEach(function (st) {
    if (!st.parents) st.parents = [];
    if (!st.tags) st.tags = [];
    if (!st.comments) st.comments = [];
  });
  return s;
}

function defaultState() {
  return {
    v: 1,
    demo: false,
    settings: {
      school: '',
      className: '我的班级',
      stage: '初中',
      grade: '',
      term: '',
      termStart: '2026-09-01',
      countdown: { label: '期末考试', date: '2027-01-15' },
      teacher: { name: '老师', gender: 'F', subject: '' },
      rows: 6,
      pairs: 4,
      subjects: SUBJECT_PRESETS['初中'].slice(0, 6).map(function (x) {
        return { name: x[0], full: x[1] };
      }),
      boardLeft: '1 语文  2 数学\n3 英语  4 物理\n5 体育  6 道法\n7 自习',
      boardRight: '值日：待安排\n作业：',
      reasons: deepClone(DEFAULT_REASONS),
      anim: true,
      ai: {
        provider: 'deepseek',
        base: 'https://api.deepseek.com',
        key: '',
        model: 'deepseek-flash',
        mask: true,
        temp: 0.7
      },
      lastBackup: 0,
      onboarded: false
    },
    students: [],
    exams: [],
    attendance: {},
    points: [],
    records: [],
    todos: [],
    chats: []
  };
}

export { defaultState, migrate };
