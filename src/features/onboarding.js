// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { UI } from '../ui/workspace.js';
import { ART } from '../art/scene.js';
import { $, $$ } from '../core/utils.js';
import { S, replaceState } from '../core/state.js';
import { demoState } from '../core/demo.js';
import { defaultState } from '../core/schema.js';
import { SUBJECT_PRESETS } from '../core/constants.js';
import { save } from '../core/storage.js';

/* =========================================================
   启动 · 首次欢迎页（选择形象）→ 进入工作台
   ========================================================= */
var Welcome = { g: 'F', mode: 'demo' };

function showWelcome() {
  var el = document.createElement('div');
  el.className = 'welcome';
  el.id = 'welcome';
  el.innerHTML =
    '<div class="welcome-in">' +
    '<h1>设置工作台</h1>' +
    '<div class="w-avatars">' +
    ['F', 'M']
      .map(function (g) {
        return (
          '<button class="' +
          (Welcome.g === g ? 'on' : '') +
          '" data-act="w-g" data-g="' +
          g +
          '"><span class="circle">' +
          ART.teacherAvatar({ gender: g }, 96, false) +
          '</span>' +
          (g === 'F' ? '女老师' : '男老师') +
          '</button>'
        );
      })
      .join('') +
    '</div>' +
    '<div class="w-form"><div class="field"><label>怎么称呼你</label><input class="inp" id="wName" placeholder="如：李老师" value="' +
    (Welcome.g === 'F' ? '李老师' : '王老师') +
    '"></div><div class="field"><label>任教学科</label><input class="inp" id="wSub" placeholder="如：数学"></div></div>' +
    '<div class="w-mode"><button class="' +
    (Welcome.mode === 'demo' ? 'on' : '') +
    '" data-act="w-mode" data-m="demo"><b>先看看示例班级</b>46 名虚拟学生和 4 次考试，随时可以清空</button><button class="' +
    (Welcome.mode === 'blank' ? 'on' : '') +
    '" data-act="w-mode" data-m="blank"><b>直接用我的班级</b>空教室，自己添加或从 Excel 导入学生</button></div>' +
    '<div id="wBlank" class="' +
    (Welcome.mode === 'blank' ? '' : 'hide') +
    '" style="max-width:440px;margin:-12px auto 22px"><div class="w-form"><div class="field"><label>班级名称</label><input class="inp" id="wClass" placeholder="如：初二（3）班"></div><div class="field"><label>学段</label><select class="sel" id="wStage"><option>小学</option><option selected>初中</option><option>高中</option></select></div></div></div>' +
    '<button class="btn btn-dark w-go" data-act="w-go">开启工作台</button></div>';
  document.body.appendChild(el);
}
export function registerFeaturesOnboarding() {
  UI.act['w-g'] = function (el) {
    Welcome.g = el.getAttribute('data-g');
    $$('.w-avatars button').forEach(function (b) {
      b.classList.toggle('on', b === el);
    });
    var n = $('#wName');
    if (n && (n.value === '李老师' || n.value === '王老师'))
      n.value = Welcome.g === 'F' ? '李老师' : '王老师';
  };

  UI.act['w-mode'] = function (el) {
    Welcome.mode = el.getAttribute('data-m');
    $$('.w-mode button').forEach(function (b) {
      b.classList.toggle('on', b === el);
    });
    $('#wBlank').classList.toggle('hide', Welcome.mode !== 'blank');
  };

  UI.act['w-go'] = function () {
    var name = $('#wName').value.trim() || '老师',
      sub = $('#wSub').value.trim();
    if (Welcome.mode === 'demo') {
      replaceState(demoState());
      S.settings.teacher = { name: name, gender: Welcome.g, subject: sub || '数学' };
    } else {
      var cn = $('#wClass').value.trim();
      if (!cn) {
        $('#wClass').focus();
        UI.toast('请填写班级名称');
        return;
      }
      var stg = $('#wStage').value;
      replaceState(defaultState());
      S.settings.className = cn;
      S.settings.stage = stg;
      S.settings.subjects = SUBJECT_PRESETS[stg].slice(0, stg === '小学' ? 3 : 6).map(function (x) {
        return { name: x[0], full: x[1] };
      });
      S.settings.teacher = { name: name, gender: Welcome.g, subject: sub };
    }
    S.settings.onboarded = true;
    save(true);
    var w = $('#welcome');
    w.style.transition = 'opacity .3s';
    w.style.opacity = '0';
    setTimeout(function () {
      w.remove();
    }, 300);
    UI.shell();
    UI.go('class');
  };
}

export { showWelcome };
