import {
  characterOf,
  characterById,
  charactersForGender,
  ensureStudentCharacters
} from '../core/characters.js';
import { characterPickerHTML, updateCharacterPicker } from '../ui/character-picker.js';
// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import {
  age,
  daysToBirthday,
  examsSorted,
  latestExam,
  pointsOf,
  prevExam,
  seatMap,
  stuById,
  studentsByNo
} from '../core/queries.js';
import { examFull, examStats, rankMap, stuTrend, subjectStats } from '../core/statistics.js';
import { S } from '../core/state.js';
import {
  $,
  $$,
  deepClone,
  esc,
  fmtMD,
  fmtNum,
  fmtTime,
  pad2,
  parseDate,
  round1,
  todayStr,
  uid
} from '../core/utils.js';
import {
  Cls,
  allSeats,
  autoGroups,
  drawScene,
  groupName,
  renderDock,
  seatText
} from './classroom.js';
import { FAMILY_TYPES, RECORD_TYPES, ROLES, TAG_POOL } from '../core/constants.js';
import { UI, stuAva } from '../ui/workspace.js';
import { ICON } from '../ui/icons.js';
import { CH } from '../charts/charts.js';
import { parseTable, toCSV } from '../core/table.js';
import { save } from '../core/storage.js';
import { copyText, downloadFile } from '../ui/files.js';

/* =========================================================
   学生档案 · 名单、档案抽屉、编辑表单、导入导出、成长记录、评语
   ========================================================= */
var Stu = { q: '', filter: 'all', sort: 'no', dir: 1, tab: 'overview' };

var STU_FILTERS = [
  ['all', '全部'],
  ['M', '男生'],
  ['F', '女生'],
  ['cadre', '班干部'],
  ['focus', '重点关注'],
  ['board', '住校'],
  ['bday', '本月生日'],
  ['noseat', '未排座']
];

function stuFiltered() {
  var q = Stu.q,
    f = Stu.filter,
    m = new Date().getMonth() + 1;
  var lat = latestExam(),
    rm = lat ? rankMap(lat) : {};
  var list = S.students.filter(function (s) {
    if (
      q &&
      s.name.indexOf(q) < 0 &&
      String(s.no).indexOf(q) < 0 &&
      (s.tags || []).join(',').indexOf(q) < 0
    )
      return false;
    if (f === 'M') return s.gender !== 'F';
    if (f === 'F') return s.gender === 'F';
    if (f === 'cadre') return !!s.role;
    if (f === 'focus') return (s.tags || []).indexOf('重点关注') >= 0;
    if (f === 'board') return s.boarding || (s.tags || []).indexOf('住校') >= 0;
    if (f === 'bday') {
      var b = parseDate(s.birthday);
      return b && b.getMonth() + 1 === m;
    }
    if (f === 'noseat') return !s.seat;
    return true;
  });
  var k = Stu.sort,
    dir = Stu.dir;
  list.sort(function (a, b) {
    var va, vb;
    if (k === 'rank') {
      va = rm[a.id] ? rm[a.id].rank : 999;
      vb = rm[b.id] ? rm[b.id].rank : 999;
    } else if (k === 'pts') {
      va = -pointsOf(a.id);
      vb = -pointsOf(b.id);
    } else if (k === 'bday') {
      va = daysToBirthday(a);
      vb = daysToBirthday(b);
      if (va === null) va = 999;
      if (vb === null) vb = 999;
    } else if (k === 'name') return a.name.localeCompare(b.name, 'zh') * dir;
    else {
      return String(a.no).localeCompare(String(b.no), 'zh', { numeric: true }) * dir;
    }
    return (va - vb) * dir;
  });
  return { list: list, rm: rm, lat: lat };
}

