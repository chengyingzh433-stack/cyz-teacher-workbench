// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { S } from '../core/state.js';
import { age, latestExam, pointsOf, stuById, weekNo } from '../core/queries.js';
import { examFull, examStats, rankMap, stuTrend, subjectStats } from '../core/statistics.js';
import { fmtNum, pct, round1 } from '../core/utils.js';

/* ---------- 上下文 ---------- */
function sysPrompt() {
  var st = S.settings,
    t = st.teacher;
  return (
    '你是一名经验丰富、温和务实的中国中小学班主任助理，熟悉课程标准、班级管理与家校沟通。\n' +
    '写作要求：\n1. 使用简体中文，语气真诚具体、有温度，避免空话套话和夸张表述；\n2. 用 Markdown 组织内容（标题、列表、必要时用表格），老师可以直接复制使用；\n' +
    '3. 只依据老师提供的信息，不编造具体事实、成绩、奖项或数据；信息不够时用「（可补充：……）」提示老师；\n' +
    '4. 涉及学生时以成长和鼓励为导向，不贴标签，不公开排名羞辱学生，注意保护隐私；\n' +
    '5. 资料里「【学生07】」这样的占位符代表某位学生，请原样保留，不要改写，也不要替换成其他名字。\n' +
    '当前老师：' +
    t.name +
    '，' +
    (st.school ? st.school + ' ' : '') +
    st.className +
    ' 班主任' +
    (t.subject ? '，任教' + t.subject : '') +
    '；学段：' +
    st.stage +
    '。'
  );
}

function classContext() {
  var st = S.settings,
    n = S.students.length,
    boys = S.students.filter(function (s) {
      return s.gender !== 'F';
    }).length;
  var cadres = S.students
    .filter(function (s) {
      return s.role;
    })
    .map(function (s) {
      return s.role + ' ' + s.name;
    });
  var tagCount = {};
  S.students.forEach(function (s) {
    (s.tags || []).forEach(function (t) {
      tagCount[t] = (tagCount[t] || 0) + 1;
    });
  });
  var h =
    '【班级概况】\n' +
    (st.school ? '学校：' + st.school + '；' : '') +
    '班级：' +
    st.className +
    '；学段：' +
    st.stage +
    (st.term ? '；' + st.term : '') +
    (weekNo() ? '；当前第 ' + weekNo() + ' 周' : '') +
    '\n';
  h += '人数：' + n + ' 人（男 ' + boys + '，女 ' + (n - boys) + '）\n';
  if (cadres.length) h += '班干部：' + cadres.join('、') + '\n';
  var tg = Object.keys(tagCount).map(function (k) {
    return k + ' ' + tagCount[k] + ' 人';
  });
  if (tg.length) h += '学生标签统计：' + tg.join('、') + '\n';
  var lat = latestExam();
  if (lat) {
    var es = examStats(lat);
    if (es.n)
      h +=
        '最近考试：' +
        lat.name +
        '（' +
        lat.date +
        '），平均分 ' +
        fmtNum(es.avg, 1) +
        '/' +
        es.full +
        '，及格率 ' +
        pct(es.pass) +
        '，优秀率 ' +
        pct(es.good) +
        '；各科平均得分率：' +
        es.subs
          .map(function (s) {
            return s.name + ' ' + pct(s.rate);
          })
          .join('、') +
        '\n';
  }
  var since = Date.now() - 30 * 86400000,
    pl = S.points.filter(function (p) {
      return p.t >= since;
    });
  if (pl.length) {
    var plus = {},
      minus = {};
    pl.forEach(function (p) {
      var o = p.d > 0 ? plus : minus;
      o[p.r] = (o[p.r] || 0) + 1;
    });
    function top(o) {
      return Object.keys(o)
        .sort(function (a, b) {
          return o[b] - o[a];
        })
        .slice(0, 4)
        .map(function (k) {
          return k + '(' + o[k] + '次)';
        })
        .join('、');
    }
    h +=
      '近 30 天课堂点评：加分 ' +
      pl.filter(function (p) {
        return p.d > 0;
      }).length +
      ' 次，扣分 ' +
      pl.filter(function (p) {
        return p.d < 0;
      }).length +
      ' 次；常见加分：' +
      (top(plus) || '无') +
      '；常见扣分：' +
      (top(minus) || '无') +
      '\n';
  }
  var recs = S.records
    .slice()
    .sort(function (a, b) {
      return a.date < b.date ? 1 : -1;
    })
    .slice(0, 6);
  if (recs.length)
    h +=
      '近期班级记录：' +
      recs
        .map(function (r) {
          var s = stuById(r.sid);
          return r.date.slice(5) + ' ' + (s ? s.name : '') + ' ' + r.type + '：' + r.text;
        })
        .join('；') +
      '\n';
  return h;
}

