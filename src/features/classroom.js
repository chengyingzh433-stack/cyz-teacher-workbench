import { columnCount, seatKeys, resizeSeating, pairedSeats } from '../core/seating.js';
// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { S, replaceState } from '../core/state.js';
import {
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
} from '../core/queries.js';
import {
  $,
  $$,
  WEEK,
  clamp,
  esc,
  fmtMD,
  fmtNum,
  fmtTime,
  pad2,
  parseDate,
  pct,
  todayStr,
  uid
} from '../core/utils.js';
import { ART } from '../art/scene.js';
import { examStats, rankMap } from '../core/statistics.js';
import { ATT, SUBJECT_PRESETS } from '../core/constants.js';
import { CH } from '../charts/charts.js';
import { UI, stuAva } from '../ui/workspace.js';
let studentActions; // Injected once by main.js; classroom does not import the student page.
import { save } from '../core/storage.js';
import { ICON } from '../ui/icons.js';
import { downloadFile } from '../ui/files.js';
import { toCSV } from '../core/table.js';
import { defaultState } from '../core/schema.js';

/* =========================================================
   教室页 · 场景、五种模式、悬浮卡、拖拽排座、随机点名、右侧栏
   ========================================================= */
var Cls = {
  mode: 'daily',
  view: { s: 1, x: 0, y: 0, fit: true },
  L: null,
  attDate: null,
  gradeExam: null,
  seatUndo: null,
  layoutUndo: null,
  pickedSeat: null,
  idle: null,
  clock: null,
  down: null,
  picking: false,
  recentPicks: [],
  entered: false,
  cardT: null,
  hideT: null
};

var MODES = [
  { id: 'daily', t: '日常' },
  { id: 'att', t: '考勤' },
  { id: 'points', t: '点评' },
  { id: 'grade', t: '成绩' },
  { id: 'seat', t: '排座' }
];

var REDUCED = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function seatText(seat) {
  if (!seat) return '未排座';
  var p = seat.split('-');
  return '第' + (+p[0] + 1) + '排 第' + (+p[1] + 1) + '座';
}

function groupName(i) {
  return ['第一组', '第二组', '第三组', '第四组', '第五组', '第六组'][i] || '第' + (i + 1) + '组';
}

function autoGroups() {
  S.students.forEach(function (s) {
    if (s.seat) s.group = Math.floor(+s.seat.split('-')[1] / 2);
  });
}

function boardData() {
  var st = S.settings,
    d = new Date();
  var cd = countdownDays(),
    cdd = parseDate(st.countdown.date);
  return {
    leftTitle: '今日课程',
    leftLines: String(st.boardLeft || '').split('\n'),
    rightTitle: '今日事项',
    rightLines: String(st.boardRight || '').split('\n'),
    screenTop:
      st.className + ' · ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + WEEK[d.getDay()],
    countLabel: st.countdown.label || '考试',
    days: cd,
    screenBottom:
      cd === null
        ? st.school || ''
        : cdd.getFullYear() + '年' + (cdd.getMonth() + 1) + '月' + cdd.getDate() + '日',
    stars: weekStars(),
    bdays: monthBirthdays()
  };
}

function weekStars() {
  // 本周（周一起）积分最高的 3 位同学
  var n = new Date(),
    wd = (n.getDay() + 6) % 7,
    since = new Date(n.getFullYear(), n.getMonth(), n.getDate() - wd).getTime();
  var m = {};
  S.points.forEach(function (p) {
    if (p.t >= since) m[p.sid] = (m[p.sid] || 0) + p.d;
  });
  return Object.keys(m)
    .filter(function (k) {
      return m[k] > 0 && stuById(k);
    })
    .sort(function (a, b) {
      return m[b] - m[a];
    })
    .slice(0, 3)
    .map(function (k) {
      return { name: stuById(k).name, pts: '+' + m[k] };
    });
}

function monthBirthdays() {
  var mo = new Date().getMonth() + 1;
  return S.students
    .map(function (s) {
      var b = parseDate(s.birthday);
      return b && b.getMonth() + 1 === mo ? { s: s, d: b.getDate() } : null;
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return a.d - b.d;
    })
    .map(function (x) {
      return { name: x.s.name, date: mo + '月' + x.d + '日' };
    });
}

function sceneExtra() {
  // 按舞台宽高比加宽教室两侧，让教室铺满横向空间
  var st = $('#stage');
  if (!st || Cls.mode === 'seat') return 0;
  var base = ART.layout(S.settings.rows, S.settings.pairs, 0, { cols: columnCount(S.settings) });
  var W = st.clientWidth,
    H = st.clientHeight;
  if (!W || !H) return 0;
  var s = clamp(Math.max((H - 48 - 62) / base.H, 0.68), 0.3, 1.2);
  var want = (W - 32) / s - base.W;
  return Math.round(clamp(want, 0, 1000) / 20) * 20;
}

function buildViews() {
  var v = {},
    mode = Cls.mode;
  var day = S.attendance[mode === 'att' ? Cls.attDate : todayStr()] || {};
  var rmap = null,
    pmap = null,
    n = 0;
  if (mode === 'grade') {
    var ex = examById(Cls.gradeExam) || latestExam();
    if (ex) {
      rmap = rankMap(ex);
      n = Object.keys(rmap).length;
      var pe = prevExam(ex);
      pmap = pe ? rankMap(pe) : null;
    }
  }
  S.students.forEach(function (st) {
    if (!st.seat) return;
    var o = {},
      cls = [];
    var a = day[st.id];
    if (a) {
      o.chip = ATT[a].t;
      o.chipTone = ATT[a].tone;
      if (a !== 'late') cls.push('ghost');
    }
    if (mode === 'points') {
      var p = pointsOf(st.id);
      o.badge = (p > 0 ? '+' : '') + p;
      o.badgeTone = p >= 8 ? '' : 'light';
    }
    if (mode === 'grade') {
      var r = rmap && rmap[st.id];
      if (r) {
        var q = n > 1 ? (r.rank - 1) / (n - 1) : 0;
        o.tint = CH.SEQ[Math.min(4, Math.floor((1 - q) * 5))];
        var ch = pmap && pmap[st.id] ? pmap[st.id].rank - r.rank : null;
        o.badge =
          '#' +
          r.rank +
          (ch !== null && Math.abs(ch) >= 5 ? (ch > 0 ? ' ↑' + ch : ' ↓' + -ch) : '');
        o.badgeTone =
          ch !== null && ch >= 5
            ? 'up'
            : ch !== null && ch <= -5
              ? 'down'
              : r.rank <= 10
                ? ''
                : 'light';
      } else if (rmap) {
        cls.push('dim');
        o.badge = '无成绩';
        o.badgeTone = 'light';
      }
    }
    if (Cls.pickedSeat === st.seat) cls.push('picked');
    o.cls = cls.join(' ');
    v[st.id] = o;
  });
  return v;
}

function drawScene() {
  var inner = $('#stageInner');
  if (!inner) return;
  var t = S.settings.teacher;
  $('.class-page').classList.toggle('seating', Cls.mode === 'seat');
  Cls.extra = sceneExtra();
  var res = ART.scene({
    rows: S.settings.rows,
    pairs: S.settings.pairs,
    cols: columnCount(S.settings),
    studentsOnly: Cls.mode === 'seat',
    extra: Cls.extra,
    subjects: S.settings.subjects.map(function (x) {
      return x.name;
    }),
    seats: seatMap(),
    views: buildViews(),
    teacher: { gender: t.gender, characterId: t.characterId, label: t.name + ' · 班主任' },
    board: boardData(),
    seatNos: Cls.mode === 'seat'
  });
  Cls.L = res.L;
  inner.innerHTML = res.svg;
  inner.style.width = res.L.W + 'px';
  inner.style.height = res.L.H + 'px';
  if (!Cls.entered && !REDUCED) {
    Cls.entered = true;
    var svg = inner.firstChild;
    svg.classList.add('enter');
    $$('.seat .stu-in', svg).forEach(function (g, i) {
      g.style.animationDelay = Math.floor(i / 8) * 70 + (i % 8) * 18 + 'ms';
    });
    setTimeout(function () {
      svg.classList.remove('enter');
    }, 1400);
  }
  if (Cls.view.fit) fitView();
  else applyView();
  tickClock();
  var ec = $('#emptyClass');
  if (ec) ec.classList.toggle('hide', S.students.length > 0);
}

