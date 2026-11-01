// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { $, esc } from '../core/utils.js';
import { ICON } from './icons.js';
import { UI, stuAva, isFull, updateFsBtn } from './workspace.js';

import { S } from '../core/state.js';

var resizeT = null;

export function registerUiEvents() {
  /* ---------- 事件委托 ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) {
      if (!e.target.closest('#pop') && !e.target.closest('.seat')) UI.closePop();
      if (!e.target.closest('.search')) {
        var sp = $('#gsearchPop');
        if (sp) sp.innerHTML = '';
      }
      return;
    }
    var name = el.getAttribute('data-act');
    var fn = UI.act[name];
    if (fn) {
      if (el.tagName === 'A') e.preventDefault();
      fn(el, e);
    }
  });

  document.addEventListener('input', function (e) {
    var el = e.target.closest('[data-inp]');
    if (!el) return;
    var fn = UI.inp[el.getAttribute('data-inp')];
    if (fn) fn(el, e);
  });

  document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-chg]');
    if (!el) return;
    var fn = UI.chg[el.getAttribute('data-chg')];
    if (fn) fn(el, e);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if ($('#pop')) {
        UI.closePop();
        return;
      }
      if ($('#modalHost').innerHTML) {
        UI.closeModal();
        return;
      }
      if ($('#drawerHost').innerHTML) {
        UI.closeDrawer();
        return;
      }
      var pc = $('#pickCard');
      if (pc && (pc.innerHTML || $('#stage.picking'))) {
        UI.act['pick-close']();
        return;
      }
    }
    var el = e.target.closest && e.target.closest('[data-key]');
    if (!el) return;
    var fn = UI.key && UI.key[el.getAttribute('data-key')];
    if (fn) fn(el, e);
  });

  UI.key = {};

  /* 图表提示 */
  document.addEventListener('mousemove', function (e) {
    var tip = $('#tip');
    if (!tip) return;
    var el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) {
      tip.classList.remove('on');
      return;
    }
    tip.innerHTML = el.getAttribute('data-tip');
    var w = tip.offsetWidth,
      h = tip.offsetHeight;
    var x = e.clientX + 14,
      y = e.clientY - h - 12;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
    if (y < 8) y = e.clientY + 18;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.classList.add('on');
  });

  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      UI.drawCharts();
      var def = UI.pages[UI.page];
      if (def && def.resize) def.resize();
    }, 120);
  });

  UI.act['fullscreen'] = function () {
    var el = document.documentElement;
    try {
      if (isFull()) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        return;
      }
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req) {
        UI.toast('当前浏览器不支持网页全屏，请使用浏览器菜单进入全屏');
        return;
      }
      var p = req.call(el);
      if (p && p.catch)
        p.catch(function () {
          UI.toast('浏览器没有允许全屏，请使用浏览器菜单进入全屏');
        });
    } catch (e) {
      UI.toast('浏览器没有允许全屏，请使用浏览器菜单进入全屏');
    }
  };

  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      updateFsBtn();
      UI.hideCard();
      setTimeout(function () {
        var def = UI.pages[UI.page];
        if (def && def.resize) def.resize();
      }, 120);
    });
  });

  /* 通用动作 */
  UI.act['go'] = function (el) {
    var p = el.getAttribute('data-page');
    UI.closeDrawer();
    UI.closeModal();
    UI.go(p, { sec: el.getAttribute('data-sec') || null });
  };

  UI.act['modal-close'] = function () {
    UI.closeModal();
  };

  UI.act['modal-mask'] = function () {
    UI.closeModal();
  };

  UI.act['drawer-close'] = function () {
    UI.closeDrawer();
  };

  UI.act['confirm-ok'] = function () {
    var c = UI.modalCtx;
    UI.closeModal();
    if (c && c.onOk) c.onOk();
  };

  UI.act['toggle-rail'] = function () {
    UI.hideCard();
    $('#app').classList.toggle('rail-open');
  };

  /* 全局搜索 */
  UI.inp['gsearch'] = function (el) {
    var q = el.value.trim(),
      pop = $('#gsearchPop');
    if (!q) {
      pop.innerHTML = '';
      return;
    }
    var res = S.students
      .filter(function (s) {
        return s.name.indexOf(q) >= 0 || String(s.no).indexOf(q) >= 0;
      })
      .slice(0, 8);
    pop.innerHTML =
      '<div class="search-pop">' +
      (res.length
        ? res
            .map(function (s, i) {
              return (
                '<button data-act="open-stu" data-sid="' +
                s.id +
                '" class="' +
                (i === 0 ? 'on' : '') +
                '">' +
                stuAva(s, 24) +
                '<span>' +
                esc(s.name) +
                '</span><span class="muted" style="margin-left:auto;font-size:12px">' +
                esc(s.no) +
                '</span></button>'
              );
            })
            .join('')
        : '<div class="muted" style="padding:8px 10px;font-size:14px">没有找到「' +
          esc(q) +
          '」</div>') +
      '</div>';
  };

  UI.key['gsearch'] = function (el, e) {
    if (e.key === 'Enter') {
      var b = $('#gsearchPop .search-pop button');
      if (b) b.click();
    }
  };
}
