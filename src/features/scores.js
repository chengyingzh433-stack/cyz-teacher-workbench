// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { examById, examsSorted, studentsByNo } from '../core/queries.js';
import { save } from '../core/storage.js';
import { $, $$, esc, fmtNum, todayStr, uid } from '../core/utils.js';
import { parseTable, toCSV } from '../core/table.js';
import { UI } from '../ui/workspace.js';
import { S } from '../core/state.js';
import { ICON } from '../ui/icons.js';
import { ART } from '../art/scene.js';
import { entryProgress, examFull, rankMap } from '../core/statistics.js';
import { downloadFile } from '../ui/files.js';

/* =========================================================
   成绩录入 · 考试管理、表格录入（支持从 Excel 粘贴）、按表头导入
   ========================================================= */
var Sc = { exam: null };

var EXAM_TYPES = ['月考', '期中', '期末', '周测', '单元测', '模拟考', '其他'];

function cellCls(v, full) {
  if (v === null) return ' miss';
  if (typeof v !== 'number') return '';
  if (v > full || v < 0) return ' bad';
  if (v < full * 0.6) return ' low';
  return '';
}

function parseScore(t) {
  t = String(t == null ? '' : t)
    .replace(/[\uff10-\uff19\uff0e\uff0d]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    })
    .trim();
  if (t === '') return undefined;
  if (/^(缺|缺考|-|—|\/|x|X)$/.test(t)) return null;
  var n = parseFloat(t.replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? undefined : n;
}

function setScore(ex, sid, sub, v) {
  if (!ex.scores[sid]) ex.scores[sid] = {};
  if (v === undefined) delete ex.scores[sid][sub];
  else ex.scores[sid][sub] = v;
}

function onCellInput(e) {
  var t = e.target;
  if (!t.classList.contains('sc-in')) return;
  var ex = examById(Sc.exam),
    v = parseScore(t.value),
    full = +t.getAttribute('data-full');
  setScore(ex, t.getAttribute('data-sid'), t.getAttribute('data-sub'), v);
  t.className = 'sc-in' + cellCls(v, full);
  save();
  Sc.refreshTotals();
}

function cellAt(r, c) {
  return $('#scGrid .sc-in[data-r="' + r + '"][data-c="' + c + '"]');
}

function onCellKey(e) {
  var t = e.target;
  if (!t.classList.contains('sc-in')) return;
  var r = +t.getAttribute('data-r'),
    c = +t.getAttribute('data-c'),
    nx = null;
  if (e.key === 'Enter' || e.key === 'ArrowDown')
    nx = cellAt(r + (e.shiftKey && e.key === 'Enter' ? -1 : 1), c);
  else if (e.key === 'ArrowUp') nx = cellAt(r - 1, c);
  else if (e.key === 'ArrowRight' && t.selectionStart === t.value.length) nx = cellAt(r, c + 1);
  else if (e.key === 'ArrowLeft' && t.selectionStart === 0) nx = cellAt(r, c - 1);
  if (nx) {
    e.preventDefault();
    nx.focus();
  }
}

function onCellPaste(e) {
  var t = e.target;
  if (!t.classList.contains('sc-in')) return;
  var text = (e.clipboardData || window.clipboardData).getData('text');
  if (!/[\t\n]/.test(text.replace(/[\r\n]+$/, ''))) return; // 单个值走默认
  e.preventDefault();
  var rows = parseTable(text, true),
    r0 = +t.getAttribute('data-r'),
    c0 = +t.getAttribute('data-c'),
    ex = examById(Sc.exam),
    n = 0,
    bad = 0;
  rows.forEach(function (row, i) {
    row.forEach(function (val, j) {
      var cell = cellAt(r0 + i, c0 + j);
      if (!cell) return;
      var v = parseScore(val),
        full = +cell.getAttribute('data-full');
      cell.value = v === null ? '缺' : v === undefined ? '' : v;
      setScore(ex, cell.getAttribute('data-sid'), cell.getAttribute('data-sub'), v);
      cell.className = 'sc-in' + cellCls(v, full);
      if (typeof v === 'number' && (v > full || v < 0)) bad++;
      n++;
    });
  });
  save();
  Sc.refreshTotals();
  UI.toast('已填入 ' + n + ' 个分数' + (bad ? '，' + bad + ' 个超出满分已标红' : ''));
}