/* ---------- 学生表单 ---------- */
function openStudentForm(st, opts) {
  var isNew = !st;
  var d = st
    ? deepClone(st)
    : {
        id: uid('stu'),
        name: '',
        gender: 'M',
        no: nextNo(),
        seat: opts.seat || firstEmptySeat(),
        group: 0,
        birthday: '',
        role: '',
        tags: [],
        boarding: false,
        parents: [{ name: '', rel: '母亲', phone: '', job: '' }],
        family: '双亲家庭',
        familyNote: '',
        study: '',
        strengths: '',
        personality: '',
        health: '',
        note: '',
        comments: []
      };
  while (d.parents.length < 2)
    d.parents.push({ name: '', rel: d.parents.length ? '父亲' : '母亲', phone: '', job: '' });
  if (!d.characterId) ensureStudentCharacters({ students: S.students.concat(d) });
  Stu.form = d;
  var seats = allSeats(),
    occ = seatMap();
  var seatOpts =
    '<option value="">未排座</option>' +
    seats
      .map(function (k) {
        var o = occ[k],
          taken = o && o.id !== d.id;
        return (
          '<option value="' +
          k +
          '"' +
          (d.seat === k ? ' selected' : '') +
          '>' +
          seatText(k) +
          (taken ? '（' + esc(o.name) + (isNew ? '，将挪到空位）' : '，将互换）') : '') +
          '</option>'
        );
      })
      .join('');
  function pf(i) {
    var p = d.parents[i];
    return (
      '<div class="row3" style="grid-template-columns:1.1fr .8fr 1.2fr 1fr"><div class="field"><label>' +
      (i === 0 ? '主要联系人' : '其他联系人') +
      '</label><input class="inp" id="fP' +
      i +
      'n" value="' +
      esc(p.name) +
      '" placeholder="姓名"></div>' +
      '<div class="field"><label>关系</label><input class="inp" id="fP' +
      i +
      'r" value="' +
      esc(p.rel) +
      '" list="relList"></div>' +
      '<div class="field"><label>电话</label><input class="inp num" id="fP' +
      i +
      'p" value="' +
      esc(p.phone) +
      '" inputmode="tel"></div>' +
      '<div class="field"><label>职业</label><input class="inp" id="fP' +
      i +
      'j" value="' +
      esc(p.job || '') +
      '"></div></div>'
    );
  }
  var body =
    characterPickerHTML(characterOf(d).id, 'f-character', d.gender === 'F' ? 'F' : 'M') +
    '<div class="row3"><div class="field"><label>姓名<span class="req">*</span></label><input class="inp" id="fName" value="' +
    esc(d.name) +
    '" autofocus maxlength="20"></div>' +
    '<div class="field"><label>性别</label><div class="seg light" id="fGender"><button type="button" class="' +
    (d.gender !== 'F' ? 'on' : '') +
    '" data-act="f-gender" data-g="M">男生</button><button type="button" class="' +
    (d.gender === 'F' ? 'on' : '') +
    '" data-act="f-gender" data-g="F">女生</button></div></div>' +
    '<div class="field"><label>学号</label><input class="inp num" id="fNo" value="' +
    esc(d.no) +
    '"></div></div>' +
    '<div class="row3"><div class="field"><label>生日</label><input class="inp" type="date" id="fBday" value="' +
    esc(d.birthday) +
    '"></div>' +
    '<div class="field"><label>职务</label><input class="inp" id="fRole" value="' +
    esc(d.role) +
    '" list="roleList" placeholder="如：班长、数学课代表"></div>' +
    '<div class="field"><label>座位</label><select class="sel" id="fSeat">' +
    seatOpts +
    '</select></div></div>' +
    '<div class="field"><label>标签</label><div class="chips" id="fTags">' +
    TAG_POOL.concat(
      d.tags.filter(function (t) {
        return TAG_POOL.indexOf(t) < 0;
      })
    )
      .map(function (t) {
        return (
          '<button type="button" class="' +
          (d.tags.indexOf(t) >= 0 ? 'on' : '') +
          '" data-act="f-tag" data-t="' +
          esc(t) +
          '">' +
          esc(t) +
          '</button>'
        );
      })
      .join('') +
    '<input class="inp" id="fTagNew" placeholder="+ 自定义" style="width:96px;height:28px;font-size:14px;border-radius:999px" data-key="f-tag-new"></div></div>' +
    '<div class="hr"></div><div class="flabel" style="margin-bottom:10px">家庭情况</div>' +
    '<div class="row2"><div class="field"><label>家庭结构</label><select class="sel" id="fFam">' +
    FAMILY_TYPES.map(function (t) {
      return '<option' + (d.family === t ? ' selected' : '') + '>' + t + '</option>';
    }).join('') +
    '</select></div>' +
    '<div class="field"><label>住宿</label><div class="seg light"><button type="button" class="' +
    (!d.boarding ? 'on' : '') +
    '" data-act="f-board" data-v="0">走读</button><button type="button" class="' +
    (d.boarding ? 'on' : '') +
    '" data-act="f-board" data-v="1">住校</button></div></div></div>' +
    pf(0) +
    pf(1) +
    '<div class="field"><label>家庭备注</label><textarea class="ta" id="fFamNote" maxlength="500" placeholder="家庭氛围、监护人、沟通习惯等">' +
    esc(d.familyNote) +
    '</textarea></div>' +
    '<div class="hr"></div><div class="flabel" style="margin-bottom:10px">学习与成长</div>' +
    '<div class="field"><label>学习情况</label><textarea class="ta" id="fStudy" maxlength="500" placeholder="学习习惯、优势和薄弱学科、课堂表现">' +
    esc(d.study) +
    '</textarea></div>' +
    '<div class="row2"><div class="field"><label>性格与特长</label><textarea class="ta" id="fPers" maxlength="300">' +
    esc(d.personality) +
    '</textarea></div>' +
    '<div class="field"><label>健康情况</label><textarea class="ta" id="fHealth" maxlength="300" placeholder="过敏、视力、病史、体育课注意事项">' +
    esc(d.health) +
    '</textarea></div></div>' +
    '<div class="field"><label>其他备注</label><textarea class="ta" id="fNote" maxlength="500" style="min-height:60px">' +
    esc(d.note) +
    '</textarea></div>' +
    '<datalist id="roleList">' +
    ROLES.map(function (r) {
      return '<option value="' + r + '">';
    }).join('') +
    '</datalist>' +
    '<datalist id="relList"><option value="母亲"><option value="父亲"><option value="祖母"><option value="祖父"><option value="外祖母"><option value="外祖父"><option value="其他监护人"></datalist>';
  UI.modal({
    title: isNew ? '添加学生' : '编辑 · ' + esc(st.name),
    wide: true,
    body: body,
    foot:
      (isNew
        ? '<label class="chk" style="margin-right:auto"><input type="checkbox" id="fMore"> 保存后继续添加</label>'
        : '<button class="btn btn-ghost" data-act="stu-del" data-sid="' +
          d.id +
          '" style="margin-right:auto;color:var(--red)">' +
          ICON.trash +
          '删除学生</button>') +
      '<button class="btn btn-light" data-act="modal-close">取消</button><button class="btn btn-dark" data-act="stu-save" data-new="' +
      (isNew ? 1 : 0) +
      '">保存</button>'
  });
}

function nextNo() {
  var max = 0,
    pre = '',
    w = 2;
  S.students.forEach(function (s) {
    var m = String(s.no || '').match(/^(.*?)(\d+)$/);
    if (m && +m[2] > max) {
      max = +m[2];
      pre = m[1];
      w = m[2].length;
    }
  });
  if (!max) return pad2(S.students.length + 1);
  var n = String(max + 1);
  while (n.length < w) n = '0' + n;
  return pre + n;
}

function firstEmptySeat() {
  var m = seatMap(),
    a = allSeats();
  for (var i = 0; i < a.length; i++) if (!m[a[i]]) return a[i];
  return null;
}

function refreshAfterChange() {
  UI.refreshSide();
  if (UI.page === 'class') {
    drawScene();
    Cls.renderRail();
    renderDock();
  } else if (UI.page === 'students') Stu.renderTable();
  else UI.rerender();
}