function relayout() {
  if (!$('#stage')) return;
  if (sceneExtra() !== Cls.extra) {
    Cls.view.fit = true;
    drawScene();
  } else if (Cls.view.fit) fitView();
}

function fitView() {
  var st = $('#stage');
  if (!st || !Cls.L) return;
  var W = st.clientWidth,
    H = st.clientHeight,
    top = 14,
    bottom = 14;
  var wFit = (W - 32) / Cls.L.W,
    hFit = (H - top - bottom) / Cls.L.H;
  // 适应新教室画布；工具栏在画布外，保留缩放与拖动。
  var s = Math.min(wFit, hFit);
  s = clamp(s, 0.1, 1.2);
  Cls.view = {
    s: s,
    x: (W - Cls.L.W * s) / 2,
    y: top + Math.max(0, (H - top - bottom - Cls.L.H * s) / 2),
    fit: true
  };
  applyView();
}

function applyView() {
  var inner = $('#stageInner'),
    st = $('#stage');
  if (!inner) return;
  if (st && Cls.L) {
    var v = Cls.view,
      sw = Cls.L.W * v.s,
      sh = Cls.L.H * v.s,
      W = st.clientWidth,
      H = st.clientHeight,
      m = 140;
    v.x = clamp(v.x, Math.min(m - sw, (W - sw) / 2), Math.max(W - m, (W - sw) / 2));
    v.y = clamp(v.y, Math.min(H - 90 - sh, 52), Math.max(H - m, 52));
  }
  inner.style.transform =
    'translate(' +
    Math.round(Cls.view.x) +
    'px,' +
    Math.round(Cls.view.y) +
    'px) scale(' +
    Cls.view.s +
    ')';
}

function zoomAt(f, cx, cy) {
  var v = Cls.view,
    ns = clamp(v.s * f, 0.1, 2.4);
  v.x = cx - (cx - v.x) * (ns / v.s);
  v.y = cy - (cy - v.y) * (ns / v.s);
  v.s = ns;
  v.fit = false;
  applyView();
}

function tickClock() {
  var g = $('.scene-svg .clock');
  if (!g) return;
  var cx = g.getAttribute('data-cx'),
    cy = g.getAttribute('data-cy'),
    d = new Date();
  var m = d.getMinutes() * 6,
    h = (d.getHours() % 12) * 30 + d.getMinutes() / 2;
  g.querySelector('.clock-h').setAttribute('transform', 'rotate(' + h + ' ' + cx + ' ' + cy + ')');
  g.querySelector('.clock-m').setAttribute('transform', 'rotate(' + m + ' ' + cx + ' ' + cy + ')');
}

function headPos(seat) {
  var p = seat.split('-'),
    L = Cls.L;
  return { x: L.headX(+p[1]), y: L.headY(+p[0]) };
}

function floatAt(seat, text, color) {
  var fx = $('.scene-svg .fx-layer');
  if (!fx || !seat) return;
  var p = headPos(seat);
  var ns = 'http://www.w3.org/2000/svg';
  var t = document.createElementNS(ns, 'text');
  t.setAttribute('x', p.x);
  t.setAttribute('y', p.y - 26);
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('class', 'float-pt');
  t.setAttribute('fill', color);
  t.setAttribute('stroke', '#fff');
  t.setAttribute('stroke-width', '4');
  t.setAttribute('paint-order', 'stroke');
  t.textContent = text;
  fx.appendChild(t);
  setTimeout(function () {
    t.remove();
  }, 1200);
}

function seatEl(seat) {
  return $('.scene-svg .seat[data-seat="' + seat + '"]');
}

/* ---------- 悬浮卡 ---------- */
function stuCardHTML(st) {
  var a = attToday(st.id),
    lat = latestExam(),
    rm = lat ? rankMap(lat) : {},
    pe = lat ? prevExam(lat) : null,
    pm = pe ? rankMap(pe) : {};
  var r = rm[st.id],
    ch = r && pm[st.id] ? pm[st.id].rank - r.rank : null;
  var stTxt = a ? ATT[a].t : '在校';
  var stColor =
    a === 'leave'
      ? 'var(--amber)'
      : a === 'absent'
        ? 'var(--red)'
        : a === 'late'
          ? 'var(--blue)'
          : 'var(--green)';
  var intro = [st.study, st.personality].filter(Boolean).join('；');
  var bdd = daysToBirthday(st),
    bd = parseDate(st.birthday);
  var h =
    '<div class="hc-head">' +
    stuAva(st, 56) +
    '<div style="min-width:0"><div class="hc-name">' +
    esc(st.name) +
    '</div>' +
    '<div class="hc-role">' +
    esc(st.no || '') +
    ' · ' +
    (st.gender === 'F' ? '女生' : '男生') +
    (st.role ? ' · ' + esc(st.role) : '') +
    '</div>' +
    '<div class="hc-status"><i style="background:' +
    stColor +
    '"></i>' +
    stTxt +
    ' · ' +
    seatText(st.seat) +
    '</div></div></div>';
  if (intro)
    h +=
      '<div class="hc-sec"><div class="hc-k">简介：</div><div class="hc-v">' +
      esc(intro) +
      '</div></div>';
  if (st.family || st.familyNote)
    h +=
      '<div class="hc-sec"><div class="hc-k">家庭：</div><div class="hc-v">' +
      esc([st.family, st.familyNote].filter(Boolean).join(' · ')) +
      '</div></div>';
  if (st.tags && st.tags.length)
    h +=
      '<div class="hc-sec"><div class="hc-k">标签：</div><div class="tags">' +
      st.tags
        .map(function (t) {
          return '<span class="tag">' + esc(t) + '</span>';
        })
        .join('') +
      '</div></div>';
  var pts = pointsOf(st.id);
  h +=
    '<div class="hc-stats"><div><b>' +
    (r ? '#' + r.rank : '—') +
    (ch
      ? '<small class="' +
        (ch > 0 ? 'up' : 'dn') +
        '" style="font-size:12px;margin-left:2px">' +
        (ch > 0 ? '↑' + ch : '↓' + -ch) +
        '</small>'
      : '') +
    '</b><span>' +
    (lat ? esc(lat.name) : '最近排名') +
    '</span></div>' +
    '<div><b>' +
    (pts > 0 ? '+' : '') +
    pts +
    '</b><span>积分</span></div>' +
    '<div><b>' +
    (bd ? bd.getMonth() + 1 + '/' + bd.getDate() : '—') +
    '</b><span>' +
    (bdd === 0 ? '今天生日' : '生日') +
    '</span></div></div>';
  h +=
    '<div class="hc-act"><button class="btn btn-sm btn-light" data-act="pt-quick" data-sid="' +
    st.id +
    '" data-d="1">+1 表扬</button><button class="btn btn-sm btn-dark" data-act="open-stu" data-sid="' +
    st.id +
    '">查看档案</button></div>';
  return h;
}