/* ---------- 新建 / 编辑考试 ---------- */
function examForm(ex) {
  var isNew = !ex;
  var subs = S.settings.subjects.slice();
  var chosen = {};
  if (ex)
    ex.subjects.forEach(function (s) {
      chosen[s.name] = s.full;
      if (
        !subs.some(function (x) {
          return x.name === s.name;
        })
      )
        subs.push({ name: s.name, full: s.full });
    });
  else
    subs.forEach(function (s) {
      chosen[s.name] = s.full;
    });
  Sc.form = { subs: subs, chosen: chosen };
  var body =
    '<div class="row2"><div class="field"><label>考试名称<span class="req">*</span></label><input class="inp" id="exName" value="' +
    esc(ex ? ex.name : '') +
    '" placeholder="如：十一月月考" autofocus></div>' +
    '<div class="field"><label>考试日期<span class="req">*</span></label><input class="inp" type="date" id="exDate" value="' +
    esc(ex ? ex.date : todayStr()) +
    '"></div></div>' +
    '<div class="field"><label>类型</label><div class="chips" id="exType">' +
    EXAM_TYPES.map(function (t) {
      return (
        '<button type="button" class="' +
        ((ex ? ex.type : '月考') === t ? 'on' : '') +
        '" data-act="ex-type" data-t="' +
        t +
        '">' +
        t +
        '</button>'
      );
    }).join('') +
    '</div></div>' +
    '<div class="field"><label>科目与满分</label><div class="sub-list" id="exSubs" style="margin-top:6px"></div>' +
    '<div style="display:flex;gap:6px;margin-top:10px"><input class="inp" id="exNewSub" placeholder="添加科目，如：化学" style="width:180px;height:32px"><input class="inp num" id="exNewFull" value="100" style="width:72px;height:32px"><button class="btn btn-light btn-sm" data-act="ex-sub-add">添加</button></div></div>';
  UI.modal({
    title: isNew ? '新建考试' : '编辑考试',
    body: body,
    foot:
      (isNew
        ? ''
        : '<button class="btn btn-ghost" data-act="exam-del" data-id="' +
          ex.id +
          '" style="margin-right:auto;color:var(--red)">' +
          ICON.trash +
          '删除考试</button>') +
      '<button class="btn btn-light" data-act="modal-close">取消</button><button class="btn btn-dark" data-act="exam-save" data-id="' +
      (ex ? ex.id : '') +
      '">' +
      (isNew ? '创建并录入' : '保存') +
      '</button>'
  });
  Sc.renderSubs();
}

function scImpParse(ex) {
  var rows = parseTable($('#scImp').value);
  if (rows.length < 2) return null;
  var head = rows[0].map(function (x) {
    return x.replace(/\s/g, '');
  });
  var ni = head.indexOf('姓名'),
    noi = head.indexOf('学号');
  if (ni < 0) ni = head.indexOf('名字');
  var cols = {};
  ex.subjects.forEach(function (s) {
    var i = head.indexOf(s.name);
    if (i >= 0) cols[s.name] = i;
  });
  return { rows: rows.slice(1), ni: ni, noi: noi, cols: cols };
}