/* ---------- 档案抽屉 ---------- */
function openStudent(sid, tab) {
  var st = stuById(sid);
  if (!st) return;
  UI.hideCard();
  Stu.tab = tab || (UI.drawerSid === sid ? Stu.tab : 'overview');
  UI.drawerSid = sid;
  UI.charts = UI.charts || [];
  var tabs = [
    ['overview', '概览'],
    ['profile', '档案'],
    ['scores', '成绩'],
    ['records', '成长记录'],
    ['comments', '评语']
  ];
  var html =
    '<div class="dr-hero">' +
    stuAva(st, 84) +
    '<div style="min-width:0"><div class="dr-name">' +
    esc(st.name) +
    (st.role ? '<span class="tag gray" style="font-size:12px">' + esc(st.role) + '</span>' : '') +
    '</div>' +
    '<div class="dr-meta">' +
    esc(st.no || '') +
    ' · ' +
    (st.gender === 'F' ? '女' : '男') +
    (age(st) !== null ? ' · ' + age(st) + ' 岁' : '') +
    ' · ' +
    seatText(st.seat) +
    (st.seat ? ' · ' + groupName(st.group || 0) : '') +
    '</div>' +
    (st.tags && st.tags.length
      ? '<div class="tags" style="margin-top:8px">' +
        st.tags
          .map(function (t) {
            return '<span class="tag">' + esc(t) + '</span>';
          })
          .join('') +
        '</div>'
      : '') +
    '</div>' +
    '<div class="dr-tools"><button class="btn btn-sm btn-light" data-act="ai-tpl" data-tpl="comment1" data-sid="' +
    st.id +
    '">' +
    ICON.spark +
    'AI 写评语</button><button class="btn btn-sm btn-light" data-act="ai-tpl" data-tpl="parent" data-sid="' +
    st.id +
    '">家长沟通</button><button class="btn btn-sm btn-dark" data-act="stu-edit" data-sid="' +
    st.id +
    '">编辑档案</button><button class="modal-x" data-act="drawer-close" aria-label="关闭">' +
    ICON.x +
    '</button></div></div>' +
    '<div class="tabs">' +
    tabs
      .map(function (t) {
        return (
          '<button class="' +
          (Stu.tab === t[0] ? 'on' : '') +
          '" data-act="dr-tab" data-tab="' +
          t[0] +
          '" data-sid="' +
          st.id +
          '">' +
          t[1] +
          '</button>'
        );
      })
      .join('') +
    '</div>' +
    '<div class="drawer-body" id="drBody"></div>';
  if (!$('#drawerHost .drawer')) UI.drawer(html);
  else $('#drawerHost .drawer').innerHTML = html;
  renderDrawerBody(st);
}

function drChart(fn) {
  var id = 'dch' + Math.random().toString(36).slice(2, 7);
  Stu.dch.push({ id: id, fn: fn });
  return '<div class="chart" id="' + id + '"></div>';
}