function studentContext(s) {
  var h =
    '【学生档案】\n姓名：' +
    s.name +
    '；性别：' +
    (s.gender === 'F' ? '女' : '男') +
    (age(s) !== null ? '；年龄：' + age(s) + ' 岁' : '') +
    (s.role ? '；职务：' + s.role : '') +
    ((s.tags || []).length ? '；标签：' + s.tags.join('、') : '') +
    '\n';
  h += '家庭：' + (s.family || '未填') + (s.familyNote ? '；' + s.familyNote : '') + '\n';
  if (s.study) h += '学习情况：' + s.study + '\n';
  if (s.personality) h += '性格特长：' + s.personality + '\n';
  if (s.health) h += '健康情况：' + s.health + '\n';
  if (s.note) h += '其他备注：' + s.note + '\n';
  var tr = stuTrend(s.id).filter(function (t) {
    return t.total !== null;
  });
  if (tr.length) {
    h +=
      '成绩：' +
      tr
        .map(function (t) {
          return (
            t.ex.name +
            ' 总分 ' +
            fmtNum(t.total, 1) +
            '/' +
            examFull(t.ex) +
            '，班级第 ' +
            t.rank +
            '/' +
            t.n +
            ' 名'
          );
        })
        .join('；') +
      '\n';
    var le = tr[tr.length - 1].ex,
      row = le.scores[s.id] || {};
    h +=
      le.name +
      ' 各科：' +
      le.subjects
        .map(function (sb) {
          var v = row[sb.name];
          var cs = subjectStats(le, sb.name);
          return (
            sb.name +
            ' ' +
            (v === null ? '缺考' : v === undefined ? '无' : v + '/' + sb.full) +
            '（班均 ' +
            fmtNum(cs.avg, 1) +
            '）'
          );
        })
        .join('、') +
      '\n';
  }
  var pts = S.points.filter(function (p) {
    return p.sid === s.id;
  });
  if (pts.length) {
    var plus = {},
      minus = {};
    pts.forEach(function (p) {
      var o = p.d > 0 ? plus : minus;
      o[p.r] = (o[p.r] || 0) + 1;
    });
    h +=
      '课堂点评：累计 ' +
      (pointsOf(s.id) > 0 ? '+' : '') +
      pointsOf(s.id) +
      ' 分；加分原因：' +
      (Object.keys(plus)
        .map(function (k) {
          return k + plus[k] + '次';
        })
        .join('、') || '无') +
      '；扣分原因：' +
      (Object.keys(minus)
        .map(function (k) {
          return k + minus[k] + '次';
        })
        .join('、') || '无') +
      '\n';
  }
  var recs = S.records
    .filter(function (r) {
      return r.sid === s.id;
    })
    .sort(function (a, b) {
      return a.date < b.date ? 1 : -1;
    })
    .slice(0, 6);
  if (recs.length)
    h +=
      '成长记录：' +
      recs
        .map(function (r) {
          return r.date + ' ' + r.type + '：' + r.text;
        })
        .join('；') +
      '\n';
  var c = { leave: 0, absent: 0, late: 0 };
  Object.keys(S.attendance).forEach(function (k) {
    var v = S.attendance[k][s.id];
    if (v) c[v]++;
  });
  if (c.leave + c.absent + c.late)
    h += '考勤：请假 ' + c.leave + ' 天，缺勤 ' + c.absent + ' 天，迟到 ' + c.late + ' 次\n';
  return h;
}