function findStu(name, no) {
  name = (name || '').trim();
  no = (no || '').trim();
  if (no) {
    for (var i = 0; i < S.students.length; i++)
      if (String(S.students[i].no) === no) return S.students[i];
  }
  if (name) {
    var m = S.students.filter(function (s) {
      return s.name === name;
    });
    if (m.length === 1) return m[0];
  }
  return null; // 学号对不上、且重名时不猜，避免写错人
}
export function registerFeaturesScores() {
  UI.register('scores', {
    render: function (main) {
      var exs = examsSorted().reverse();
      if (!Sc.exam || !examById(Sc.exam)) Sc.exam = exs.length ? exs[0].id : null;
      var h =
        '<div class="page scroll"><div class="page-head"><div><h1 class="page-title">成绩录入</h1></div><div class="grow"></div>' +
        '<button class="btn btn-dark" data-act="exam-new">' +
        ICON.plus +
        '新建考试</button></div>';
      if (!exs.length) {
        h +=
          '<div class="panel"><div class="empty">' +
          ART.teacherAvatar(S.settings.teacher, 72, false) +
          '还没有考试。新建一场考试，选好科目和满分，就能开始录入。<div style="margin-top:14px"><button class="btn btn-dark" data-act="exam-new">' +
          ICON.plus +
          '新建考试</button></div></div></div></div>';
        main.innerHTML = h;
        return;
      }
      h +=
        '<div class="score-layout"><div class="exam-list">' +
        exs
          .map(function (e) {
            var p = entryProgress(e);
            return (
              '<button class="exam-item' +
              (e.id === Sc.exam ? ' on' : '') +
              '" data-act="exam-pick" data-id="' +
              e.id +
              '"><div class="t">' +
              esc(e.name) +
              '<span class="tag gray" style="height:19px;font-size:12px">' +
              esc(e.type || '考试') +
              '</span></div>' +
              '<div class="m">' +
              esc(e.date) +
              ' · ' +
              e.subjects.length +
              ' 科 · 已录 ' +
              p.n +
              '/' +
              p.total +
              '</div><div class="prog"><i style="width:' +
              (p.total ? Math.round((p.n / p.total) * 100) : 0) +
              '%"></i></div></button>'
            );
          })
          .join('') +
        '</div><div id="scGrid"></div></div></div>';
      main.innerHTML = h;
      Sc.renderGrid();
    }
  });

  Sc.renderGrid = function () {
    var ex = examById(Sc.exam),
      el = $('#scGrid');
    if (!ex || !el) return;
    var rm = rankMap(ex);
    var h =
      '<div class="page-head" style="margin-bottom:12px"><div><div style="font-size:20px;font-weight:700">' +
      esc(ex.name) +
      '</div><div class="page-desc">' +
      esc(ex.date) +
      ' · ' +
      esc(ex.type || '') +
      ' · 满分 ' +
      examFull(ex) +
      '</div></div><div class="grow"></div>' +
      '<button class="btn btn-light btn-sm" data-act="exam-edit" data-id="' +
      ex.id +
      '">' +
      ICON.edit +
      '编辑考试</button>' +
      '<button class="btn btn-light btn-sm" data-act="score-import" data-id="' +
      ex.id +
      '">' +
      ICON.up +
      '按表头导入</button>' +
      '<button class="btn btn-light btn-sm" data-act="score-export" data-id="' +
      ex.id +
      '">' +
      ICON.down +
      '导出</button>' +
      '<button class="btn btn-dark btn-sm" data-act="go" data-page="analysis">' +
      ICON.chart +
      '看分析</button></div>' +
      '<div class="paste-hint">' +
      ICON.copy +
      '<span>按学号顺序粘贴分数：⌘ / Ctrl + V。缺考填「缺」。</span></div>' +
      '<div class="tbl-wrap" style="max-height:calc(100vh - 250px)"><table class="tbl grid-tbl"><thead><tr><th>学号</th><th>姓名</th>' +
      ex.subjects
        .map(function (s) {
          return '<th class="c">' + esc(s.name) + ' <small>' + s.full + '</small></th>';
        })
        .join('') +
      '<th class="c">总分</th><th class="c">排名</th></tr></thead><tbody>';
    var list = studentsByNo();
    if (!list.length)
      h +=
        '<tr><td colspan="' +
        (ex.subjects.length + 4) +
        '"><div class="empty">班里还没有学生，先去「学生档案」添加</div></td></tr>';
    list.forEach(function (st, ri) {
      var row = ex.scores[st.id] || {},
        r = rm[st.id];
      h +=
        '<tr data-sid="' +
        st.id +
        '"><td class="num muted">' +
        esc(st.no || '') +
        '</td><td><b style="font-weight:500">' +
        esc(st.name) +
        '</b></td>' +
        ex.subjects
          .map(function (sb, ci) {
            var v = row[sb.name],
              txt = v === null ? '缺' : v === undefined ? '' : v;
            return (
              '<td class="cell"><input class="sc-in' +
              cellCls(v, sb.full) +
              '" data-r="' +
              ri +
              '" data-c="' +
              ci +
              '" data-sid="' +
              st.id +
              '" data-sub="' +
              esc(sb.name) +
              '" data-full="' +
              sb.full +
              '" value="' +
              esc(txt) +
              '" inputmode="decimal" aria-label="' +
              esc(st.name + ' ' + sb.name) +
              '"></td>'
            );
          })
          .join('') +
        '<td class="tot" data-tot="' +
        st.id +
        '">' +
        (r ? fmtNum(r.total, 1) : '') +
        '</td><td class="rk" data-rk="' +
        st.id +
        '">' +
        (r ? r.rank : '') +
        '</td></tr>';
    });
    el.innerHTML = h + '</tbody></table></div>';
    var tb = el.querySelector('.grid-tbl');
    tb.addEventListener('input', onCellInput);
    tb.addEventListener('keydown', onCellKey);
    tb.addEventListener('paste', onCellPaste);
    tb.addEventListener('focusin', function (e) {
      if (e.target.select) e.target.select();
    });
  };

  Sc.refreshTotals = function () {
    var ex = examById(Sc.exam),
      rm = rankMap(ex);
    $$('#scGrid [data-tot]').forEach(function (td) {
      var r = rm[td.getAttribute('data-tot')];
      td.textContent = r ? fmtNum(r.total, 1) : '';
    });
    $$('#scGrid [data-rk]').forEach(function (td) {
      var r = rm[td.getAttribute('data-rk')];
      td.textContent = r ? r.rank : '';
    });
    var item = $('.exam-item.on .m'),
      p = entryProgress(ex);
    if (item)
      item.textContent = ex.date + ' · ' + ex.subjects.length + ' 科 · 已录 ' + p.n + '/' + p.total;
    var bar = $('.exam-item.on .prog i');
    if (bar) bar.style.width = (p.total ? Math.round((p.n / p.total) * 100) : 0) + '%';
  };

  UI.act['exam-pick'] = function (el) {
    Sc.exam = el.getAttribute('data-id');
    $$('.exam-item').forEach(function (b) {
      b.classList.toggle('on', b === el);
    });
    Sc.renderGrid();
  };

  Sc.renderSubs = function () {
    var f = Sc.form;
    $('#exSubs').innerHTML = f.subs
      .map(function (s, i) {
        var on = f.chosen[s.name] !== undefined;
        return (
          '<span class="sub-item" style="' +
          (on ? 'background:#171717;color:#fff' : '') +
          '"><span data-act="ex-sub-toggle" data-i="' +
          i +
          '" style="cursor:pointer">' +
          esc(s.name) +
          '</span><input value="' +
          (on ? f.chosen[s.name] : s.full) +
          '" data-inp="ex-sub-full" data-i="' +
          i +
          '" aria-label="' +
          esc(s.name) +
          '满分"' +
          (on ? '' : ' disabled') +
          '></span>'
        );
      })
      .join('');
  };

  UI.act['ex-type'] = function (el) {
    $$('#exType button').forEach(function (b) {
      b.classList.toggle('on', b === el);
    });
  };

  UI.act['ex-sub-toggle'] = function (el) {
    var s = Sc.form.subs[+el.getAttribute('data-i')];
    if (Sc.form.chosen[s.name] !== undefined) delete Sc.form.chosen[s.name];
    else Sc.form.chosen[s.name] = s.full;
    Sc.renderSubs();
  };

  UI.inp['ex-sub-full'] = function (el) {
    var s = Sc.form.subs[+el.getAttribute('data-i')];
    var v = parseFloat(el.value);
    if (v > 0) Sc.form.chosen[s.name] = v;
  };

  UI.act['ex-sub-add'] = function () {
    var n = $('#exNewSub').value.trim(),
      f = parseFloat($('#exNewFull').value) || 100;
    if (!n) return;
    if (
      !Sc.form.subs.some(function (s) {
        return s.name === n;
      })
    )
      Sc.form.subs.push({ name: n, full: f });
    Sc.form.chosen[n] = f;
    $('#exNewSub').value = '';
    Sc.renderSubs();
  };

  UI.act['exam-new'] = function () {
    examForm(null);
  };

  UI.act['exam-edit'] = function (el) {
    examForm(examById(el.getAttribute('data-id')));
  };

  UI.act['exam-save'] = function (el) {
    var id = el.getAttribute('data-id'),
      name = $('#exName').value.trim(),
      date = $('#exDate').value;
    if (!name) {
      $('#exName').focus();
      UI.toast('请填写考试名称');
      return;
    }
    if (!date) {
      UI.toast('请选择考试日期');
      return;
    }
    var type = ($('#exType .on') || {}).textContent || '其他';
    var subs = Sc.form.subs
      .filter(function (s) {
        return Sc.form.chosen[s.name] !== undefined;
      })
      .map(function (s) {
        return { name: s.name, full: Sc.form.chosen[s.name] };
      });
    if (!subs.length) {
      UI.toast('至少选一个科目');
      return;
    }
    if (id) {
      var ex = examById(id);
      ex.name = name;
      ex.date = date;
      ex.type = type;
      ex.subjects = subs;
    } else {
      var nx = { id: uid('ex'), name: name, date: date, type: type, subjects: subs, scores: {} };
      S.exams.push(nx);
      Sc.exam = nx.id;
    }
    // 新科目写回默认科目表
    subs.forEach(function (s) {
      if (
        !S.settings.subjects.some(function (x) {
          return x.name === s.name;
        })
      )
        S.settings.subjects.push({ name: s.name, full: s.full });
    });
    save();
    UI.closeModal();
    UI.go('scores');
    setTimeout(function () {
      var c = cellAt(0, 0);
      if (c && !id) c.focus();
    }, 50);
  };

  UI.act['exam-del'] = function (el) {
    var ex = examById(el.getAttribute('data-id'));
    UI.confirm(
      '删除考试',
      '确定删除「' + esc(ex.name) + '」及其全部成绩吗？此操作无法恢复。',
      '删除',
      function () {
        S.exams = S.exams.filter(function (e) {
          return e.id !== ex.id;
        });
        Sc.exam = null;
        save();
        UI.go('scores');
        UI.toast('已删除');
      },
      true
    );
  };

  UI.act['score-export'] = function (el) {
    var ex = examById(el.getAttribute('data-id')),
      rm = rankMap(ex);
    var rows = [
      ['学号', '姓名']
        .concat(
          ex.subjects.map(function (s) {
            return s.name;
          })
        )
        .concat(['总分', '排名'])
    ];
    studentsByNo().forEach(function (st) {
      var row = ex.scores[st.id] || {},
        r = rm[st.id];
      rows.push(
        [st.no, st.name]
          .concat(
            ex.subjects.map(function (s) {
              var v = row[s.name];
              return v === null ? '缺考' : v === undefined ? '' : v;
            })
          )
          .concat([r ? r.total : '', r ? r.rank : ''])
      );
    });
    downloadFile(
      S.settings.className + '-' + ex.name + '-成绩.csv',
      toCSV(rows),
      'text/csv;charset=utf-8'
    );
  };

  UI.act['score-import'] = function (el) {
    var ex = examById(el.getAttribute('data-id'));
    UI.modal({
      title: '按表头导入成绩 · ' + esc(ex.name),
      wide: true,
      body:
        '<p style="margin:0 0 12px;color:var(--ink2);line-height:1.7;font-size:14px">从 Excel 复制带表头的成绩表粘贴进来（顺序不限）。需要有「姓名」或「学号」列，科目列名要和考试科目一致：' +
        ex.subjects
          .map(function (s) {
            return '<span class="tag gray" style="margin:0 2px">' + esc(s.name) + '</span>';
          })
          .join('') +
        '</p>' +
        '<textarea class="ta" id="scImp" style="min-height:200px;font-family:var(--num);font-size:14px" placeholder="姓名	语文	数学	英语&#10;张三	98	105	110" data-inp="sc-imp-prev"></textarea><div class="muted" id="scImpInfo" style="font-size:14px;margin-top:8px"></div>',
      foot:
        '<button class="btn btn-light" data-act="modal-close">取消</button><button class="btn btn-dark" data-act="sc-imp-go" data-id="' +
        ex.id +
        '">导入</button>'
    });
  };

  UI.inp['sc-imp-prev'] = function () {
    var ex = examById(Sc.exam),
      p = scImpParse(ex),
      info = $('#scImpInfo');
    if (!p) {
      info.textContent = '';
      return;
    }
    if (p.ni < 0 && p.noi < 0) {
      info.innerHTML = '<span class="dn">没找到「姓名」或「学号」列</span>';
      return;
    }
    var matched = 0;
    p.rows.forEach(function (r) {
      if (findStu(r[p.ni], r[p.noi])) matched++;
    });
    info.textContent =
      '共 ' +
      p.rows.length +
      ' 行，匹配到 ' +
      matched +
      ' 名学生；识别科目：' +
      (Object.keys(p.cols).join('、') || '无');
  };

  UI.act['sc-imp-go'] = function (el) {
    var ex = examById(el.getAttribute('data-id')),
      p = scImpParse(ex);
    if (!p || (p.ni < 0 && p.noi < 0)) {
      UI.toast('没有识别到姓名或学号列');
      return;
    }
    var n = 0,
      miss = [];
    p.rows.forEach(function (r) {
      var st = findStu(r[p.ni], r[p.noi]);
      if (!st) {
        miss.push(r[p.ni] || r[p.noi]);
        return;
      }
      Object.keys(p.cols).forEach(function (sub) {
        var v = parseScore(r[p.cols[sub]]);
        if (v !== undefined) setScore(ex, st.id, sub, v);
      });
      n++;
    });
    save();
    UI.closeModal();
    Sc.renderGrid();
    Sc.refreshTotals();
    UI.toast(
      '导入 ' + n + ' 名学生的成绩' + (miss.length ? '，' + miss.length + ' 行没对上名字' : '')
    );
  };
}

export { parseScore, setScore };