function renderDrawerBody(st) {
  Stu.dch = [];
  var b = $('#drBody'),
    h = '';
  var trend = stuTrend(st.id),
    lat = latestExam();
  if (Stu.tab === 'overview') {
    var cur = null,
      prv = null;
    for (var i = trend.length - 1; i >= 0; i--) {
      if (trend[i].total !== null) {
        if (!cur) cur = trend[i];
        else {
          prv = trend[i];
          break;
        }
      }
    }
    var ch = cur && prv ? prv.rank - cur.rank : null;
    var pts = pointsOf(st.id);
    var monthKey = todayStr().slice(0, 7),
      absN = 0,
      leaveN = 0,
      lateN = 0;
    Object.keys(S.attendance).forEach(function (k) {
      if (k.indexOf(monthKey) === 0) {
        var v = S.attendance[k][st.id];
        if (v === 'absent') absN++;
        if (v === 'leave') leaveN++;
        if (v === 'late') lateN++;
      }
    });
    var bdd = daysToBirthday(st);
    h +=
      '<div class="kpis"><div class="kpi"><div class="k">' +
      (cur ? esc(cur.ex.name) + ' 总分' : '最近总分') +
      '</div><div class="v">' +
      (cur ? fmtNum(cur.total, 1) : '—') +
      '<small>' +
      (cur ? '/ ' + examFull(cur.ex) : '') +
      '</small></div><div class="d">' +
      (cur
        ? '班级第 ' +
          cur.rank +
          ' 名 ' +
          (ch
            ? '<span class="' +
              (ch > 0 ? 'up' : 'dn') +
              '">' +
              (ch > 0 ? '↑' + ch : '↓' + -ch) +
              '</span>'
            : '')
        : '<span class="muted">暂无成绩</span>') +
      '</div></div>' +
      '<div class="kpi"><div class="k">累计积分</div><div class="v">' +
      (pts > 0 ? '+' : '') +
      pts +
      '</div><div class="d muted">' +
      S.points.filter(function (p) {
        return p.sid === st.id;
      }).length +
      ' 次点评</div></div>' +
      '<div class="kpi"><div class="k">本月考勤</div><div class="v">' +
      (absN + leaveN + lateN === 0 ? '全勤' : leaveN + absN + '<small>天未到</small>') +
      '</div><div class="d muted">请假 ' +
      leaveN +
      ' · 缺勤 ' +
      absN +
      ' · 迟到 ' +
      lateN +
      '</div></div>' +
      '<div class="kpi"><div class="k">生日</div><div class="v" style="font-size:20px">' +
      (st.birthday ? fmtMD(st.birthday) : '—') +
      '</div><div class="d muted">' +
      (bdd === null ? '未填写' : bdd === 0 ? '就是今天' : bdd + ' 天后') +
      '</div></div></div>';
    var valid = trend.filter(function (t) {
      return t.ex;
    });
    if (valid.length) {
      h +=
        '<div class="grid2"><div class="panel"><div class="panel-title">总分得分率</div>' +
        drChart(function (w) {
          var labs = trend.map(function (t) {
            return t.ex.name;
          });
          var me = trend.map(function (t) {
            return t.rate === null ? null : t.rate * 100;
          });
          var cls = trend.map(function (t) {
            var x = examStats(t.ex);
            return x.rate === undefined ? null : x.rate * 100;
          });
          return CH.lines(
            [
              { name: st.name, color: CH.C.s1, values: me },
              { name: '班级平均', color: CH.C.base, values: cls }
            ],
            labs.map(shortExam),
            w,
            {
              h: 210,
              min: 40,
              max: 100,
              fmt: function (v) {
                return Math.round(v) + '%';
              },
              tipFmt: function (v) {
                return round1(v) + '%';
              }
            }
          );
        }) +
        '<div class="legend"><span><i style="background:' +
        CH.C.s1 +
        '"></i>' +
        esc(st.name) +
        '</span><span><i style="background:' +
        CH.C.base +
        '"></i>班级平均</span></div></div>';
      var le = cur ? cur.ex : lat;
      h +=
        '<div class="panel"><div class="panel-title">学科画像</div><div class="panel-sub">' +
        esc(le.name) +
        ' 各科得分率</div>' +
        drChart(function (w) {
          var axes = le.subjects.map(function (s) {
            return s.name;
          });
          var row = le.scores[st.id] || {};
          var me = le.subjects.map(function (s) {
            return typeof row[s.name] === 'number' ? row[s.name] / s.full : 0;
          });
          var cls = le.subjects.map(function (s) {
            var x = subjectStats(le, s.name);
            return x.rate || 0;
          });
          return CH.radar(
            axes,
            [
              { name: '班级平均', color: CH.C.base, values: cls, fill: false },
              { name: st.name, color: CH.C.s1, values: me }
            ],
            w,
            { h: 210 }
          );
        }) +
        '<div class="legend"><span><i style="background:' +
        CH.C.s1 +
        '"></i>' +
        esc(st.name) +
        '</span><span><i style="background:' +
        CH.C.base +
        '"></i>班级平均</span></div></div></div>';
    }
    h +=
      '<div class="panel" style="margin-top:16px"><div class="info-grid">' +
      '<div class="k">学习情况</div><div>' +
      (esc(st.study) || '<span class="muted">未填写</span>') +
      '</div>' +
      '<div class="k">性格特长</div><div>' +
      (esc(st.personality) || '<span class="muted">未填写</span>') +
      '</div>' +
      '<div class="k">家庭情况</div><div>' +
      esc(st.family || '') +
      (st.familyNote ? ' · ' + esc(st.familyNote) : '') +
      '</div>' +
      (st.health ? '<div class="k">健康</div><div>' + esc(st.health) + '</div>' : '') +
      '</div></div>';
    var recent = S.records
      .filter(function (r) {
        return r.sid === st.id;
      })
      .sort(function (a, b) {
        return a.date < b.date ? 1 : -1;
      })
      .slice(0, 3);
    if (recent.length)
      h +=
        '<div class="panel" style="margin-top:16px"><div class="panel-title" style="margin-bottom:12px">最近记录</div><div class="timeline">' +
        recent.map(recHTML).join('') +
        '</div></div>';
  } else if (Stu.tab === 'profile') {
    var ps = st.parents || [];
    h +=
      '<div class="panel" style="margin-top:18px"><div class="panel-title" style="margin-bottom:12px">基本信息</div><div class="info-grid">' +
      '<div class="k">姓名</div><div>' +
      esc(st.name) +
      '</div><div class="k">学号</div><div class="num">' +
      esc(st.no || '—') +
      '</div>' +
      '<div class="k">性别</div><div>' +
      (st.gender === 'F' ? '女' : '男') +
      '</div><div class="k">生日</div><div>' +
      (esc(st.birthday) || '—') +
      '</div>' +
      '<div class="k">职务</div><div>' +
      (esc(st.role) || '—') +
      '</div><div class="k">座位</div><div>' +
      seatText(st.seat) +
      '</div>' +
      '<div class="k">住宿</div><div>' +
      (st.boarding ? '住校' : '走读') +
      '</div></div></div>' +
      '<div class="panel" style="margin-top:16px"><div class="panel-title" style="margin-bottom:12px">家庭与联系人</div><div class="info-grid"><div class="k">家庭结构</div><div>' +
      esc(st.family || '—') +
      '</div>' +
      ps
        .map(function (p, i) {
          return (
            '<div class="k">' +
            (i === 0 ? '主要联系人' : '其他联系人') +
            '</div><div>' +
            esc(p.name) +
            ' <span class="muted">' +
            esc(p.rel) +
            (p.job ? ' · ' + esc(p.job) : '') +
            '</span> <span class="num">' +
            esc(p.phone) +
            '</span>' +
            (p.phone
              ? ' <button class="btn btn-xs btn-ghost" data-act="copy-txt" data-t="' +
                esc(p.phone) +
                '">' +
                ICON.copy +
                '</button>'
              : '') +
            '</div>'
          );
        })
        .join('') +
      '<div class="k">家庭备注</div><div>' +
      (esc(st.familyNote) || '—') +
      '</div></div></div>' +
      '<div class="panel" style="margin-top:16px"><div class="panel-title" style="margin-bottom:12px">学习与成长</div><div class="info-grid">' +
      '<div class="k">学习情况</div><div>' +
      (esc(st.study) || '—') +
      '</div><div class="k">性格特长</div><div>' +
      (esc(st.personality) || '—') +
      '</div>' +
      '<div class="k">健康情况</div><div>' +
      (esc(st.health) || '—') +
      '</div><div class="k">其他备注</div><div>' +
      (esc(st.note) || '—') +
      '</div></div></div>' +
      '<div style="margin-top:14px;text-align:right"><button class="btn btn-dark" data-act="stu-edit" data-sid="' +
      st.id +
      '">' +
      ICON.edit +
      '编辑档案</button></div>';
  } else if (Stu.tab === 'scores') {
    var exs = examsSorted();
    if (!exs.length) h += '<div class="empty">还没有考试成绩</div>';
    else {
      var subs = [];
      exs.forEach(function (e) {
        e.subjects.forEach(function (s) {
          if (subs.indexOf(s.name) < 0) subs.push(s.name);
        });
      });
      h +=
        '<div class="tbl-wrap" style="margin-top:18px"><table class="tbl"><thead><tr><th>考试</th>' +
        subs
          .map(function (s) {
            return '<th class="c">' + esc(s) + '</th>';
          })
          .join('') +
        '<th class="c">总分</th><th class="c">排名</th></tr></thead><tbody>';
      exs
        .slice()
        .reverse()
        .forEach(function (e) {
          var row = e.scores[st.id] || {},
            rk = rankMap(e)[st.id];
          h +=
            '<tr><td><b style="font-weight:600">' +
            esc(e.name) +
            '</b><br><span class="muted num" style="font-size:12px">' +
            esc(e.date) +
            '</span></td>' +
            subs
              .map(function (s) {
                var sb = e.subjects.filter(function (x) {
                  return x.name === s;
                })[0];
                if (!sb) return '<td class="c muted">—</td>';
                var v = row[s];
                if (v === null) return '<td class="c"><span class="tag amber">缺考</span></td>';
                if (typeof v !== 'number') return '<td class="c muted">—</td>';
                var low = v < sb.full * 0.6;
                return '<td class="c num' + (low ? ' dn' : '') + '">' + v + '</td>';
              })
              .join('') +
            '<td class="c num"><b>' +
            (rk ? fmtNum(rk.total, 1) : '—') +
            '</b></td><td class="c num">' +
            (rk ? rk.rank : '—') +
            '</td></tr>';
        });
      h +=
        '</tbody></table></div><div class="muted" style="font-size:12px;margin-top:8px">红色为不及格（低于满分的 60%）</div>';
      h +=
        '<div class="panel" style="margin-top:16px"><div class="panel-title">班级排名变化</div>' +
        drChart(function (w) {
          var n = S.students.length;
          var vals = trend.map(function (t) {
            return t.rank === null ? null : n - t.rank + 1;
          });
          return CH.lines(
            [{ name: '排名', color: CH.C.s1, values: vals }],
            trend.map(function (t) {
              return shortExam(t.ex.name);
            }),
            w,
            {
              h: 200,
              min: 1,
              max: n,
              fmt: function (v) {
                return '第' + Math.round(n - v + 1);
              },
              tipFmt: function (v) {
                return '第 ' + Math.round(n - v + 1) + ' 名';
              }
            }
          );
        }) +
        '</div>';
    }
  } else if (Stu.tab === 'records') {
    h +=
      '<div class="panel" style="margin-top:18px"><div class="panel-title" style="margin-bottom:12px">新增记录</div><div class="row3" style="grid-template-columns:120px 150px 1fr"><div class="field"><label>类型</label><select class="sel" id="recType">' +
      RECORD_TYPES.map(function (t) {
        return '<option>' + t + '</option>';
      }).join('') +
      '</select></div>' +
      '<div class="field"><label>日期</label><input class="inp" type="date" id="recDate" value="' +
      todayStr() +
      '"></div><div class="field"><label>内容</label><input class="inp" id="recText" placeholder="例如：主动帮同学讲题，课上表扬" data-key="rec-add"></div></div>' +
      '<div style="text-align:right"><button class="btn btn-dark btn-sm" data-act="rec-add" data-sid="' +
      st.id +
      '">添加记录</button></div></div>';
    var recs = S.records
      .filter(function (r) {
        return r.sid === st.id;
      })
      .sort(function (a, b) {
        return a.date < b.date ? 1 : -1;
      });
    h +=
      '<div class="panel" style="margin-top:16px"><div class="panel-title" style="margin-bottom:12px">成长时间线</div>' +
      (recs.length
        ? '<div class="timeline">' +
          recs
            .map(function (r) {
              return recHTML(r, true);
            })
            .join('') +
          '</div>'
        : '<div class="empty">还没有记录。谈话、家访、获奖都可以记在这里，写期末评语时 AI 会参考。</div>') +
      '</div>';
    var pts = S.points.filter(function (p) {
      return p.sid === st.id;
    });
    h +=
      '<div class="panel" style="margin-top:16px"><div class="panel-title" style="margin-bottom:10px">点评明细 <span class="muted" style="font-weight:400;font-size:14px">共 ' +
      pts.length +
      ' 次 · 合计 ' +
      (pointsOf(st.id) > 0 ? '+' : '') +
      pointsOf(st.id) +
      '</span></div>' +
      (pts.length
        ? '<table class="tbl"><tbody>' +
          pts
            .slice(0, 40)
            .map(function (p) {
              return (
                '<tr><td class="num muted" style="width:110px">' +
                fmtTime(p.t) +
                '</td><td>' +
                esc(p.r) +
                '</td><td class="r num ' +
                (p.d > 0 ? 'up' : 'dn') +
                '"><b>' +
                (p.d > 0 ? '+' : '') +
                p.d +
                '</b></td><td class="r" style="width:50px"><button class="btn btn-xs btn-ghost" data-act="pt-del" data-id="' +
                p.id +
                '" data-sid="' +
                st.id +
                '">撤销</button></td></tr>'
              );
            })
            .join('') +
          '</tbody></table>'
        : '<div class="empty">在教室的「点评」模式里点这位同学即可加减分</div>') +
      '</div>';
  } else if (Stu.tab === 'comments') {
    h +=
      '<div class="panel" style="margin-top:18px"><div class="panel-title" style="margin-bottom:10px">写一条评语</div><textarea class="ta" id="cmtText" placeholder="可以自己写，也可以点右上角「AI 写评语」，生成后保存到这里" style="min-height:96px"></textarea>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn btn-light btn-sm" data-act="ai-tpl" data-tpl="comment1" data-sid="' +
      st.id +
      '">' +
      ICON.spark +
      'AI 生成</button><button class="btn btn-dark btn-sm" data-act="cmt-add" data-sid="' +
      st.id +
      '">保存评语</button></div></div>';
    var cs = (st.comments || []).slice().reverse();
    h +=
      '<div style="margin-top:16px">' +
      (cs.length
        ? cs
            .map(function (c) {
              return (
                '<div class="cmt"><div class="cmt-meta"><span>' +
                esc(c.date) +
                '</span><span class="tag ' +
                (c.src === 'AI' ? 'blue' : 'gray') +
                '">' +
                (c.src === 'AI' ? 'AI 生成' : '手写') +
                '</span><span class="grow"></span><button class="btn btn-xs btn-ghost" data-act="copy-txt" data-t="' +
                esc(c.text) +
                '">' +
                ICON.copy +
                '复制</button><button class="btn btn-xs btn-ghost" data-act="cmt-del" data-id="' +
                c.id +
                '" data-sid="' +
                st.id +
                '">删除</button></div>' +
                esc(c.text) +
                '</div>'
              );
            })
            .join('')
        : '<div class="empty">还没有评语</div>') +
      '</div>';
  }
  b.innerHTML = h;
  Stu.dch.forEach(function (c) {
    var el = document.getElementById(c.id);
    if (el) el.innerHTML = c.fn(Math.max(240, el.clientWidth));
  });
}

