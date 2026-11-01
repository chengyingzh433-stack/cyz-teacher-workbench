// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { S } from '../core/state.js';
import { $, $$, clamp, esc, WEEK } from '../core/utils.js';
import { ICON } from './icons.js';
import { ART } from '../art/scene.js';

var UI = {
  page: 'class',
  pages: {},
  act: {},
  inp: {},
  chg: {},
  charts: [],
  register: function (name, def) {
    this.pages[name] = def;
  },

  /* ---------- 外壳 ---------- */
  shell: function () {
    var t = S.settings.teacher;
    var now = new Date();
    var h =
      '<aside class="side" aria-label="主导航">' +
      '<div class="brand">' +
      brandMark() +
      '<div><div class="brand-name">cyz的教师工作台</div></div></div>' +
      '<button class="class-switch" data-act="go" data-page="settings" data-sec="class"><span class="class-switch-icon">' +
      ICON.room +
      '</span><span><strong class="brand-sub">' +
      esc(S.settings.className) +
      '</strong></span><span class="switch-arrow">⌄</span></button>' +
      '<div class="search">' +
      ICON.search +
      '<input id="gsearch" aria-label="搜索学生姓名或学号" placeholder="搜索学生姓名 / 学号" autocomplete="off" data-inp="gsearch" data-key="gsearch"><div id="gsearchPop"></div></div>' +
      '<nav class="nav" aria-label="工作台页面">' +
      navItem('class', ICON.room, '教室') +
      navItem('students', ICON.users, '学生档案', S.students.length) +
      navItem('scores', ICON.edit, '成绩录入') +
      navItem('analysis', ICON.chart, '成绩分析') +
      '</nav><nav class="nav">' +
      navItem('ai', ICON.spark, 'AI 助手') +
      '</nav>' +
      '<div class="nav-label recent-label">最近对话</div><div class="recent" id="recentChats"></div>' +
      '<div class="side-foot"><nav class="nav">' +
      navItem('settings', ICON.gear, '设置') +
      '</nav>' +
      '<button class="me" aria-label="教师形象与设置" title="教师形象与设置" data-act="go" data-page="settings" data-sec="teacher">' +
      ART.teacherAvatar(t, 36) +
      '<div><div class="me-name">' +
      esc(t.name) +
      '</div><div class="me-sub">班主任' +
      (t.subject ? ' · ' + esc(t.subject) : '') +
      '</div></div>' +
      ICON.gear +
      '</button>' +
      '</div></aside>' +
      '<header class="worktop"><div class="breadcrumb"><strong id="currentPageLabel">教室</strong></div>' +
      '<div class="worktop-actions"><time class="worktop-date">' +
      (now.getMonth() + 1) +
      '月' +
      now.getDate() +
      '日 · 星期' +
      WEEK[now.getDay()] +
      '</time>' +
      '<button class="btn btn-light btn-sm backup-top" data-act="backup">' +
      ICON.down +
      '备份</button><button class="btn btn-light btn-sm fs-global" data-act="fullscreen" id="fsBtn"></button></div></header>' +
      '<main class="main" id="main"></main><aside class="rail" id="rail" aria-label="班级概况"></aside>';
    $('#app').innerHTML = h;
    updateFsBtn();
    UI.renderRecent();
  },
  renderRecent: function () {
    var el = $('#recentChats');
    if (!el) return;
    var list = S.chats.slice(0, 6);
    var heading = $('.recent-label');
    if (heading) heading.hidden = !list.length;
    el.innerHTML = list.length
      ? list
          .map(function (c) {
            return (
              '<button class="nav-chat" data-act="open-chat" data-id="' +
              c.id +
              '" title="' +
              esc(c.title) +
              '">' +
              esc(c.title) +
              '</button>'
            );
          })
          .join('')
      : '';
  },
  refreshSide: function () {
    var bn = $('.brand-sub');
    if (bn) bn.textContent = S.settings.className;
    var cnt = $('.nav a[data-page="students"] .cnt');
    if (cnt) cnt.textContent = S.students.length;
    var me = $('.me');
    if (me) {
      var t = S.settings.teacher;
      me.innerHTML =
        ART.teacherAvatar(t, 32) +
        '<div><div class="me-name">' +
        esc(t.name) +
        '</div><div class="me-sub">班主任' +
        (t.subject ? ' · ' + esc(t.subject) : '') +
        '</div></div>';
    }
    var bm = $('.brand-mark');
    if (bm) bm.outerHTML = brandMark();
    UI.renderRecent();
  },

  go: function (page, opts) {
    var prev = UI.pages[UI.page];
    if (prev && prev.unmount) prev.unmount();
    UI.hideCard();
    UI.closePop();
    UI.page = page;
    UI.opts = opts || {};
    var label = $('#currentPageLabel');
    if (label)
      label.textContent =
        {
          class: '教室',
          students: '学生档案',
          scores: '成绩录入',
          analysis: '成绩分析',
          ai: 'AI 助手',
          settings: '设置'
        }[page] || page;
    $$('.nav a').forEach(function (a) {
      var active = a.getAttribute('data-page') === page;
      a.classList.toggle('on', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    var def = UI.pages[page];
    var app = $('#app');
    app.classList.toggle('with-rail', !!def.rail);
    app.classList.remove('rail-open');
    UI.charts = [];
    def.render($('#main'), UI.opts);
    if (def.rail) def.rail($('#rail'));
    else $('#rail').innerHTML = '';
    if (def.mount) def.mount(UI.opts);
    UI.drawCharts();
    try {
      if (location.hash !== '#/' + page) history.replaceState(null, '', '#/' + page);
    } catch (e) {}
  },
  rerender: function () {
    UI.go(UI.page, UI.opts);
  },

  /* ---------- 弹窗 ---------- */
  modal: function (o) {
    UI.closeModal();
    var host = $('#modalHost');
    host.innerHTML =
      '<div class="mask" data-act="modal-mask"></div><div class="modal' +
      (o.wide ? ' wide' : '') +
      '" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><div class="modal-title">' +
      o.title +
      '</div><button class="modal-x" data-act="modal-close" aria-label="关闭">' +
      ICON.x +
      '</button></div>' +
      '<div class="modal-body">' +
      o.body +
      '</div>' +
      (o.foot === false
        ? ''
        : '<div class="modal-foot">' +
          (o.foot || '<button class="btn btn-light" data-act="modal-close">取消</button>') +
          '</div>') +
      '</div>';
    UI.modalCtx = o;
    if (o.mount) o.mount(host);
    var f = host.querySelector('[autofocus]') || host.querySelector('.inp,.ta');
    if (f && !o.noFocus)
      setTimeout(function () {
        f.focus();
      }, 30);
  },
  closeModal: function () {
    var h = $('#modalHost');
    if (h) h.innerHTML = '';
    var c = UI.modalCtx;
    UI.modalCtx = null;
    if (c && c.onClose) c.onClose();
  },
  confirm: function (title, msg, okText, onOk, danger) {
    UI.modal({
      title: title,
      body: '<p style="margin:4px 0 8px;color:var(--ink2);line-height:1.7">' + msg + '</p>',
      foot:
        '<button class="btn btn-light" data-act="modal-close">取消</button><button class="btn ' +
        (danger ? 'btn-red' : 'btn-dark') +
        '" data-act="confirm-ok">' +
        (okText || '确定') +
        '</button>',
      noFocus: true
    });
    UI.modalCtx.onOk = onOk;
  },
  drawer: function (html) {
    var host = $('#drawerHost');
    host.innerHTML =
      '<div class="mask" data-act="drawer-close"></div><div class="drawer" role="dialog">' +
      html +
      '</div>';
  },
  closeDrawer: function () {
    var h = $('#drawerHost');
    if (h) h.innerHTML = '';
    UI.drawerSid = null;
  },
  toast: function (msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s';
      t.style.opacity = '0';
    }, 1700);
    setTimeout(function () {
      t.remove();
    }, 2100);
  },

  /* ---------- 悬浮卡 ---------- */
  showCard: function (html, anchor) {
    var c = $('#hcard');
    c.innerHTML = html;
    c.classList.remove('above', 'below');
    var r = anchor.getBoundingClientRect();
    var cw = 300,
      ch = c.offsetHeight || 260;
    var x = r.left + r.width / 2 - cw / 2;
    x = clamp(x, 12, window.innerWidth - cw - 12);
    var below = r.bottom + ch + 16 < window.innerHeight;
    var y = below ? r.bottom + 10 : r.top - ch - 10;
    if (!below && y < 8) {
      y = 8;
    }
    c.style.left = x + 'px';
    c.style.top = y + 'px';
    c.style.setProperty('--ax', clamp(r.left + r.width / 2 - x, 20, cw - 20) + 'px');
    c.classList.add(below ? 'below' : 'above');
    c.classList.add('on');
  },
  hideCard: function () {
    var c = $('#hcard');
    if (c) c.classList.remove('on');
  },
  pop: function (html, x, y) {
    UI.closePop();
    var p = document.createElement('div');
    p.className = 'pop';
    p.id = 'pop';
    p.innerHTML = html;
    document.body.appendChild(p);
    var w = p.offsetWidth,
      h = p.offsetHeight;
    p.style.left = clamp(x - w / 2, 10, window.innerWidth - w - 10) + 'px';
    p.style.top = (y + h + 20 > window.innerHeight ? y - h - 14 : y + 14) + 'px';
  },
  closePop: function () {
    var p = $('#pop');
    if (p) p.remove();
  },

  /* ---------- 图表注册（渲染后按容器宽度绘制） ---------- */
  chart: function (fn) {
    var id = 'ch' + UI.charts.length;
    UI.charts.push({ id: id, fn: fn });
    return '<div class="chart" id="' + id + '"></div>';
  },
  drawCharts: function () {
    UI.charts.forEach(function (c) {
      var el = document.getElementById(c.id);
      if (el) el.innerHTML = c.fn(Math.max(240, el.clientWidth));
    });
  }
};

function navItem(page, ico, label, cnt) {
  return (
    '<a aria-label="' +
    label +
    '" title="' +
    label +
    '" href="#/' +
    page +
    '" data-act="go" data-page="' +
    page +
    '"><span class="ico">' +
    ico +
    '</span><span class="t">' +
    label +
    '</span>' +
    (cnt !== undefined ? '<span class="cnt">' + cnt + '</span>' : '') +
    '</a>'
  );
}

function brandMark() {
  return (
    '<span class="brand-mark">' +
    ART.teacherAvatar(S?.settings?.teacher || { gender: 'F' }, 34) +
    '</span>'
  );
}

function aiAvatar(size) {
  return (
    '<svg class="ava" viewBox="-24 -24 48 48" width="' +
    size +
    '" height="' +
    size +
    '" aria-hidden="true"><circle r="24" fill="#171717"/>' +
    '<circle cx="0" cy="-1" r="11" fill="#fff"/><path d="M-5 -10 L-3 -15 L0 -11 L3 -16 L5 -10 Z" fill="#fff"/>' +
    '<ellipse cx="-4" cy="-1" rx="2.6" ry="3.1" fill="#171717"/><ellipse cx="4" cy="-1" rx="2.6" ry="3.1" fill="#171717"/>' +
    '<path d="M-10 10 Q0 15 10 10 L11 15 Q0 20 -11 15 Z" fill="#2f7ff0"/></svg>'
  );
}

function stuAva(st, size) {
  return ART.avatar(st, size, { color: ART.groupColor(st.group || 0) });
}

export { UI, aiAvatar, brandMark, stuAva };

/* 全屏：整个工作台（左侧菜单、右侧概况一起）进入浏览器全屏 */
function isFull() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function updateFsBtn() {
  var b = $('#fsBtn');
  if (!b) return;
  var on = isFull();
  b.innerHTML = on ? ICON.unfull + '退出全屏' : ICON.fit + '全屏';
  b.title = on ? '退出全屏（Esc）' : '全屏显示整个工作台（适合投屏上课）';
}

export { isFull, updateFsBtn };