function examContext(ex, cx) {
  var es = examStats(ex);
  if (!es.n) return '【考试数据】' + ex.name + ' 还没有录入成绩\n';
  var h =
    '【考试数据】' +
    ex.name +
    '（' +
    ex.date +
    '，' +
    (ex.type || '') +
    '），参考 ' +
    es.n +
    ' 人，满分 ' +
    es.full +
    '\n';
  h +=
    '总分：平均 ' +
    fmtNum(es.avg, 1) +
    '，最高 ' +
    fmtNum(es.max, 1) +
    '，最低 ' +
    fmtNum(es.min, 1) +
    '，及格率 ' +
    pct(es.pass) +
    '，优秀率 ' +
    pct(es.good) +
    '，标准差 ' +
    fmtNum(es.sd, 1) +
    '\n';
  h +=
    '各科：\n' +
    es.subs
      .map(function (s) {
        return (
          '- ' +
          s.name +
          '（满分 ' +
          s.full +
          '）：平均 ' +
          fmtNum(s.avg, 1) +
          '，得分率 ' +
          pct(s.rate) +
          '，及格率 ' +
          pct(s.pass) +
          '，优秀率 ' +
          pct(s.good) +
          '，最高 ' +
          s.max +
          '，最低 ' +
          s.min +
          '，不及格 ' +
          s.low +
          ' 人'
        );
      })
      .join('\n') +
    '\n';
  h +=
    '前 5 名：' +
    es.table
      .slice(0, 5)
      .map(function (r) {
        return stuById(r.sid).name + ' ' + fmtNum(r.total, 1);
      })
      .join('、') +
    '\n';
  if (cx) {
    var cs = examStats(cx),
      cm = rankMap(cx);
    if (cs.n) {
      h +=
        '与「' +
        cx.name +
        '」相比：平均得分率 ' +
        pct(cs.rate) +
        ' → ' +
        pct(es.rate) +
        '；各科得分率变化：' +
        es.subs
          .map(function (s) {
            var p = cs.subs.filter(function (q) {
              return q.name === s.name;
            })[0];
            return p && p.n
              ? s.name +
                  ' ' +
                  (s.rate - p.rate >= 0 ? '+' : '') +
                  round1((s.rate - p.rate) * 100) +
                  ' 个百分点'
              : s.name + '（上次未考）';
          })
          .join('、') +
        '\n';
      var mv = es.table
        .map(function (r) {
          return {
            s: stuById(r.sid),
            ch: cm[r.sid] ? cm[r.sid].rank - r.rank : null,
            rank: r.rank
          };
        })
        .filter(function (x) {
          return x.ch !== null;
        });
      var up = mv
          .filter(function (x) {
            return x.ch >= 5;
          })
          .sort(function (a, b) {
            return b.ch - a.ch;
          }),
        dn = mv
          .filter(function (x) {
            return x.ch <= -5;
          })
          .sort(function (a, b) {
            return a.ch - b.ch;
          });
      h +=
        '进步 5 名以上：' +
        (up
          .map(function (x) {
            return x.s.name + '（↑' + x.ch + '，现第 ' + x.rank + '）';
          })
          .join('、') || '无') +
        '\n';
      h +=
        '退步 5 名以上：' +
        (dn
          .map(function (x) {
            return x.s.name + '（↓' + -x.ch + '，现第 ' + x.rank + '）';
          })
          .join('、') || '无') +
        '\n';
    }
  }
  var fails = es.table.filter(function (r) {
    var n = 0;
    ex.subjects.forEach(function (s) {
      var v = r.subs[s.name];
      if (typeof v === 'number' && v < s.full * 0.6) n++;
    });
    return n >= 2;
  });
  h +=
    '两科及以上不及格：' +
    fails.length +
    ' 人' +
    (fails.length
      ? '（' +
        fails
          .map(function (r) {
            return stuById(r.sid).name;
          })
          .join('、') +
        '）'
      : '') +
    '\n';
  return h;
}

export { classContext, examContext, studentContext, sysPrompt };