function teacherCardHTML() {
  var t = S.settings.teacher;
  var todo = S.todos.filter(function (x) {
    return !x.done;
  }).length;
  return (
    '<div class="hc-head">' +
    ART.teacherAvatar(t, 56) +
    '<div><div class="hc-name">' +
    esc(t.name) +
    '</div><div class="hc-role">' +
    esc(S.settings.className) +
    ' 班主任' +
    (t.subject ? ' · ' + esc(t.subject) : '') +
    '</div>' +
    '<div class="hc-status"><i></i>在岗 · 待办 ' +
    todo +
    ' 项</div></div></div>' +
    '<div class="hc-sec"><div class="hc-k">简介：</div><div class="hc-v">全班 ' +
    S.students.length +
    ' 名同学的大家长，统筹班级管理、家校沟通与学生成长。</div></div>' +
    '<div class="hc-sec"><div class="hc-k">AI 能帮你：</div><div class="tags"><span class="tag">写教案</span><span class="tag">期末评语</span><span class="tag">家长会发言稿</span><span class="tag">班会方案</span><span class="tag">家长沟通</span></div></div>' +
    '<div class="hc-act"><button class="btn btn-sm btn-light" data-act="go" data-page="settings" data-sec="teacher">换形象</button><button class="btn btn-sm btn-dark" data-act="go" data-page="ai">打开 AI 助手</button></div>'
  );
}

function scheduleCard(el) {
  clearTimeout(Cls.cardT);
  clearTimeout(Cls.hideT);
  Cls.cardT = setTimeout(function () {
    if (
      Cls.down ||
      Cls.picking ||
      Cls.mode === 'seat' ||
      Cls.mode === 'att' ||
      Cls.mode === 'points' ||
      $('#pop')
    )
      return;
    if (el.classList.contains('teacher'))
      UI.showCard(teacherCardHTML(), el.querySelector('.teacher-hit') || el);
    else {
      var st = stuById(el.getAttribute('data-sid'));
      if (st) UI.showCard(stuCardHTML(st), el.querySelector('.hit') || el);
    }
  }, 220);
}

function scheduleHide() {
  clearTimeout(Cls.cardT);
  clearTimeout(Cls.hideT);
  Cls.hideT = setTimeout(function () {
    UI.hideCard();
  }, 180);
}

/* ---------- 点击（按模式分发） ---------- */
function onSeatClick(seatEl, ev) {
  var key = seatEl.getAttribute('data-seat'),
    sid = seatEl.getAttribute('data-sid');
  var st = sid ? stuById(sid) : null;
  clearTimeout(Cls.cardT);
  UI.hideCard();
  if (Cls.mode === 'seat') {
    if (!Cls.pickedSeat) {
      if (st) {
        Cls.pickedSeat = key;
        drawScene();
      }
      return;
    }
    if (Cls.pickedSeat === key) {
      Cls.pickedSeat = null;
      drawScene();
      return;
    }
    moveSeat(Cls.pickedSeat, key);
    Cls.pickedSeat = null;
    return;
  }
  if (!st) {
    studentActions.openStudentForm(null, { seat: key });
    return;
  }
  if (Cls.mode === 'att') {
    var d = Cls.attDate;
    if (!S.attendance[d]) S.attendance[d] = {};
    var cur = S.attendance[d][sid] || null;
    var order = [null, 'leave', 'absent', 'late'];
    var nx = order[(order.indexOf(cur) + 1) % order.length];
    if (nx) S.attendance[d][sid] = nx;
    else delete S.attendance[d][sid];
    save();
    drawScene();
    renderDock();
    Cls.renderRail();
    return;
  }
  if (Cls.mode === 'points') {
    openPointPop(st, ev.clientX, ev.clientY);
    return;
  }
  studentActions.openStudent(sid, Cls.mode === 'grade' ? 'scores' : 'overview');
}

function openPointPop(st, x, y) {
  var pts = pointsOf(st.id);
  var h =
    '<div class="pop-title">' +
    stuAva(st, 26) +
    esc(st.name) +
    '<span class="muted" style="font-weight:400;margin-left:auto">当前 ' +
    (pts > 0 ? '+' : '') +
    pts +
    '</span></div><div class="chips">' +
    S.settings.reasons
      .map(function (r) {
        return (
          '<button class="' +
          (r.d > 0 ? 'plus' : 'minus') +
          '" data-act="pt-add" data-sid="' +
          st.id +
          '" data-d="' +
          r.d +
          '" data-r="' +
          esc(r.t) +
          '">' +
          esc(r.t) +
          ' ' +
          (r.d > 0 ? '+' : '') +
          r.d +
          '</button>'
        );
      })
      .join('') +
    '</div>' +
    '<div style="display:flex;gap:6px;margin-top:10px"><input class="inp" id="ptCustom" placeholder="自定义理由" style="height:30px;font-size:14px"><button class="btn btn-xs btn-dark" data-act="pt-custom" data-sid="' +
    st.id +
    '" data-d="1">+1</button><button class="btn btn-xs btn-light" data-act="pt-custom" data-sid="' +
    st.id +
    '" data-d="-1">-1</button></div>';
  UI.pop(h, x, y);
}

function addPoint(sid, d, r) {
  var st = stuById(sid);
  if (!st) return;
  S.points.unshift({ id: uid('p'), sid: sid, d: d, r: r, t: Date.now() });
  save();
  if (UI.page === 'class') {
    drawScene();
    Cls.renderRail();
    floatAt(st.seat, (d > 0 ? '+' : '') + d, d > 0 ? '#1d9a57' : '#e5483b');
  }
  return st;
}

/* ---------- 排座 ---------- */
function moveSeat(from, to) {
  if (from === to) return;
  var m = seatMap(),
    a = m[from],
    b = m[to];
  if (!a) return;
  snapshotSeats();
  a.seat = to;
  if (b) b.seat = from;
  autoGroups();
  save();
  drawScene();
}

function allSeats() {
  return seatKeys(S.settings.rows, columnCount(S.settings));
}

function snapshotSeats() {
  Cls.layoutUndo = { rows: S.settings.rows, pairs: S.settings.pairs, cols: S.settings.cols };
  Cls.seatUndo = S.students.map(function (s) {
    return [s.id, s.seat, s.group];
  });
}