function shortExam(n) {
  return String(n).replace('考试', '').replace(/\s+/g, ' ');
}

function recHTML(r, del) {
  return (
    '<div class="tl-item t-' +
    esc(r.type) +
    '"><div class="tl-top"><span class="num">' +
    esc(r.date) +
    '</span><span class="tag gray">' +
    esc(r.type) +
    '</span>' +
    (del
      ? '<button class="del" data-act="rec-del" data-id="' +
        r.id +
        '" data-sid="' +
        r.sid +
        '">删除</button>'
      : '') +
    '</div><div class="tl-txt">' +
    esc(r.text) +
    '</div></div>'
  );
}

/* ---------- 导入导出 ---------- */
var STU_COLS = [
  ['name', ['姓名', '名字', '学生姓名']],
  ['gender', ['性别']],
  ['no', ['学号', '编号']],
  ['birthday', ['生日', '出生日期', '出生年月']],
  ['role', ['职务', '班干部']],
  ['p0name', ['家长姓名', '家长', '联系人', '监护人']],
  ['p0rel', ['关系', '家长关系']],
  ['p0phone', ['家长电话', '联系电话', '电话', '手机']],
  ['family', ['家庭结构', '家庭情况']],
  ['familyNote', ['家庭备注']],
  ['study', ['学习情况']],
  ['personality', ['性格', '性格特长']],
  ['health', ['健康', '健康情况']],
  ['note', ['备注', '其他备注']]
];

