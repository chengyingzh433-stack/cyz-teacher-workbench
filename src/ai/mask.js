// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { S } from '../core/state.js';
import { studentsByNo } from '../core/queries.js';
import { save } from '../core/storage.js';
import { pad2 } from '../core/utils.js';

/* ---------- 脱敏：学生姓名替换为占位符，结果回来再还原 ---------- */
var Mask = {
  // 每个学生分配一个固定编号（增删学生、改学号都不会变），保证历史对话里的编号始终对得上
  ensure: function () {
    var seq = S.settings.maskSeq || 0,
      changed = false;
    S.students.forEach(function (s) {
      if (s.mk) seq = Math.max(seq, s.mk);
    });
    studentsByNo().forEach(function (s) {
      if (!s.mk) {
        s.mk = ++seq;
        changed = true;
      }
    });
    if (changed || S.settings.maskSeq !== seq) {
      S.settings.maskSeq = seq;
      save();
    }
  },
  code: function (s) {
    Mask.ensure();
    return '【学生' + pad2(s.mk) + '】';
  },
  build: function () {
    Mask.ensure();
    var fwd = [],
      back = {};
    S.students.forEach(function (s) {
      fwd.push([s.name, '【学生' + pad2(s.mk) + '】']);
      back[pad2(s.mk)] = s.name;
    });
    fwd.sort(function (a, b) {
      return b[0].length - a[0].length;
    });
    return { fwd: fwd, back: back };
  },
  apply: function (t) {
    if (!S.settings.ai.mask || !t) return t;
    var m = Mask.build();
    m.fwd.forEach(function (p) {
      if (p[0]) t = t.split(p[0]).join(p[1]);
    });
    return t;
  },
  restore: function (t) {
    if (!t) return t;
    var b = Mask.build().back;
    return t.replace(/[【\[]学生(\d{1,3})[】\]]/g, function (all, n) {
      n = pad2(+n);
      return b[n] || all;
    });
  }
};

export { Mask };