function shuffleArr(a) {
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function placePairs(pairs) {
  // pairs: [[stuA, stuB|null], ...] 依次放进同桌位（先打乱双人桌顺序以免固定前后）
  S.students.forEach(function (s) {
    s.seat = null;
  });
  pairedSeats(S.settings.rows, columnCount(S.settings), pairs).forEach(function (entry) {
    entry[0].seat = entry[1];
  });
  autoGroups();
  save();
  drawScene();
}

/* ---------- 空闲小动画 ---------- */
function idleTick() {
  if (
    !S.settings.anim ||
    REDUCED ||
    document.hidden ||
    UI.page !== 'class' ||
    Cls.picking ||
    Cls.down
  )
    return;
  if ($('#pickCard') && $('#pickCard').innerHTML) return;
  var seats = $$('.scene-svg .seat.has:not(.ghost):not(.dim)');
  if (!seats.length) return;
  var el = seats[Math.floor(Math.random() * seats.length)];
  if (
    el.matches(':hover') ||
    el.classList.contains('turn') ||
    el.classList.contains('hand') ||
    el.classList.contains('sleep')
  )
    return;
  var acts = ['turn', 'turn', 'turn', 'hand', 'sleep'],
    a = acts[Math.floor(Math.random() * acts.length)];
  el.classList.add(a);
  setTimeout(
    function () {
      el.classList.remove(a);
    },
    a === 'sleep' ? 4200 : a === 'hand' ? 2400 : 1900
  );
  var t = $('.scene-svg .teacher');
  if (t) {
    var pu = t.querySelector('.t-pupil');
    if (pu) pu.style.transform = 'translateX(' + (Math.random() * 3 - 1.5).toFixed(1) + 'px)';
    if (Math.random() < 0.14 && !t.classList.contains('point')) {
      t.classList.add('point');
      setTimeout(function () {
        if (!($('#pickCard') && $('#pickCard').innerHTML)) t.classList.remove('point');
      }, 2600);
    }
  }
}

/* ---------- 底部模式栏 ---------- */
function renderDock() {
  var d = $('#dock');
  if (!d) return;
  var sub = '';
  if (Cls.mode === 'att') {
    var day = S.attendance[Cls.attDate] || {},
      c = { leave: 0, absent: 0, late: 0 };
    Object.keys(day).forEach(function (k) {
      if (stuById(k) && c[day[k]] !== undefined) c[day[k]]++;
    });
    var total = S.students.length,
      present = total - c.leave - c.absent;
    sub =
      '<div class="subbar"><input type="date" class="inp" value="' +
      Cls.attDate +
      '" data-chg="att-date" aria-label="考勤日期"><span>应到 <b class="num">' +
      total +
      '</b> · 实到 <b class="num">' +
      present +
      '</b></span>' +
      '<span class="muted">请假 ' +
      c.leave +
      ' · 缺勤 ' +
      c.absent +
      ' · 迟到 ' +
      c.late +
      '</span><span class="muted">点学生切换：出勤 → 请假 → 缺勤 → 迟到</span>' +
      '<button class="btn btn-sm btn-light" data-act="att-clear">全部出勤</button><button class="btn btn-sm btn-light" data-act="att-export">导出本月</button></div>';
  } else if (Cls.mode === 'points') {
    sub =
      '<div class="subbar"><span class="muted">点学生选择加分或扣分理由</span><button class="btn btn-sm btn-light" data-act="pt-all">全班 +1</button><button class="btn btn-sm btn-dark" data-act="pt-board">积分榜</button></div>';
  } else if (Cls.mode === 'grade') {
    var exs = examsSorted().reverse();
    if (!exs.length)
      sub =
        '<div class="subbar"><span class="muted">还没有考试成绩</span><button class="btn btn-sm btn-dark" data-act="go" data-page="scores">去录入成绩</button></div>';
    else {
      var cur = Cls.gradeExam || exs[0].id;
      sub =
        '<div class="subbar"><select class="sel" data-chg="grade-exam" aria-label="选择考试">' +
        exs
          .map(function (e) {
            return (
              '<option value="' +
              e.id +
              '"' +
              (e.id === cur ? ' selected' : '') +
              '>' +
              esc(e.name) +
              '</option>'
            );
          })
          .join('') +
        '</select>' +
        '<span class="legend-ramp">后' +
        CH.SEQ.map(function (c) {
          return '<i style="background:' + c + '"></i>';
        }).join('') +
        '前</span><span class="muted">桌面颜色越深，班级排名越靠前；↑↓ 表示进退 5 名以上</span>' +
        '<button class="btn btn-sm btn-light" data-act="go" data-page="analysis">完整分析</button></div>';
    }
  } else if (Cls.mode === 'seat') {
    sub =
      '<div class="subbar seat-tools"><label>行 <input class="inp" id="seatRows" aria-label="座位行数" type="number" min="1" max="12" step="1" value="' +
      S.settings.rows +
      '"></label><label>列 <input class="inp" id="seatCols" aria-label="座位列数" type="number" min="1" max="16" step="1" value="' +
      columnCount(S.settings) +
      '"></label><button class="btn btn-sm btn-light" data-act="seat-resize">应用行列</button><span class="muted">' +
      allSeats().length +
      ' 座 · ' +
      S.students.filter((s) => !s.seat).length +
      ' 人未排座</span><button class="btn btn-sm btn-light" data-act="seat-shuffle">' +
      ICON.shuffle +
      '随机打乱</button><button class="btn btn-sm btn-light" data-act="seat-mentor">优带弱同桌</button><button class="btn btn-sm btn-light" data-act="seat-gender">男女同桌</button><button class="btn btn-sm btn-ghost" data-act="seat-undo">撤销</button><button class="btn btn-sm btn-dark" data-act="seat-print">' +
      ICON.print +
      '打印座位表</button></div>';
  }
  d.innerHTML =
    sub +
    '<div class="seg">' +
    MODES.map(function (m) {
      return (
        '<button class="' +
        (m.id === Cls.mode ? 'on' : '') +
        '" data-act="cls-mode" data-mode="' +
        m.id +
        '">' +
        m.t +
        '</button>'
      );
    }).join('') +
    '</div>';
}
export function registerFeaturesClassroom(students) {
  studentActions = students;

  UI.act['pt-add'] = function (el) {
    addPoint(el.getAttribute('data-sid'), +el.getAttribute('data-d'), el.getAttribute('data-r'));
    UI.closePop();
  };

  UI.act['pt-custom'] = function (el) {
    var r = ($('#ptCustom') || {}).value;
    r = (r || '').trim() || (+el.getAttribute('data-d') > 0 ? '表现好' : '需改进');
    addPoint(el.getAttribute('data-sid'), +el.getAttribute('data-d'), r);
    UI.closePop();
  };

  UI.act['pt-quick'] = function (el) {
    var st = addPoint(el.getAttribute('data-sid'), +el.getAttribute('data-d'), '表扬');
    UI.hideCard();
    if (st) UI.toast(st.name + ' +1');
  };

  UI.act['pt-all'] = function () {
    var day = S.attendance[todayStr()] || {},
      n = 0,
      now = Date.now();
    S.students.forEach(function (s) {
      if (s.seat && day[s.id] !== 'leave' && day[s.id] !== 'absent') {
        S.points.unshift({ id: uid('p'), sid: s.id, d: 1, r: '全班表现好', t: now });
        n++;
      }
    });
    save();
    drawScene();
    Cls.renderRail();
    S.students.forEach(function (s) {
      if (s.seat && day[s.id] !== 'leave' && day[s.id] !== 'absent')
        floatAt(s.seat, '+1', '#1d9a57');
    });
    UI.toast('全班 ' + n + ' 人各 +1');
  };

  UI.act['pt-board'] = function () {
    var list = S.students
      .map(function (s) {
        return { s: s, p: pointsOf(s.id) };
      })
      .sort(function (a, b) {
        return b.p - a.p;
      });
    var gs = {};
    S.students.forEach(function (s) {
      if (s.seat) {
        var g = s.group || 0;
        gs[g] = (gs[g] || 0) + pointsOf(s.id);
      }
    });
    var gl = Object.keys(gs).sort(function (a, b) {
      return gs[b] - gs[a];
    });
    var groupHtml = gl.length
      ? '<div class="flabel" style="margin-bottom:8px">小组积分</div><div class="tags" style="margin-bottom:14px">' +
        gl
          .map(function (g, i) {
            return (
              '<span class="tag gray" style="height:28px;padding:0 10px;gap:6px"><i style="width:8px;height:8px;border-radius:50%;background:' +
              ART.groupColor(+g) +
              ';display:inline-block"></i>' +
              groupName(+g) +
              ' <b class="num">' +
              (gs[g] > 0 ? '+' : '') +
              gs[g] +
              '</b></span>'
            );
          })
          .join('') +
        '</div>'
      : '';
    UI.modal({
      title: '积分榜',
      body:
        groupHtml +
        '<div class="tbl-wrap" style="box-shadow:none;max-height:56vh"><table class="tbl"><thead><tr><th>名次</th><th>姓名</th><th class="r">积分</th><th class="r">加分次数</th><th class="r">扣分次数</th></tr></thead><tbody>' +
        list
          .map(function (x, i) {
            var plus = S.points.filter(function (p) {
                return p.sid === x.s.id && p.d > 0;
              }).length,
              minus = S.points.filter(function (p) {
                return p.sid === x.s.id && p.d < 0;
              }).length;
            return (
              '<tr class="click" data-act="open-stu" data-sid="' +
              x.s.id +
              '"><td class="num">' +
              (i + 1) +
              '</td><td><div class="nm">' +
              stuAva(x.s, 24) +
              esc(x.s.name) +
              '</div></td><td class="r num"><b>' +
              (x.p > 0 ? '+' : '') +
              x.p +
              '</b></td><td class="r num">' +
              plus +
              '</td><td class="r num">' +
              minus +
              '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>',
      foot: '<button class="btn btn-light" data-act="pt-export">导出 CSV</button><button class="btn btn-dark" data-act="modal-close">好的</button>'
    });
  };

  UI.act['pt-export'] = function () {
    var rows = [['日期', '姓名', '学号', '分值', '理由']];
    S.points.forEach(function (p) {
      var s = stuById(p.sid);
      if (s) rows.push([fmtTime(p.t), s.name, s.no, p.d, p.r]);
    });
    downloadFile(S.settings.className + '-点评记录.csv', toCSV(rows), 'text/csv;charset=utf-8');
  };

  UI.act['seat-resize'] = function () {
    const rows = Number($('#seatRows').value),
      cols = Number($('#seatCols').value);
    if (
      !Number.isInteger(rows) ||
      rows < 1 ||
      rows > 12 ||
      !Number.isInteger(cols) ||
      cols < 1 ||
      cols > 16
    ) {
      UI.toast('请输入 1–12 行、1–16 列的整数');
      return;
    }
    snapshotSeats();
    const waiting = resizeSeating(S, rows, cols);
    Cls.pickedSeat = null;
    Cls.view.fit = true;
    save();
    renderDock();
    drawScene();
    UI.toast(waiting ? '已调整，' + waiting + ' 人未排座；增加座位后会自动安排' : '已调整座位布局');
  };

  UI.act['seat-shuffle'] = function () {
    snapshotSeats();
    var list = shuffleArr(S.students.slice()),
      seats = allSeats();
    S.students.forEach(function (s) {
      s.seat = null;
    });
    list.forEach(function (s, i) {
      s.seat = seats[i] || null;
    });
    autoGroups();
    save();
    drawScene();
    UI.toast('已随机打乱座位');
  };

  UI.act['seat-mentor'] = function () {
    var ex = latestExam();
    if (!ex) {
      UI.toast('还没有考试成绩，先去录入一次吧');
      return;
    }
    snapshotSeats();
    var rm = rankMap(ex);
    var list = S.students.slice().sort(function (a, b) {
      return (rm[a.id] ? rm[a.id].rank : 999) - (rm[b.id] ? rm[b.id].rank : 999);
    });
    var pairs = [];
    while (list.length) {
      var a = list.shift(),
        b = list.length ? list.pop() : null;
      pairs.push([a, b]);
    }
    placePairs(shuffleArr(pairs));
    UI.toast('已按「' + ex.name + '」排名：前后搭配做同桌');
  };

  UI.act['seat-gender'] = function () {
    snapshotSeats();
    var boys = shuffleArr(
        S.students.filter(function (s) {
          return s.gender !== 'F';
        })
      ),
      girls = shuffleArr(
        S.students.filter(function (s) {
          return s.gender === 'F';
        })
      );
    var pairs = [];
    while (boys.length && girls.length)
      pairs.push(Math.random() < 0.5 ? [boys.pop(), girls.pop()] : [girls.pop(), boys.pop()]);
    var rest = boys.concat(girls);
    while (rest.length) pairs.push([rest.shift(), rest.length ? rest.shift() : null]);
    placePairs(shuffleArr(pairs));
    UI.toast('已安排男女同桌');
  };

  UI.act['seat-undo'] = function () {
    if (!Cls.seatUndo) {
      UI.toast('没有可以撤销的调整');
      return;
    }
    var m = {};
    Cls.seatUndo.forEach(function (x) {
      m[x[0]] = x;
    });
    S.students.forEach(function (s) {
      if (m[s.id]) {
        s.seat = m[s.id][1];
        s.group = m[s.id][2];
      }
    });
    if (Cls.layoutUndo) {
      Object.assign(S.settings, Cls.layoutUndo);
      if (Cls.layoutUndo.cols === undefined) delete S.settings.cols;
    }
    Cls.seatUndo = null;
    Cls.layoutUndo = null;
    Cls.view.fit = true;
    renderDock();
    save();
    drawScene();
    UI.toast('已撤销');
  };

  UI.act['seat-print'] = function () {
    var m = seatMap(),
      cols = columnCount(S.settings),
      h = '';
    h +=
      '<!doctype html><html><head><meta charset="utf-8"><title>' +
      esc(S.settings.className) +
      ' 座位表</title><style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;padding:24px;color:#171717}h1{font-size:20px;text-align:center;margin:0 0 4px}p{text-align:center;color:#777;margin:0 0 18px;font-size:12px}.pod{width:40%;margin:0 auto 18px;text-align:center;border:1.5px solid #171717;border-radius:8px;padding:8px;font-weight:600}table{border-collapse:separate;border-spacing:6px;margin:0 auto}td{width:84px;height:46px;border:1px solid #cfcfcc;border-radius:6px;text-align:center;font-size:14px}td.gap{border:0;width:18px}td small{display:block;color:#999;font-size:12px}td.e{color:#ccc}@media print{body{padding:0}}</style></head><body>';
    h +=
      '<h1>' +
      esc(S.settings.className) +
      ' 座位表</h1><p>' +
      esc(S.settings.school || '') +
      ' · ' +
      todayStr() +
      ' · 讲台在上方</p><div class="pod">讲 台</div><table>';
    for (var r = 0; r < S.settings.rows; r++) {
      h += '<tr>';
      for (var c = 0; c < cols; c++) {
        var st = m[r + '-' + c];
        h += st
          ? '<td>' + esc(st.name) + '<small>' + esc(st.no || '') + '</small></td>'
          : '<td class="e">空</td>';
        if (c % 2 === 1 && c < cols - 1) h += '<td class="gap"></td>';
      }
      h += '</tr>';
    }
    h += '</table><script>setTimeout(function(){window.print()},300)<\/script></body></html>';
    var w = window.open('', '_blank');
    if (!w) {
      UI.toast('浏览器拦截了新窗口，请允许弹出窗口');
      return;
    }
    w.document.write(h);
    w.document.close();
  };

  /* ---------- 随机点名 ---------- */
  UI.act['pick'] = function () {
    if (Cls.picking) return;
    UI.act['pick-close']();
    var day = S.attendance[todayStr()] || {};
    var pool = S.students.filter(function (s) {
      return s.seat && day[s.id] !== 'leave' && day[s.id] !== 'absent';
    });
    if (!pool.length) {
      UI.toast('教室里还没有同学');
      return;
    }
    var fresh = pool.filter(function (s) {
      return Cls.recentPicks.indexOf(s.id) < 0;
    });
    if (!fresh.length) {
      Cls.recentPicks = [];
      fresh = pool;
    }
    var final = fresh[Math.floor(Math.random() * fresh.length)];
    Cls.recentPicks.push(final.id);
    if (Cls.recentPicks.length > Math.min(8, pool.length - 1)) Cls.recentPicks.shift();
    Cls.picking = true;
    UI.hideCard();
    var stage = $('#stage');
    stage.classList.add('picking');
    var steps = REDUCED ? 1 : 16,
      i = 0,
      delay = 55,
      last = null,
      token = (Cls.pickToken = (Cls.pickToken || 0) + 1);
    function alive() {
      return Cls.pickToken === token && UI.page === 'class' && $('#pickCard');
    }
    function step() {
      if (!alive()) {
        if (Cls.pickToken === token) Cls.picking = false;
        return;
      }
      var cand = i < steps - 1 ? pool[Math.floor(Math.random() * pool.length)] : final;
      if (last) last.classList.remove('picked');
      last = seatEl(cand.seat);
      if (last) last.classList.add('picked');
      i++;
      if (i < steps) {
        delay *= 1.16;
        setTimeout(step, delay);
      } else
        setTimeout(function () {
          done();
        }, 120);
    }
    function done() {
      if (!alive()) {
        if (Cls.pickToken === token) Cls.picking = false;
        return;
      }
      Cls.picking = false;
      var el = seatEl(final.seat);
      if (el) el.classList.add('turn', 'hand', 'picked');
      var tch = $('.scene-svg .teacher');
      if (tch) tch.classList.add('point');
      $('#pickCard').innerHTML =
        '<div class="pick-card">' +
        stuAva(final, 60) +
        '<div><div class="muted" style="font-size:12px">请回答问题</div><div class="nm">' +
        esc(final.name) +
        '</div><div class="muted" style="font-size:12px">' +
        esc(final.no || '') +
        (final.role ? ' · ' + esc(final.role) : '') +
        '</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;margin-left:10px"><button class="btn btn-sm btn-dark" data-act="pick-good" data-sid="' +
        final.id +
        '">回答得好 +1</button><button class="btn btn-sm btn-light" data-act="pick">' +
        ICON.dice +
        '再抽一个</button></div>' +
        '<button class="modal-x" data-act="pick-close" style="align-self:flex-start" aria-label="关闭">' +
        ICON.x +
        '</button></div>';
    }
    step();
  };

  UI.act['pick-close'] = function () {
    if (Cls.picking) {
      Cls.pickToken = (Cls.pickToken || 0) + 1;
      Cls.picking = false;
    }
    var pc = $('#pickCard');
    if (pc) pc.innerHTML = '';
    var st = $('#stage');
    if (st) st.classList.remove('picking');
    $$('.scene-svg .seat.picked').forEach(function (e) {
      e.classList.remove('picked', 'turn', 'hand');
    });
    var t = $('.scene-svg .teacher');
    if (t) t.classList.remove('point');
  };

  UI.act['pick-good'] = function (el) {
    var sid = el.getAttribute('data-sid');
    UI.act['pick-close']();
    addPoint(sid, 1, '回答问题');
  };

  UI.act['cls-mode'] = function (el) {
    const nextMode = el.getAttribute('data-mode');
    if (Cls.mode === 'seat' || nextMode === 'seat') Cls.view.fit = true;
    Cls.mode = nextMode;
    Cls.pickedSeat = null;
    if (Cls.mode === 'att' && !Cls.attDate) Cls.attDate = todayStr();
    UI.act['pick-close']();
    UI.hideCard();
    UI.closePop();
    renderDock();
    drawScene();
  };

  UI.chg['att-date'] = function (el) {
    Cls.attDate = el.value || todayStr();
    renderDock();
    drawScene();
  };

  UI.chg['grade-exam'] = function (el) {
    Cls.gradeExam = el.value;
    drawScene();
  };

  UI.act['att-clear'] = function () {
    S.attendance[Cls.attDate] = {};
    save();
    renderDock();
    drawScene();
    Cls.renderRail();
    UI.toast('已标记为全部出勤');
  };

  UI.act['att-export'] = function () {
    var d = parseDate(Cls.attDate) || new Date(),
      ym = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
    var days = Object.keys(S.attendance)
      .filter(function (k) {
        return k.indexOf(ym) === 0;
      })
      .sort();
    var rows = [
      ['学号', '姓名']
        .concat(
          days.map(function (k) {
            return k.slice(5);
          })
        )
        .concat(['请假', '缺勤', '迟到'])
    ];
    studentsByNo().forEach(function (s) {
      var c = { leave: 0, absent: 0, late: 0 };
      var r = [s.no, s.name].concat(
        days.map(function (k) {
          var v = S.attendance[k][s.id];
          if (v) c[v]++;
          return v ? ATT[v].t : '';
        })
      );
      rows.push(r.concat([c.leave, c.absent, c.late]));
    });
    downloadFile(
      S.settings.className + '-考勤-' + ym + '.csv',
      toCSV(rows),
      'text/csv;charset=utf-8'
    );
  };

  UI.act['zoom-in'] = function () {
    var s = $('#stage');
    zoomAt(1.2, s.clientWidth / 2, s.clientHeight / 2);
  };

  UI.act['zoom-out'] = function () {
    var s = $('#stage');
    zoomAt(1 / 1.2, s.clientWidth / 2, s.clientHeight / 2);
  };

  UI.act['zoom-fit'] = function () {
    fitView();
  };

  UI.act['demo-clear'] = function () {
    UI.modal({
      title: '开始使用我的班级',
      body:
        '<p style="margin:0 0 14px;color:var(--ink2);line-height:1.7">会清空示例学生、成绩和记录，保留你的形象和 AI 设置。</p>' +
        '<div class="row2"><div class="field"><label>班级名称<span class="req">*</span></label><input class="inp" id="dcName" placeholder="例如：初二（3）班"></div>' +
        '<div class="field"><label>学段</label><select class="sel" id="dcStage"><option>小学</option><option selected>初中</option><option>高中</option></select></div></div>' +
        '<div class="field"><label>学校</label><input class="inp" id="dcSchool" placeholder="选填"></div>',
      foot: '<button class="btn btn-light" data-act="modal-close">取消</button><button class="btn btn-dark" data-act="demo-clear-ok">清空并开始</button>'
    });
  };

  UI.act['demo-clear-ok'] = function () {
    var name = $('#dcName').value.trim();
    if (!name) {
      $('#dcName').focus();
      UI.toast('请填写班级名称');
      return;
    }
    var keep = { teacher: S.settings.teacher, ai: S.settings.ai };
    var stage = $('#dcStage').value,
      school = $('#dcSchool').value.trim();
    replaceState(defaultState());
    S.settings.teacher = keep.teacher;
    S.settings.ai = keep.ai;
    S.settings.className = name;
    S.settings.school = school;
    S.settings.stage = stage;
    S.settings.onboarded = true;
    S.settings.subjects = SUBJECT_PRESETS[stage]
      .slice(0, stage === '小学' ? 3 : 6)
      .map(function (x) {
        return { name: x[0], full: x[1] };
      });
    save(true);
    UI.closeModal();
    UI.shell();
    UI.go('class');
    UI.toast('示例数据已清空');
  };

  /* ---------- 页面 ---------- */
  UI.register('class', {
    rail: function (el) {
      Cls.renderRail(el);
    },
    render: function (main) {
      var wk = weekNo();
      if (!Cls.attDate) Cls.attDate = todayStr();
      main.innerHTML =
        '<div class="class-page">' +
        '<section class="room-heading" aria-label="班级信息与教室工具"><div class="room-summary"><h1>' +
        esc(S.settings.className) +
        '</h1><p>' +
        esc(S.settings.school || '欢迎回到你的班级') +
        (wk ? ' · 第 ' + wk + ' 周' : '') +
        ' · ' +
        S.students.length +
        ' 位同学</p>' +
        (S.demo
          ? '<div class="demo-bar">示例班级<button data-act="demo-clear">开始录入我的班级 ' +
            ICON.back +
            '</button></div>'
          : '') +
        '</div><div class="room-heading-action"><button class="btn btn-dark" data-act="pick">' +
        ICON.dice +
        '随机点名</button><button class="btn btn-light btn-icon rail-toggle" data-act="toggle-rail" title="班级概况" aria-label="班级概况">' +
        ICON.side +
        '</button><div class="zoom"><button data-act="zoom-out" title="缩小" aria-label="缩小">' +
        ICON.zout +
        '</button><button class="zoom-fit" data-act="zoom-fit" title="恢复默认大小">适应</button><button data-act="zoom-in" title="放大" aria-label="放大">' +
        ICON.zin +
        '</button></div></div></section>' +
        '<div class="stage" id="stage"><div class="stage-inner" id="stageInner"></div></div>' +
        '<div class="dock" id="dock"></div><div id="pickCard"></div>' +
        '<div class="empty-class hide" id="emptyClass">' +
        ART.teacherAvatar(S.settings.teacher, 64) +
        '<div><div style="font-weight:700;font-size:14px">教室还空着</div><div class="muted" style="font-size:14px;margin:2px 0 10px">点任意一个座位添加学生，或者从 Excel 一次导入整班名单</div>' +
        '<div style="display:flex;gap:8px"><button class="btn btn-sm btn-dark" data-act="stu-add">' +
        ICON.userplus +
        '添加学生</button><button class="btn btn-sm btn-light" data-act="stu-import">' +
        ICON.up +
        '批量导入</button></div></div></div></div>';
    },
    mount: function () {
      renderDock();
      drawScene();
      var stage = $('#stage');
      stage.addEventListener(
        'wheel',
        function (e) {
          e.preventDefault();
          var r = stage.getBoundingClientRect();
          if (e.ctrlKey || e.metaKey)
            zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
          else {
            Cls.view.x -= e.deltaX;
            Cls.view.y -= e.deltaY;
            Cls.view.fit = false;
            applyView();
          }
        },
        { passive: false }
      );
      stage.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        var seat = e.target.closest('.seat'),
          tch = e.target.closest('.teacher'),
          sact = e.target.closest('[data-sact]');
        Cls.down = {
          x: e.clientX,
          y: e.clientY,
          seat: seat,
          tch: tch,
          sact: sact,
          moved: false,
          vx: Cls.view.x,
          vy: Cls.view.y,
          kind: Cls.mode === 'seat' && seat && seat.classList.contains('has') ? 'drag' : 'click',
          id: e.pointerId
        };
      });
      stage.addEventListener('pointermove', function (e) {
        var d = Cls.down;
        if (!d) return;
        var dx = e.clientX - d.x,
          dy = e.clientY - d.y;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) > 5) {
          d.moved = true;
          UI.hideCard();
          clearTimeout(Cls.cardT);
          try {
            stage.setPointerCapture(d.id);
          } catch (er) {}
          if (d.kind === 'drag') {
            var st = stuById(d.seat.getAttribute('data-sid'));
            var g = document.createElement('div');
            g.id = 'dragGhost';
            g.style.cssText =
              'position:fixed;z-index:70;pointer-events:none;border-radius:50%;box-shadow:0 10px 30px rgba(0,0,0,.18);background:#fff';
            g.innerHTML = stuAva(st, 54);
            document.body.appendChild(g);
            d.seat.classList.add('dragging');
          } else stage.classList.add('panning');
        }
        if (!d.moved) return;
        if (d.kind === 'drag') {
          var gh = $('#dragGhost');
          if (gh) {
            gh.style.left = e.clientX - 27 + 'px';
            gh.style.top = e.clientY - 27 + 'px';
          }
          var under = document.elementFromPoint(e.clientX, e.clientY);
          var tgt = under && under.closest ? under.closest('.seat') : null;
          $$('.scene-svg .seat.drop-on').forEach(function (x) {
            if (x !== tgt) x.classList.remove('drop-on');
          });
          if (tgt && tgt !== d.seat) tgt.classList.add('drop-on');
        } else {
          Cls.view.x = d.vx + dx;
          Cls.view.y = d.vy + dy;
          Cls.view.fit = false;
          applyView();
        }
      });
      function end(e) {
        var d = Cls.down;
        if (!d) return;
        Cls.down = null;
        stage.classList.remove('panning');
        try {
          stage.releasePointerCapture(d.id);
        } catch (er) {}
        if (d.kind === 'drag' && d.moved) {
          var gh = $('#dragGhost');
          if (gh) gh.remove();
          var tgt = $('.scene-svg .seat.drop-on');
          if (d.seat) d.seat.classList.remove('dragging');
          if (tgt) moveSeat(d.seat.getAttribute('data-seat'), tgt.getAttribute('data-seat'));
          return;
        }
        if (d.moved || e.type === 'pointercancel') return;
        if (d.seat) onSeatClick(d.seat, e);
        else if (d.tch) {
          var t = d.tch;
          UI.showCard(teacherCardHTML(), t.querySelector('.teacher-hit') || t);
        } else if (d.sact) {
          var fn = UI.act[d.sact.getAttribute('data-sact')];
          if (fn) fn(d.sact, e);
        }
      }
      stage.addEventListener('pointerup', end);
      stage.addEventListener('pointercancel', end);
      stage.addEventListener('mouseover', function (e) {
        var el = e.target.closest('.seat.has, .teacher');
        if (!el) return;
        if (el === Cls.hoverEl) {
          clearTimeout(Cls.hideT);
          return;
        }
        Cls.hoverEl = el;
        scheduleCard(el);
      });
      stage.addEventListener('mouseout', function (e) {
        var el = e.target.closest('.seat.has, .teacher');
        if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) {
          Cls.hoverEl = null;
          scheduleHide();
        }
      });
      var card = $('#hcard');
      card.onmouseenter = function () {
        clearTimeout(Cls.hideT);
      };
      card.onmouseleave = function () {
        scheduleHide();
      };
      Cls.idle = setInterval(idleTick, 2300);
      Cls.clock = setInterval(tickClock, 20000);
    },
    unmount: function () {
      clearInterval(Cls.idle);
      clearInterval(Cls.clock);
      Cls.down = null;
      Cls.picking = false;
      Cls.pickToken = (Cls.pickToken || 0) + 1;
      var g = $('#dragGhost');
      if (g) g.remove();
    },
    resize: function () {
      relayout();
    }
  });

  /* ---------- 右侧栏 ---------- */
  Cls.renderRail = function (el) {
    el = el || $('#rail');
    if (!el || UI.page !== 'class') return;
    var d = new Date(),
      st = S.settings,
      wk = weekNo();
    var day = S.attendance[todayStr()] || {},
      c = { leave: 0, absent: 0, late: 0 };
    Object.keys(day).forEach(function (k) {
      if (stuById(k) && c[day[k]] !== undefined) c[day[k]]++;
    });
    var total = S.students.length,
      present = total - c.leave - c.absent;
    var boys = S.students.filter(function (s) {
      return s.gender !== 'F';
    }).length;
    var h =
      '<header class="rail-heading"><strong>班级概况</strong><button class="btn btn-light" data-act="toggle-rail" aria-label="收起班级概况">收起 ×</button></header>';
    h +=
      '<div class="rail-sec"><div class="rail-k">今天</div><div class="rail-date">' +
      (d.getMonth() + 1) +
      '月' +
      d.getDate() +
      '日 星期' +
      WEEK[d.getDay()] +
      '</div>' +
      '<div class="muted" style="font-size:12px;margin-top:2px">' +
      esc(st.term || '') +
      (wk ? (st.term ? ' · ' : '') + '第 ' + wk + ' 周' : '') +
      '</div>' +
      '<div class="trio"><div><b>' +
      total +
      '</b><span>在籍</span></div><div><b>' +
      boys +
      '</b><span>男生</span></div><div><b>' +
      (total - boys) +
      '</b><span>女生</span></div></div></div>';
    // 出勤
    var segs = total
      ? [
          ['#171717', present - c.late],
          ['#2f7ff0', c.late],
          ['#e89a0c', c.leave],
          ['#e5483b', c.absent]
        ]
      : [];
    h +=
      '<div class="rail-sec"><div class="rail-k">今日出勤<button data-act="cls-mode" data-mode="att">去点名</button></div><div class="rail-big">' +
      present +
      '<small>/ ' +
      total +
      ' 人</small></div>' +
      '<div class="attbar">' +
      segs
        .filter(function (s) {
          return s[1] > 0;
        })
        .map(function (s) {
          return '<i style="background:' + s[0] + ';flex:' + s[1] + '"></i>';
        })
        .join('') +
      '</div>' +
      '<div class="muted" style="font-size:12px">请假 ' +
      c.leave +
      ' · 缺勤 ' +
      c.absent +
      ' · 迟到 ' +
      c.late +
      '</div>';
    var off = Object.keys(day).map(stuById).filter(Boolean);
    if (off.length)
      h +=
        '<div class="mini-list">' +
        off
          .slice(0, 4)
          .map(function (s) {
            return (
              '<button class="mini-item" data-act="open-stu" data-sid="' +
              s.id +
              '">' +
              stuAva(s, 24) +
              '<span class="grow">' +
              esc(s.name) +
              '</span><span class="tag ' +
              ATT[day[s.id]].tone +
              '">' +
              ATT[day[s.id]].t +
              '</span></button>'
            );
          })
          .join('') +
        '</div>';
    h += '</div>';
    // 生日
    var bds = S.students
      .map(function (s) {
        return { s: s, d: daysToBirthday(s) };
      })
      .filter(function (x) {
        return x.d !== null && x.d <= 7;
      })
      .sort(function (a, b) {
        return a.d - b.d;
      });
    h += '<div class="rail-sec"><div class="rail-k">近 7 天生日</div>';
    if (bds.length)
      h +=
        '<div class="mini-list">' +
        bds
          .slice(0, 5)
          .map(function (x) {
            var ag = age(x.s);
            var nextAge = x.d === 0 ? ag : ag + 1;
            return (
              '<div class="mini-item">' +
              stuAva(x.s, 28) +
              '<span class="grow"><b style="font-weight:600">' +
              esc(x.s.name) +
              '</b><br><span class="muted" style="font-size:12px">' +
              (x.d === 0
                ? '今天'
                : x.d === 1
                  ? '明天'
                  : fmtMD(x.s.birthday.replace(/^\d+/, d.getFullYear())) + ' · ' + x.d + ' 天后') +
              (nextAge ? ' · ' + nextAge + ' 岁' : '') +
              '</span></span>' +
              '<button class="btn btn-xs btn-light" data-act="ai-tpl" data-tpl="birthday" data-sid="' +
              x.s.id +
              '" title="让 AI 写一段生日祝福">' +
              ICON.cake +
              '祝福</button></div>'
            );
          })
          .join('') +
        '</div>';
    else
      h += '<div class="muted" style="font-size:14px;margin-top:4px">近 7 天没有同学过生日</div>';
    h += '</div>';
    // 最近考试
    var lat = latestExam();
    h +=
      '<div class="rail-sec"><div class="rail-k">最近考试<button data-act="go" data-page="analysis">查看分析</button></div>';
    if (lat) {
      var es = examStats(lat);
      var trend = examsSorted().map(function (e) {
        var x = examStats(e);
        return x.rate === undefined ? null : x.rate * 100;
      });
      h +=
        '<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:8px"><div><div style="font-weight:600">' +
        esc(lat.name) +
        '</div><div class="rail-big">' +
        fmtNum(es.avg, 1) +
        '<small>/ ' +
        es.full +
        ' 平均</small></div>' +
        '<div class="muted" style="font-size:12px">及格率 ' +
        pct(es.pass) +
        ' · 优秀率 ' +
        pct(es.good) +
        '</div></div>' +
        '<div title="历次平均得分率">' +
        CH.spark(trend, 92, 40, CH.C.s1) +
        '</div></div>';
    } else
      h +=
        '<div class="muted" style="font-size:14px;margin-top:4px">还没有成绩，<a href="#/scores" data-act="go" data-page="scores">去录入</a></div>';
    h += '</div>';
    // 待办
    h +=
      '<div class="rail-sec"><div class="rail-k">待办</div>' +
      S.todos
        .map(function (t) {
          return (
            '<label class="todo' +
            (t.done ? ' done' : '') +
            '"><input type="checkbox" data-chg="todo-done" data-id="' +
            t.id +
            '"' +
            (t.done ? ' checked' : '') +
            '><span>' +
            esc(t.text) +
            '</span><button class="x" data-act="todo-del" data-id="' +
            t.id +
            '" aria-label="删除">×</button></label>'
          );
        })
        .join('') +
      '<div class="todo-add"><input class="inp" id="todoNew" placeholder="添加一件要做的事" data-key="todo-add"><button class="btn btn-sm btn-dark btn-icon" data-act="todo-add" aria-label="添加" style="width:32px;height:32px">' +
      ICON.plus +
      '</button></div></div>';
    // 动态
    var feed = [];
    S.points.slice(0, 12).forEach(function (p) {
      var s = stuById(p.sid);
      if (s)
        feed.push({
          t: p.t,
          h:
            '<b>' +
            esc(s.name) +
            '</b> <span class="pt ' +
            (p.d > 0 ? 'up' : 'dn') +
            '">' +
            (p.d > 0 ? '+' : '') +
            p.d +
            '</span> ' +
            esc(p.r)
        });
    });
    S.records.forEach(function (r) {
      var s = stuById(r.sid);
      var dt = parseDate(r.date);
      if (s && dt)
        feed.push({
          t: dt.getTime() + 43200000,
          h: '<b>' + esc(s.name) + '</b> ' + esc(r.type) + '：' + esc(r.text)
        });
    });
    feed.sort(function (a, b) {
      return b.t - a.t;
    });
    h +=
      '<div class="rail-sec"><div class="rail-k">班级动态</div><div class="feed">' +
      (feed.length
        ? feed
            .slice(0, 6)
            .map(function (f) {
              var dt = new Date(f.t);
              return (
                '<div class="feed-item"><span class="d">' +
                pad2(dt.getMonth() + 1) +
                '-' +
                pad2(dt.getDate()) +
                '</span><span>' +
                f.h +
                '</span></div>'
              );
            })
            .join('')
        : '<div class="muted" style="font-size:14px">切到「点评」给同学加分，动态会出现在这里</div>') +
      '</div></div>';

    el.innerHTML = h;
  };

  UI.chg['todo-done'] = function (el) {
    var t = S.todos.filter(function (x) {
      return x.id === el.getAttribute('data-id');
    })[0];
    if (t) {
      t.done = el.checked;
      save();
      Cls.renderRail();
    }
  };

  UI.act['todo-del'] = function (el, e) {
    e.preventDefault();
    S.todos = S.todos.filter(function (x) {
      return x.id !== el.getAttribute('data-id');
    });
    save();
    Cls.renderRail();
  };

  UI.act['todo-add'] = function () {
    var i = $('#todoNew');
    var v = i.value.trim();
    if (!v) {
      i.focus();
      return;
    }
    S.todos.push({ id: uid('t'), text: v, done: false });
    save();
    Cls.renderRail();
    setTimeout(function () {
      var n = $('#todoNew');
      if (n) n.focus();
    }, 0);
  };

  UI.key['todo-add'] = function (el, e) {
    if (e.key === 'Enter' && !e.isComposing) UI.act['todo-add']();
  };
}

export { Cls, allSeats, autoGroups, drawScene, groupName, renderDock, seatText };
