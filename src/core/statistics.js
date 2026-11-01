// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { avg, sum } from './utils.js';
import { S } from './state.js';
import { examsSorted } from './queries.js';

/* ---------- 成绩统计 ---------- */
function examFull(ex) {
  return sum(
    ex.subjects.map(function (s) {
      return s.full;
    })
  );
}

function stuTotal(ex, sid) {
  var row = ex.scores[sid];
  if (!row) return null;
  var t = 0,
    n = 0;
  ex.subjects.forEach(function (sb) {
    var v = row[sb.name];
    if (typeof v === 'number') {
      t += v;
      n++;
    }
  });
  return n ? t : null;
}

function examTable(ex) {
  // 返回 [{sid, total, rank, subs:{name:v}}]，按总分降序；只统计在籍学生
  var rows = [];
  S.students.forEach(function (st) {
    var t = stuTotal(ex, st.id);
    if (t === null) return;
    rows.push({ sid: st.id, total: t, subs: ex.scores[st.id] || {} });
  });
  rows.sort(function (a, b) {
    return b.total - a.total;
  });
  var last = null,
    lastRank = 0;
  rows.forEach(function (r, i) {
    if (r.total !== last) {
      lastRank = i + 1;
      last = r.total;
    }
    r.rank = lastRank;
  });
  return rows;
}

function rankMap(ex) {
  var m = {};
  if (!ex) return m;
  examTable(ex).forEach(function (r) {
    m[r.sid] = r;
  });
  return m;
}

function subjectStats(ex, name) {
  var full = 100;
  ex.subjects.forEach(function (s) {
    if (s.name === name) full = s.full;
  });
  var vals = [];
  S.students.forEach(function (st) {
    var row = ex.scores[st.id];
    if (row && typeof row[name] === 'number') vals.push(row[name]);
  });
  if (!vals.length) return { name: name, full: full, n: 0 };
  var a = avg(vals);
  return {
    name: name,
    full: full,
    n: vals.length,
    avg: a,
    rate: a / full,
    max: Math.max.apply(null, vals),
    min: Math.min.apply(null, vals),
    pass:
      vals.filter(function (v) {
        return v >= full * 0.6;
      }).length / vals.length,
    good:
      vals.filter(function (v) {
        return v >= full * 0.85;
      }).length / vals.length,
    low: vals.filter(function (v) {
      return v < full * 0.6;
    }).length
  };
}

function examStats(ex) {
  var t = examTable(ex),
    full = examFull(ex);
  var totals = t.map(function (r) {
    return r.total;
  });
  var res = {
    ex: ex,
    full: full,
    n: t.length,
    table: t,
    subs: ex.subjects.map(function (s) {
      return subjectStats(ex, s.name);
    })
  };
  if (!t.length) return res;
  res.avg = avg(totals);
  res.max = Math.max.apply(null, totals);
  res.min = Math.min.apply(null, totals);
  res.rate = res.avg / full;
  res.pass =
    totals.filter(function (v) {
      return v >= full * 0.6;
    }).length / t.length;
  res.good =
    totals.filter(function (v) {
      return v >= full * 0.85;
    }).length / t.length;
  var sd = Math.sqrt(
    avg(
      totals.map(function (v) {
        return (v - res.avg) * (v - res.avg);
      })
    )
  );
  res.sd = sd;
  return res;
}

function entryProgress(ex) {
  var n = 0,
    total = S.students.length;
  S.students.forEach(function (st) {
    var row = ex.scores[st.id];
    if (
      row &&
      ex.subjects.every(function (sb) {
        return row[sb.name] !== undefined && row[sb.name] !== '';
      })
    )
      n++;
  });
  return { n: n, total: total };
}

function stuTrend(sid) {
  return examsSorted().map(function (ex) {
    var m = rankMap(ex),
      r = m[sid];
    return {
      ex: ex,
      total: r ? r.total : null,
      rank: r ? r.rank : null,
      n: Object.keys(m).length,
      rate: r ? r.total / examFull(ex) : null
    };
  });
}

export { entryProgress, examFull, examStats, examTable, rankMap, stuTrend, subjectStats };
