// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { UI, stuAva } from '../ui/workspace.js';
import { examById, examsSorted, prevExam, stuById } from '../core/queries.js';
import { ART } from '../art/scene.js';
import { S } from '../core/state.js';
import { examStats, rankMap } from '../core/statistics.js';
import { esc, fmtNum, pct, round1 } from '../core/utils.js';
import { ICON } from '../ui/icons.js';
import { shortExam } from './students.js';
import { CH } from '../charts/charts.js';

/* =========================================================
   成绩分析 · 总体指标、各科得分率、分数段、历次趋势、排名与关注名单
   ========================================================= */
var An = { exam: null, cmp: null };
export function registerFeaturesAnalysis() {
  UI.register('analysis', {
    render: function (main) {
      var exs = examsSorted();
      if (!exs.length) {
        main.innerHTML =
          '<div class="page scroll"><div class="page-head"><h1 class="page-title">成绩分析</h1></div><div class="panel"><div class="empty">' +
          ART.teacherAvatar(S.settings.teacher, 72, false) +
          '录入至少一场考试后，这里会自动生成分析。<div style="margin-top:14px"><button class="btn btn-dark" data-act="go" data-page="scores">去录入成绩</button></div></div></div></div>';
        return;
      }
      if (!An.exam || !examById(An.exam)) An.exam = exs[exs.length - 1].id;
      var ex = examById(An.exam);
      if (An.cmp === null || (An.cmp && !examById(An.cmp)) || An.cmp === An.exam) {
        var pe = prevExam(ex);
        An.cmp = pe ? pe.id : '';
      }
      var cx = An.cmp ? examById(An.cmp) : null;
      var es = examStats(ex),
        cs = cx ? examStats(cx) : null;
      var opt = function (sel, allowNone) {
        return (
          (allowNone ? '<option value="">不对比</option>' : '') +
          exs
            .slice()
            .reverse()
            .map(function (e) {
              return (
                '<option value="' +
                e.id +
                '"' +
                (e.id === sel ? ' selected' : '') +
                '>' +
                esc(e.name) +
                '</option>'
              );
            })
            .join('')
        );
      };
      var h =
        '<div class="page scroll"><div class="page-head"><div><h1 class="page-title">成绩分析</h1><div class="page-desc">' +
        esc(ex.date) +
        ' · ' +
        es.n +
        ' 人参考 · 满分 ' +
        es.full +
        '</div></div><div class="grow"></div>' +
        '<select class="sel" style="width:auto;height:34px;background-color:#fff;box-shadow:0 0 0 1px var(--line2) inset" data-chg="an-exam" aria-label="考试">' +
        opt(An.exam) +
        '</select>' +
        '<span class="muted" style="font-size:14px">对比</span><select class="sel" style="width:auto;height:34px;background-color:#fff;box-shadow:0 0 0 1px var(--line2) inset" data-chg="an-cmp" aria-label="对比考试">' +
        opt(An.cmp, true) +
        '</select>' +
        '<button class="btn btn-dark" data-act="ai-tpl" data-tpl="report" data-exam="' +
        ex.id +
        '">' +
        ICON.spark +
        'AI 写分析报告</button></div>';
      if (!es.n) {
        main.innerHTML =
          h + '<div class="panel"><div class="empty">这场考试还没有录入成绩</div></div></div>';
        return;
      }
      function delta(cur, prev, isPct, d) {
        if (!cs || prev === undefined || prev === null || cur === undefined)
          return '<div class="d muted">—</div>';
        var v = cur - prev,
          s = isPct ? round1(v * 100) + ' 个百分点' : fmtNum(Math.abs(v), d === undefined ? 1 : d);
        if (Math.abs(v) < 1e-9) return '<div class="d muted">与上次持平</div>';
        return (
          '<div class="d ' +
          (v > 0 ? 'up' : 'dn') +
          '">' +
          (v > 0 ? '↑ ' : '↓ ') +
          (isPct ? round1(Math.abs(v) * 100) + ' 个百分点' : s) +
          ' <span class="muted">较' +
          esc(shortExam(cx.name)) +
          '</span></div>'
        );
      }
      // 得分率对比（不同考试满分可能不同，用得分率比较平均分）
      h +=
        '<div class="stat-row">' +
        '<div class="kpi"><div class="k">平均分</div><div class="v">' +
        fmtNum(es.avg, 1) +
        '<small>/ ' +
        es.full +
        '</small></div>' +
        delta(es.rate, cs && cs.rate, true) +
        '</div>' +
        '<div class="kpi"><div class="k">最高分</div><div class="v">' +
        fmtNum(es.max, 1) +
        '</div><div class="d muted">' +
        esc(stuById(es.table[0].sid).name) +
        '</div></div>' +
        '<div class="kpi"><div class="k">及格率</div><div class="v">' +
        pct(es.pass) +
        '</div>' +
        delta(es.pass, cs && cs.pass, true) +
        '</div>' +
        '<div class="kpi"><div class="k">优秀率</div><div class="v">' +
        pct(es.good) +
        '</div>' +
        delta(es.good, cs && cs.good, true) +
        '</div>' +
        '<div class="kpi"><div class="k">标准差</div><div class="v">' +
        fmtNum(es.sd, 1) +
        '</div></div></div>';
      h +=
        '<div class="grid2"><div class="panel"><div class="panel-title">各科平均得分率</div><div class="panel-sub">及格线 60%</div>' +
        UI.chart(function (w) {
          return CH.bars(
            es.subs.map(function (s) {
              return {
                label: s.name,
                value: (s.rate || 0) * 100,
                tip:
                  '<b>' +
                  esc(s.name) +
                  '</b>（满分 ' +
                  s.full +
                  '）<br><span class="tk">平均</span> ' +
                  fmtNum(s.avg, 1) +
                  '<br><span class="tk">最高 / 最低</span> ' +
                  s.max +
                  ' / ' +
                  s.min +
                  '<br><span class="tk">及格率</span> ' +
                  pct(s.pass) +
                  '<br><span class="tk">优秀率</span> ' +
                  pct(s.good)
              };
            }),
            w,
            {
              h: 250,
              max: 100,
              ref: 60,
              refLabel: '及格',
              fmt: function (v) {
                return Math.round(v) + '%';
              }
            }
          );
        }) +
        '</div>';
      // 分数段
      var bins = 10,
        step = es.full / bins,
        counts = [];
      for (var i = 0; i < bins; i++) counts.push(0);
      es.table.forEach(function (r) {
        counts[Math.min(bins - 1, Math.floor(r.total / step))]++;
      });
      var lo = 0;
      while (lo < bins - 1 && counts[lo] === 0) lo++;
      h +=
        '<div class="panel"><div class="panel-title">总分分数段</div>' +
        UI.chart(function (w) {
          var data = [];
          for (var k = lo; k < bins; k++) {
            var a = Math.round(k * step),
              b = Math.round((k + 1) * step);
            data.push({
              label: a + '–' + b,
              value: counts[k],
              tip:
                '<b>' +
                a +
                '–' +
                b +
                ' 分</b><br>' +
                counts[k] +
                ' 人（' +
                pct(counts[k] / es.n) +
                '）',
              color: k >= bins * 0.85 ? '#256abf' : k < bins * 0.6 ? '#9ec5f4' : CH.C.s1
            });
          }
          return CH.bars(data, w, {
            h: 250,
            fmt: function (v) {
              return String(Math.round(v));
            }
          });
        }) +
        '<div class="legend"><span><i class="sq" style="background:#9ec5f4"></i>不及格段</span><span><i class="sq" style="background:' +
        CH.C.s1 +
        '"></i>及格段</span><span><i class="sq" style="background:#256abf"></i>优秀段</span></div></div></div>';
      // 历次趋势（小多图）
      if (exs.length > 1) {
        var subs = [];
        exs.forEach(function (e) {
          e.subjects.forEach(function (s) {
            if (subs.indexOf(s.name) < 0) subs.push(s.name);
          });
        });
        var labs = exs.map(function (e) {
          return shortExam(e.name);
        });
        var stats = exs.map(function (e) {
          return examStats(e);
        });
        var series = ['总分'].concat(subs).map(function (sn) {
          return {
            sn: sn,
            vals: stats.map(function (st) {
              if (sn === '总分') return st.rate === undefined ? null : st.rate * 100;
              var x = st.subs.filter(function (q) {
                return q.name === sn;
              })[0];
              return x && x.n ? x.rate * 100 : null;
            })
          };
        });
        var allV = [];
        series.forEach(function (x) {
          x.vals.forEach(function (v) {
            if (v !== null) allV.push(v);
          });
        });
        var gLo = Math.max(0, Math.floor((Math.min.apply(null, allV) - 4) / 5) * 5),
          gHi = Math.min(100, Math.ceil((Math.max.apply(null, allV) + 4) / 5) * 5);
        h +=
          '<div class="panel" style="margin-top:16px"><div class="panel-title">历次平均得分率</div><div class="small-mult">';
        series.forEach(function (se) {
          var sn = se.sn,
            vals = se.vals;
          var last = null;
          for (var q = vals.length - 1; q >= 0; q--)
            if (vals[q] !== null) {
              last = vals[q];
              break;
            }
          h +=
            '<div class="sm-cell"><div class="t">' +
            esc(sn) +
            '<span>' +
            (last === null ? '—' : round1(last) + '%') +
            '</span></div>' +
            UI.chart(function (w) {
              return CH.lines(
                [{ name: sn, color: sn === '总分' ? CH.C.ink : CH.C.s1, values: vals }],
                labs,
                w,
                {
                  h: 120,
                  min: gLo,
                  max: gHi,
                  ticks: 2,
                  ml: 38,
                  mr: 10,
                  mt: 14,
                  mb: 24,
                  endLabel: false,
                  fmt: function (v) {
                    return Math.round(v) + '%';
                  },
                  tipFmt: function (v) {
                    return round1(v) + '%';
                  }
                }
              );
            }) +
            '</div>';
        });
        h += '</div></div>';
      }
      // 排名 + 关注名单
      var cm = cx ? rankMap(cx) : {};
      var moves = es.table.map(function (r) {
        return { r: r, ch: cm[r.sid] ? cm[r.sid].rank - r.rank : null };
      });
      h +=
        '<div class="grid2" style="margin-top:16px"><div class="panel" style="padding:20px 0 6px"><div style="padding:0 20px"><div class="panel-title">班级排名</div></div><div style="max-height:460px;overflow:auto"><table class="tbl"><thead><tr><th>名次</th><th>姓名</th>' +
        ex.subjects
          .map(function (s) {
            return '<th class="r">' + esc(s.name) + '</th>';
          })
          .join('') +
        '<th class="r">总分</th>' +
        (cx ? '<th class="r">进退</th>' : '') +
        '</tr></thead><tbody>' +
        moves
          .map(function (m) {
            var st = stuById(m.r.sid);
            return (
              '<tr class="click" data-act="open-stu" data-sid="' +
              st.id +
              '"><td class="num">' +
              m.r.rank +
              '</td><td><div class="nm">' +
              stuAva(st, 22) +
              esc(st.name) +
              '</div></td>' +
              ex.subjects
                .map(function (s) {
                  var v = m.r.subs[s.name];
                  return (
                    '<td class="r num' +
                    (typeof v === 'number' && v < s.full * 0.6 ? ' dn' : '') +
                    '">' +
                    (v === null ? '缺' : v === undefined ? '—' : v) +
                    '</td>'
                  );
                })
                .join('') +
              '<td class="r num"><b>' +
              fmtNum(m.r.total, 1) +
              '</b></td>' +
              (cx
                ? '<td class="r num">' +
                  (m.ch === null
                    ? '<span class="muted">—</span>'
                    : m.ch === 0
                      ? '<span class="muted">0</span>'
                      : '<span class="' +
                        (m.ch > 0 ? 'up' : 'dn') +
                        '">' +
                        (m.ch > 0 ? '↑' + m.ch : '↓' + -m.ch) +
                        '</span>') +
                  '</td>'
                : '') +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table></div></div>';
      var ups = moves
        .filter(function (m) {
          return m.ch !== null && m.ch > 0;
        })
        .sort(function (a, b) {
          return b.ch - a.ch;
        })
        .slice(0, 5);
      var downs = moves
        .filter(function (m) {
          return m.ch !== null && m.ch <= -5;
        })
        .sort(function (a, b) {
          return a.ch - b.ch;
        })
        .slice(0, 6);
      var fails = es.table
        .map(function (r) {
          var n = 0;
          ex.subjects.forEach(function (s) {
            var v = r.subs[s.name];
            if (typeof v === 'number' && v < s.full * 0.6) n++;
          });
          return { r: r, n: n };
        })
        .filter(function (x) {
          return x.n >= 2;
        })
        .sort(function (a, b) {
          return b.n - a.n;
        });
      function li(st, right) {
        return (
          '<button class="mini-item" data-act="open-stu" data-sid="' +
          st.id +
          '" style="background:var(--fill)">' +
          stuAva(st, 26) +
          '<span class="grow">' +
          esc(st.name) +
          '</span><span class="r">' +
          right +
          '</span></button>'
        );
      }
      h +=
        '<div class="panel"><div class="panel-title">需要关注</div><div class="panel-sub">' +
        (cx ? '对比「' + esc(cx.name) + '」' : '选择对比考试可看进退步') +
        '</div>' +
        (cx
          ? '<div class="flabel" style="margin:4px 0 6px">' +
            ICON.star +
            ' 进步之星</div><div class="warn-list">' +
            (ups.length
              ? ups
                  .map(function (m) {
                    return li(
                      stuById(m.r.sid),
                      '<span class="up">↑ ' + m.ch + ' 名</span> · 第 ' + m.r.rank
                    );
                  })
                  .join('')
              : '<div class="muted" style="font-size:14px">暂无</div>') +
            '</div>' +
            '<div class="flabel" style="margin:16px 0 6px">退步 5 名以上</div><div class="warn-list">' +
            (downs.length
              ? downs
                  .map(function (m) {
                    return li(
                      stuById(m.r.sid),
                      '<span class="dn">↓ ' + -m.ch + ' 名</span> · 第 ' + m.r.rank
                    );
                  })
                  .join('')
              : '<div class="muted" style="font-size:14px">没有明显退步的同学</div>') +
            '</div>'
          : '') +
        '<div class="flabel" style="margin:16px 0 6px">两科及以上不及格</div><div class="warn-list">' +
        (fails.length
          ? fails
              .slice(0, 8)
              .map(function (x) {
                return li(stuById(x.r.sid), '<span class="dn">' + x.n + ' 科</span>');
              })
              .join('')
          : '<div class="muted" style="font-size:14px">没有</div>') +
        '</div>' +
        '<div style="margin-top:14px"><button class="btn btn-light btn-sm" data-act="ai-tpl" data-tpl="parent-batch" data-exam="' +
        ex.id +
        '" data-cmp="' +
        (cx ? cx.id : '') +
        '">' +
        ICON.spark +
        '给退步同学家长写沟通消息</button></div></div></div>';
      // 各科明细
      h +=
        '<div class="panel" style="margin-top:16px;padding:20px 0 6px"><div style="padding:0 20px"><div class="panel-title">各科明细</div><div class="panel-sub">及格 = 满分的 60%，优秀 = 满分的 85%</div></div><table class="tbl"><thead><tr><th>科目</th><th class="r">满分</th><th class="r">平均分</th><th class="r">得分率</th><th class="r">最高</th><th class="r">最低</th><th class="r">及格率</th><th class="r">优秀率</th><th class="r">不及格人数</th>' +
        (cs ? '<th class="r">得分率变化</th>' : '') +
        '</tr></thead><tbody>' +
        es.subs
          .map(function (s) {
            var ps = cs
              ? cs.subs.filter(function (q) {
                  return q.name === s.name;
                })[0]
              : null;
            var dv = ps && ps.n && s.n ? (s.rate - ps.rate) * 100 : null;
            return (
              '<tr><td><b style="font-weight:600">' +
              esc(s.name) +
              '</b></td><td class="r num">' +
              s.full +
              '</td><td class="r num">' +
              fmtNum(s.avg, 1) +
              '</td><td class="r num">' +
              pct(s.rate) +
              '</td><td class="r num">' +
              (s.max === undefined ? '—' : s.max) +
              '</td><td class="r num">' +
              (s.min === undefined ? '—' : s.min) +
              '</td><td class="r num">' +
              pct(s.pass) +
              '</td><td class="r num">' +
              pct(s.good) +
              '</td><td class="r num">' +
              (s.low || 0) +
              '</td>' +
              (cs
                ? '<td class="r num">' +
                  (dv === null
                    ? '<span class="muted">—</span>'
                    : '<span class="' +
                      (dv >= 0 ? 'up' : 'dn') +
                      '">' +
                      (dv >= 0 ? '+' : '') +
                      round1(dv) +
                      '</span>') +
                  '</td>'
                : '') +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table></div></div>';
      main.innerHTML = h;
    }
  });

  UI.chg['an-exam'] = function (el) {
    An.exam = el.value;
    An.cmp = null;
    UI.rerender();
  };

  UI.chg['an-cmp'] = function (el) {
    An.cmp = el.value;
    UI.rerender();
  };
}