function impParse() {
  var rows = parseTable($('#impText').value);
  if (rows.length < 2) return { rows: [], map: {} };
  var head = rows[0].map(function (h) {
      return h.replace(/[（(][^）)]*[）)]/g, '').replace(/[\s*：:]/g, '');
    }),
    map = {},
    used = {};
  // 先精确匹配表头，再按前缀匹配（如「性别（男/女）」「家长电话1」）
  [0, 1].forEach(function (pass) {
    head.forEach(function (hd, i) {
      if (used[i] || !hd) return;
      STU_COLS.forEach(function (c) {
        if (used[i] || map[c[0]] !== undefined) return;
        var hit = c[1].some(function (al) {
          return pass === 0 ? hd === al : hd.indexOf(al) === 0;
        });
        if (hit) {
          map[c[0]] = i;
          used[i] = 1;
        }
      });
    });
  });
  return { rows: rows.slice(1), map: map };
}
export function registerFeaturesStudents() {
  UI.act['f-character'] = function (el) {
    const id = el.getAttribute('data-character');
    if (!charactersForGender(Stu.form.gender).includes(characterById(id))) return;
    Stu.form.characterId = id;
    updateCharacterPicker(el, id);
  };

  UI.register('students', {
    render: function (main) {
      var boys = S.students.filter(function (s) {
        return s.gender !== 'F';
      }).length;
      main.innerHTML =
        '<div class="page scroll"><div class="page-head"><div><h1 class="page-title">学生档案</h1><div class="page-desc">共 ' +
        S.students.length +
        ' 人 · 男 ' +
        boys +
        ' · 女 ' +
        (S.students.length - boys) +
        '</div></div><div class="grow"></div>' +
        '<button class="btn btn-light" data-act="stu-import">' +
        ICON.up +
        '批量导入</button><button class="btn btn-light" data-act="stu-export">' +
        ICON.down +
        '导出名单</button><button class="btn btn-dark" data-act="stu-add">' +
        ICON.userplus +
        '添加学生</button></div>' +
        '<div class="filterbar"><input class="inp" placeholder="搜索姓名、学号或标签" value="' +
        esc(Stu.q) +
        '" data-inp="stu-q" id="stuQ"><div class="chips" id="stuChips"></div></div>' +
        '<div class="tbl-wrap" id="stuTbl"></div></div>';
      Stu.renderTable();
    }
  });

  Stu.renderTable = function () {
    var r = stuFiltered();
    $('#stuChips').innerHTML = STU_FILTERS.map(function (f) {
      return (
        '<button class="' +
        (Stu.filter === f[0] ? 'on' : '') +
        '" data-act="stu-filter" data-f="' +
        f[0] +
        '">' +
        f[1] +
        '</button>'
      );
    }).join('');
    var pm = r.lat && prevExam(r.lat) ? rankMap(prevExam(r.lat)) : {};
    function th(k, t, cls) {
      return (
        '<th class="sortable ' +
        (cls || '') +
        '" data-act="stu-sort" data-k="' +
        k +
        '">' +
        t +
        (Stu.sort === k ? (Stu.dir > 0 ? ' ↑' : ' ↓') : '') +
        '</th>'
      );
    }
    var h =
      '<table class="tbl"><thead><tr>' +
      th('no', '学号') +
      th('name', '姓名') +
      '<th>性别</th><th>座位</th><th>职务</th>' +
      th('bday', '生日') +
      '<th>主要联系人</th><th>标签</th>' +
      th('rank', r.lat ? esc(r.lat.name) + '排名' : '排名', 'r') +
      th('pts', '积分', 'r') +
      '<th></th></tr></thead><tbody>';
    if (!r.list.length)
      h +=
        '<tr><td colspan="11"><div class="empty">' +
        (S.students.length
          ? '没有符合条件的学生'
          : '还没有学生，点右上角「添加学生」或「批量导入」') +
        '</div></td></tr>';
    r.list.forEach(function (s) {
      var p = s.parents && s.parents[0],
        rk = r.rm[s.id],
        ch = rk && pm[s.id] ? pm[s.id].rank - rk.rank : null,
        pts = pointsOf(s.id);
      var bdd = daysToBirthday(s);
      h +=
        '<tr class="click" data-act="open-stu" data-sid="' +
        s.id +
        '"><td class="num muted">' +
        esc(s.no || '') +
        '</td><td><div class="nm">' +
        stuAva(s, 28) +
        esc(s.name) +
        '</div></td>' +
        '<td>' +
        (s.gender === 'F' ? '女' : '男') +
        '</td><td class="sub">' +
        seatText(s.seat) +
        '</td><td>' +
        (s.role
          ? '<span class="tag gray">' + esc(s.role) + '</span>'
          : '<span class="muted">—</span>') +
        '</td>' +
        '<td class="num">' +
        (s.birthday ? esc(s.birthday.slice(5)) : '—') +
        (bdd === 0 ? ' <span class="tag red">今天</span>' : '') +
        '</td>' +
        '<td>' +
        (p
          ? esc(p.name) +
            ' <span class="muted">' +
            esc(p.rel || '') +
            '</span><br><span class="num muted" style="font-size:12px">' +
            esc(p.phone || '') +
            '</span>'
          : '<span class="muted">—</span>') +
        '</td>' +
        '<td><div class="tags">' +
        (s.tags || [])
          .slice(0, 3)
          .map(function (t) {
            return '<span class="tag">' + esc(t) + '</span>';
          })
          .join('') +
        ((s.tags || []).length > 3
          ? '<span class="tag gray">+' + (s.tags.length - 3) + '</span>'
          : '') +
        '</div></td>' +
        '<td class="r num">' +
        (rk ? rk.rank : '—') +
        (ch
          ? ' <span class="' +
            (ch > 0 ? 'up' : 'dn') +
            '" style="font-size:12px">' +
            (ch > 0 ? '↑' + ch : '↓' + -ch) +
            '</span>'
          : '') +
        '</td>' +
        '<td class="r num">' +
        (pts > 0 ? '+' : '') +
        pts +
        '</td>' +
        '<td class="r"><span class="ops"><button class="btn btn-xs btn-ghost" data-act="stu-edit" data-sid="' +
        s.id +
        '">编辑</button></span></td></tr>';
    });
    $('#stuTbl').innerHTML = h + '</tbody></table>';
  };

  UI.inp['stu-q'] = function (el) {
    Stu.q = el.value.trim();
    Stu.renderTable();
  };

  UI.act['stu-filter'] = function (el) {
    Stu.filter = el.getAttribute('data-f');
    Stu.renderTable();
  };

  UI.act['stu-sort'] = function (el) {
    var k = el.getAttribute('data-k');
    if (Stu.sort === k) Stu.dir = -Stu.dir;
    else {
      Stu.sort = k;
      Stu.dir = 1;
    }
    Stu.renderTable();
  };

  UI.act['stu-add'] = function () {
    openStudentForm(null, {});
  };

  UI.act['stu-edit'] = function (el, e) {
    e.stopPropagation();
    openStudentForm(stuById(el.getAttribute('data-sid')), {});
  };

  UI.act['open-stu'] = function (el) {
    var sp = $('#gsearchPop');
    if (sp) sp.innerHTML = '';
    var gi = $('#gsearch');
    if (gi) gi.value = '';
    UI.closeModal();
    UI.closePop();
    openStudent(el.getAttribute('data-sid'));
  };

  UI.act['f-gender'] = function (el) {
    Stu.form.gender = el.getAttribute('data-g');
    ensureStudentCharacters({
      students: S.students.filter((s) => s.id !== Stu.form.id).concat(Stu.form)
    });
    const picker = $('.character-picker', el.closest('.modal'));
    if (picker)
      picker.outerHTML = characterPickerHTML(
        characterOf(Stu.form).id,
        'f-character',
        Stu.form.gender
      );
    $$('#fGender button').forEach(function (b) {
      b.classList.toggle('on', b === el);
    });
  };

  UI.act['f-board'] = function (el) {
    Stu.form.boarding = el.getAttribute('data-v') === '1';
    $$('button', el.parentNode).forEach(function (b) {
      b.classList.toggle('on', b === el);
    });
  };

  UI.act['f-tag'] = function (el) {
    var t = el.getAttribute('data-t'),
      a = Stu.form.tags,
      i = a.indexOf(t);
    if (i >= 0) a.splice(i, 1);
    else a.push(t);
    el.classList.toggle('on', i < 0);
  };

  UI.key['f-tag-new'] = function (el, e) {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    var t = el.value.trim();
    if (!t) return;
    if (Stu.form.tags.indexOf(t) < 0) Stu.form.tags.push(t);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'on';
    b.setAttribute('data-act', 'f-tag');
    b.setAttribute('data-t', t);
    b.textContent = t;
    el.parentNode.insertBefore(b, el);
    el.value = '';
  };

  UI.act['stu-save'] = function (el) {
    var d = Stu.form,
      isNew = el.getAttribute('data-new') === '1';
    d.name = $('#fName').value.trim();
    if (!d.name) {
      $('#fName').focus();
      UI.toast('请填写姓名');
      return;
    }
    d.no = $('#fNo').value.trim();
    d.birthday = $('#fBday').value;
    d.role = $('#fRole').value.trim();
    var seat = $('#fSeat').value || null;
    d.family = $('#fFam').value;
    d.familyNote = $('#fFamNote').value.trim();
    d.study = $('#fStudy').value.trim();
    d.personality = $('#fPers').value.trim();
    d.health = $('#fHealth').value.trim();
    d.note = $('#fNote').value.trim();
    d.parents = [0, 1]
      .map(function (i) {
        return {
          name: $('#fP' + i + 'n').value.trim(),
          rel: $('#fP' + i + 'r').value.trim(),
          phone: $('#fP' + i + 'p').value.trim(),
          job: $('#fP' + i + 'j').value.trim()
        };
      })
      .filter(function (p) {
        return p.name || p.phone;
      });
    if (d.boarding && d.tags.indexOf('住校') < 0) d.tags.push('住校');
    if (!d.boarding)
      d.tags = d.tags.filter(function (t) {
        return t !== '住校';
      });
    // 座位：被占用则互换
    var occ = seatMap()[seat];
    var old = isNew ? null : stuById(d.id);
    if (seat && occ && occ.id !== d.id) {
      occ.seat = old ? old.seat : null;
      if (!occ.seat) {
        var m2 = seatMap(),
          free = allSeats().filter(function (k) {
            return k !== seat && !m2[k];
          });
        occ.seat = free[0] || null;
      }
    }
    d.seat = seat;
    if (isNew) S.students.push(d);
    else {
      var i = S.students.indexOf(old);
      S.students[i] = d;
    }
    autoGroups();
    save();
    var more = isNew && $('#fMore') && $('#fMore').checked;
    UI.closeModal();
    UI.toast(isNew ? '已添加 ' + d.name : '已保存');
    refreshAfterChange();
    if (UI.drawerSid === d.id) openStudent(d.id, Stu.tab);
    if (more) {
      openStudentForm(null, {});
      var c = $('#fMore');
      if (c) c.checked = true;
    }
  };

  UI.act['stu-del'] = function (el) {
    var st = stuById(el.getAttribute('data-sid'));
    if (!st) return;
    UI.confirm(
      '删除学生',
      '确定删除「' + esc(st.name) + '」吗？TA 的成绩、考勤、点评和成长记录也会一起删除，无法恢复。',
      '删除',
      function () {
        S.students = S.students.filter(function (s) {
          return s.id !== st.id;
        });
        S.points = S.points.filter(function (p) {
          return p.sid !== st.id;
        });
        S.records = S.records.filter(function (p) {
          return p.sid !== st.id;
        });
        S.exams.forEach(function (e) {
          delete e.scores[st.id];
        });
        Object.keys(S.attendance).forEach(function (k) {
          delete S.attendance[k][st.id];
        });
        save();
        UI.closeDrawer();
        refreshAfterChange();
        UI.toast('已删除 ' + st.name);
      },
      true
    );
  };

  UI.act['dr-tab'] = function (el) {
    Stu.tab = el.getAttribute('data-tab');
    openStudent(el.getAttribute('data-sid'), Stu.tab);
  };

  UI.act['rec-add'] = function (el) {
    var sid = el.getAttribute('data-sid') || UI.drawerSid,
      t = $('#recText').value.trim();
    if (!t) {
      $('#recText').focus();
      return;
    }
    S.records.push({
      id: uid('r'),
      sid: sid,
      type: $('#recType').value,
      text: t,
      date: $('#recDate').value || todayStr()
    });
    save();
    openStudent(sid, 'records');
    UI.toast('已记录');
    if (UI.page === 'class') Cls.renderRail();
  };

  UI.key['rec-add'] = function (el, e) {
    if (e.key === 'Enter' && !e.isComposing)
      UI.act['rec-add']({
        getAttribute: function () {
          return UI.drawerSid;
        }
      });
  };

  UI.act['rec-del'] = function (el) {
    S.records = S.records.filter(function (r) {
      return r.id !== el.getAttribute('data-id');
    });
    save();
    openStudent(el.getAttribute('data-sid'), 'records');
  };

  UI.act['pt-del'] = function (el) {
    S.points = S.points.filter(function (p) {
      return p.id !== el.getAttribute('data-id');
    });
    save();
    openStudent(el.getAttribute('data-sid'), 'records');
    if (UI.page === 'class') {
      drawScene();
      Cls.renderRail();
    }
  };

  UI.act['cmt-add'] = function (el) {
    var st = stuById(el.getAttribute('data-sid')),
      t = $('#cmtText').value.trim();
    if (!t) {
      $('#cmtText').focus();
      return;
    }
    st.comments.push({ id: uid('c'), text: t, date: todayStr(), src: '手写' });
    save();
    openStudent(st.id, 'comments');
    UI.toast('评语已保存');
  };

  UI.act['cmt-del'] = function (el) {
    var st = stuById(el.getAttribute('data-sid'));
    st.comments = st.comments.filter(function (c) {
      return c.id !== el.getAttribute('data-id');
    });
    save();
    openStudent(st.id, 'comments');
  };

  UI.act['copy-txt'] = function (el, e) {
    e.stopPropagation();
    copyText(el.getAttribute('data-t'));
  };

  UI.act['stu-import'] = function () {
    UI.modal({
      title: '批量导入学生',
      wide: true,
      body:
        '<p style="margin:0 0 12px;color:var(--ink2);line-height:1.7;font-size:14px">在 Excel 里选中名单（第一行是表头），复制后粘贴到下面；也可以选择 CSV 文件。能识别的表头：姓名、性别、学号、生日、职务、家长姓名、关系、家长电话、家庭结构、备注等，只有「姓名」是必需的。</p>' +
        '<textarea class="ta" id="impText" style="min-height:180px;font-family:var(--num);font-size:14px" placeholder="姓名	性别	学号	生日	家长姓名	家长电话&#10;张三	男	01	2012-05-06	张建国	13800000000" data-inp="imp-preview"></textarea>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-top:10px"><label class="btn btn-light btn-sm" style="cursor:pointer">' +
        ICON.up +
        '选择 CSV 文件<input type="file" accept=".csv,.txt" hidden data-chg="imp-file"></label><button class="btn btn-ghost btn-sm" data-act="imp-template">下载模板</button><span class="muted" id="impInfo" style="font-size:14px;margin-left:auto"></span></div>' +
        '<label class="chk" style="margin-top:12px"><input type="checkbox" id="impSeat" checked> 自动安排到空座位</label>',
      foot: '<button class="btn btn-light" data-act="modal-close">取消</button><button class="btn btn-dark" data-act="imp-go">导入</button>'
    });
  };

  UI.inp['imp-preview'] = function () {
    var r = impParse(),
      info = $('#impInfo');
    if (!r.rows.length) {
      info.textContent = '';
      return;
    }
    if (r.map.name === undefined) {
      info.innerHTML = '<span class="dn">没找到「姓名」列，请确认第一行是表头</span>';
      return;
    }
    info.textContent =
      '识别到 ' + r.rows.length + ' 名学生，' + Object.keys(r.map).length + ' 列信息';
  };

  UI.chg['imp-file'] = function (el) {
    var f = el.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      $('#impText').value = rd.result;
      UI.inp['imp-preview']();
    };
    rd.readAsText(f, 'utf-8');
  };

  UI.act['imp-template'] = function () {
    downloadFile(
      '学生名单模板.csv',
      toCSV([
        [
          '姓名',
          '性别',
          '学号',
          '生日',
          '职务',
          '家长姓名',
          '关系',
          '家长电话',
          '家庭结构',
          '备注'
        ],
        ['张三', '男', '01', '2012-05-06', '', '张建国', '父亲', '13800000000', '双亲家庭', '']
      ]),
      'text/csv;charset=utf-8'
    );
  };

  UI.act['imp-go'] = function () {
    var r = impParse();
    if (r.map.name === undefined) {
      UI.toast('没有识别到「姓名」列');
      return;
    }
    var autoSeat = $('#impSeat').checked,
      added = 0,
      skipped = 0;
    r.rows.forEach(function (row) {
      function g(k) {
        return r.map[k] !== undefined ? (row[r.map[k]] || '').trim() : '';
      }
      var name = g('name');
      if (!name) return;
      if (
        S.students.some(function (s) {
          return s.name === name && (!g('no') || s.no === g('no'));
        })
      ) {
        skipped++;
        return;
      }
      var bd = g('birthday')
        .replace(/[年月\/.]/g, '-')
        .replace(/日/g, '');
      var bp = bd.split('-');
      bd = bp.length === 3 ? bp[0] + '-' + pad2(+bp[1]) + '-' + pad2(+bp[2]) : '';
      var st = {
        id: uid('stu'),
        name: name,
        gender: /女|f/i.test(g('gender')) ? 'F' : 'M',
        no: g('no') || nextNo(),
        seat: autoSeat ? firstEmptySeat() : null,
        group: 0,
        birthday: bd,
        role: g('role'),
        tags: [],
        boarding: false,
        parents:
          g('p0name') || g('p0phone')
            ? [{ name: g('p0name'), rel: g('p0rel') || '家长', phone: g('p0phone'), job: '' }]
            : [],
        family:
          FAMILY_TYPES.indexOf(g('family')) >= 0 ? g('family') : g('family') ? '其他' : '双亲家庭',
        familyNote:
          FAMILY_TYPES.indexOf(g('family')) >= 0
            ? g('familyNote')
            : [g('family'), g('familyNote')].filter(Boolean).join('；'),
        study: g('study'),
        strengths: '',
        personality: g('personality'),
        health: g('health'),
        note: g('note'),
        comments: []
      };
      S.students.push(st);
      added++;
    });
    autoGroups();
    save();
    UI.closeModal();
    refreshAfterChange();
    UI.toast('导入 ' + added + ' 人' + (skipped ? '，跳过重复 ' + skipped + ' 人' : ''));
  };

  UI.act['stu-export'] = function () {
    var rows = [
      [
        '学号',
        '姓名',
        '性别',
        '生日',
        '职务',
        '座位',
        '家长姓名',
        '关系',
        '家长电话',
        '家庭结构',
        '家庭备注',
        '学习情况',
        '性格特长',
        '健康情况',
        '标签',
        '积分'
      ]
    ];
    studentsByNo().forEach(function (s) {
      var p = s.parents[0] || {};
      rows.push([
        s.no,
        s.name,
        s.gender === 'F' ? '女' : '男',
        s.birthday,
        s.role,
        seatText(s.seat),
        p.name,
        p.rel,
        p.phone,
        s.family,
        s.familyNote,
        s.study,
        s.personality,
        s.health,
        (s.tags || []).join('、'),
        pointsOf(s.id)
      ]);
    });
    downloadFile(S.settings.className + '-学生名单.csv', toCSV(rows), 'text/csv;charset=utf-8');
  };
}

export { openStudent, openStudentForm, shortExam };
