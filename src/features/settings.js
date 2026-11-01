import { columnCount, resizeSeating } from '../core/seating.js';
import { teacherCharacter, characterById } from '../core/characters.js';
import { characterPickerHTML } from '../ui/character-picker.js';
// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { $, $$, esc, fmtTime, pad2, todayStr } from '../core/utils.js';
import { S, replaceState } from '../core/state.js';
import { ART } from '../art/scene.js';
import { AIC, AI_PRESETS, presetOf } from '../ai/providers.js';
import { ICON } from '../ui/icons.js';
import { Store, save } from '../core/storage.js';
import { STORE_KEY, SUBJECT_PRESETS, VERSION } from '../core/constants.js';
import { UI, brandMark } from '../ui/workspace.js';
import { Cls, autoGroups } from './classroom.js';
import { downloadFile } from '../ui/files.js';
import { defaultState, migrate } from '../core/schema.js';
import { demoState } from '../core/demo.js';

/* =========================================================
   设置 · 班级信息、教师形象、教室布局、学科与点评、AI 接口、数据备份、关于
   ========================================================= */
var SetP = { sec: 'class' };

var SET_SECS = [
  ['class', '班级信息'],
  ['teacher', '教师形象'],
  ['room', '教室与黑板'],
  ['subjects', '学科与点评'],
  ['ai', 'AI 接口'],
  ['data', '数据与备份'],
  ['about', '关于']
];

function sInp(path, val, ph, type, extra) {
  return (
    '<input class="inp' +
    (type === 'number' ? ' num' : '') +
    '" ' +
    (type ? 'type="' + type + '" ' : '') +
    'value="' +
    esc(val == null ? '' : val) +
    '" placeholder="' +
    esc(ph || '') +
    '" data-inp="set" data-path="' +
    path +
    '"' +
    (extra || '') +
    '>'
  );
}

function setPath(path, v) {
  var p = path.split('.'),
    o = S.settings;
  for (var i = 0; i < p.length - 1; i++) o = o[p[i]];
  o[p[p.length - 1]] = v;
}

function renderSetBody() {
  var st = S.settings,
    h = '',
    el = $('#setBody');
  if (!el) return;
  if (SetP.sec === 'class') {
    h +=
      '<div class="panel set-sec"><div class="panel-title" style="margin-bottom:14px">班级信息</div>' +
      '<div class="row2"><div class="field"><label>班级名称</label>' +
      sInp('className', st.className, '如：初二（3）班') +
      '</div><div class="field"><label>学校</label>' +
      sInp('school', st.school, '选填') +
      '</div></div>' +
      '<div class="row3"><div class="field"><label>学段</label><select class="sel" data-chg="set-stage">' +
      ['小学', '初中', '高中']
        .map(function (x) {
          return '<option' + (st.stage === x ? ' selected' : '') + '>' + x + '</option>';
        })
        .join('') +
      '</select></div>' +
      '<div class="field"><label>年级</label>' +
      sInp('grade', st.grade, '如：初二') +
      '</div><div class="field"><label>学期</label>' +
      sInp('term', st.term, '如：2026—2027 学年 第一学期') +
      '</div></div>' +
      '<div class="row2"><div class="field"><label>开学日期</label>' +
      sInp('termStart', st.termStart, '', 'date') +
      '</div></div></div>';
  } else if (SetP.sec === 'teacher') {
    var t = st.teacher;
    h +=
      '<div class="panel set-sec"><div class="panel-title" style="margin-bottom:14px">教师形象</div><div class="gender-pick">' +
      ['F', 'M']
        .map(function (g) {
          return (
            '<button class="' +
            (t.gender === g ? 'on' : '') +
            '" data-act="set-gender" data-g="' +
            g +
            '">' +
            ART.teacherAvatar({ gender: g }, 88) +
            (g === 'F' ? '女老师' : '男老师') +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      characterPickerHTML(teacherCharacter(t).id, 'teacher-character') +
      '<div class="row2" style="margin-top:18px"><div class="field"><label>称呼</label>' +
      sInp('teacher.name', t.name, '如：李老师') +
      '</div><div class="field"><label>任教学科</label>' +
      sInp('teacher.subject', t.subject, '如：数学') +
      '</div></div></div>';
  } else if (SetP.sec === 'room') {
    var cols = columnCount(st),
      cap = st.rows * cols,
      unseat = S.students.filter(function (s) {
        return !s.seat;
      }).length;
    h +=
      '<div class="panel set-sec"><div class="panel-title">教室布局</div><div class="panel-sub">行列可在教室的排座模式中自定义；座位不足的同学保留为「未排座」</div>' +
      '<div style="display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap"><div style="min-width:260px"><div class="field"><label>排数（前后）</label><div class="chips">' +
      [4, 5, 6, 7, 8, 9]
        .map(function (n) {
          return (
            '<button class="' +
            (st.rows === n ? 'on' : '') +
            '" data-act="set-rows" data-n="' +
            n +
            '">' +
            n +
            ' 排</button>'
          );
        })
        .join('') +
      '</div></div>' +
      '<div class="field"><label>组数（每组一列同桌）</label><div class="chips">' +
      [2, 3, 4, 5]
        .map(function (n) {
          return (
            '<button class="' +
            (columnCount(st) === n * 2 ? 'on' : '') +
            '" data-act="set-pairs" data-n="' +
            n +
            '">' +
            n +
            ' 组</button>'
          );
        })
        .join('') +
      '</div></div>' +
      '<div class="muted" style="font-size:14px">共 ' +
      cap +
      ' 个座位，班里 ' +
      S.students.length +
      ' 人' +
      (unseat ? '，' + unseat + ' 人未排座' : '') +
      '</div></div>' +
      '<div><div class="muted" style="font-size:12px;margin-bottom:6px;text-align:center">讲台</div><div class="mini-class" style="grid-template-columns:repeat(' +
      (cols + st.pairs - 1) +
      ',14px)">' +
      (function () {
        var s = '';
        for (var r = 0; r < st.rows; r++)
          for (var c = 0; c < cols + st.pairs - 1; c++)
            s += c % 3 === 2 ? '<span></span>' : '<i></i>';
        return s;
      })() +
      '</div></div></div>' +
      '<div class="hr"></div><label class="chk"><input type="checkbox" data-chg="set-anim"' +
      (st.anim ? ' checked' : '') +
      '> 教室小动画（同学偶尔回头、轻跳、打瞌睡）</label></div>';
    h +=
      '<div class="panel set-sec"><div class="panel-title">黑板与智慧屏</div>' +
      '<div class="row2"><div class="field"><label>左侧黑板 · 今日课程</label><textarea class="ta" data-inp="set" data-path="boardLeft" style="min-height:110px">' +
      esc(st.boardLeft) +
      '</textarea></div>' +
      '<div class="field"><label>右侧黑板 · 今日事项</label><textarea class="ta" data-inp="set" data-path="boardRight" style="min-height:110px">' +
      esc(st.boardRight) +
      '</textarea></div></div>' +
      '<div class="row2"><div class="field"><label>倒计时名称</label>' +
      sInp('countdown.label', st.countdown.label, '如：期末考试 / 中考') +
      '</div><div class="field"><label>倒计时日期</label>' +
      sInp('countdown.date', st.countdown.date, '', 'date') +
      '</div></div></div>';
  } else if (SetP.sec === 'subjects') {
    h +=
      '<div class="panel set-sec"><div class="panel-title">科目与满分</div><div class="sub-list">' +
      st.subjects
        .map(function (s, i) {
          return (
            '<span class="sub-item">' +
            esc(s.name) +
            '<input value="' +
            s.full +
            '" data-inp="set-sub-full" data-i="' +
            i +
            '" aria-label="' +
            esc(s.name) +
            '满分"><button data-act="set-sub-del" data-i="' +
            i +
            '" aria-label="删除' +
            esc(s.name) +
            '">×</button></span>'
          );
        })
        .join('') +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap"><input class="inp" id="newSub" placeholder="科目名" style="width:140px;height:32px"><input class="inp num" id="newSubFull" value="100" style="width:72px;height:32px"><button class="btn btn-light btn-sm" data-act="set-sub-add">添加科目</button><button class="btn btn-ghost btn-sm" data-act="set-sub-preset">按学段重置</button></div></div>';
    h +=
      '<div class="panel set-sec"><div class="panel-title">点评项目</div><div class="sub-list">' +
      st.reasons
        .map(function (r, i) {
          return (
            '<span class="sub-item" style="background:' +
            (r.d > 0 ? 'var(--green-soft)' : 'var(--red-soft)') +
            '">' +
            esc(r.t) +
            '<input value="' +
            r.d +
            '" data-inp="set-rs-d" data-i="' +
            i +
            '" aria-label="分值"><button data-act="set-rs-del" data-i="' +
            i +
            '" aria-label="删除">×</button></span>'
          );
        })
        .join('') +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-top:12px"><input class="inp" id="newRs" placeholder="理由，如：课堂笔记工整" style="width:220px;height:32px"><input class="inp num" id="newRsD" value="1" style="width:64px;height:32px"><button class="btn btn-light btn-sm" data-act="set-rs-add">添加</button></div></div>';
  } else if (SetP.sec === 'ai') {
    var a = st.ai,
      pr = presetOf(a.provider);
    h +=
      '<div class="panel set-sec"><div class="panel-title">AI 接口</div><div class="panel-sub">未配置接口时，可复制提示词使用。</div>' +
      '<div class="field"><label>服务商</label><select class="sel" data-chg="ai-provider">' +
      AI_PRESETS.map(function (p) {
        return (
          '<option value="' +
          p.id +
          '"' +
          (a.provider === p.id ? ' selected' : '') +
          '>' +
          p.name +
          '</option>'
        );
      }).join('') +
      '</select>' +
      (pr.site
        ? '<div class="hint">到 ' +
          esc(pr.site) +
          ' 注册并创建 API Key' +
          (pr.hint ? '；' + esc(pr.hint) : '') +
          '</div>'
        : pr.hint
          ? '<div class="hint">' + esc(pr.hint) + '</div>'
          : '') +
      '</div>' +
      '<div class="field"><label>API Key</label><div style="display:flex;gap:6px"><input class="inp num" type="password" id="aiKey" value="' +
      esc(a.key) +
      '" placeholder="sk-..." data-inp="set" data-path="ai.key" autocomplete="off"><button class="btn btn-light btn-icon" data-act="ai-key-eye" title="显示/隐藏" aria-label="显示或隐藏 Key">' +
      ICON.eye +
      '</button></div></div>' +
      '<div class="row2"><div class="field"><label>接口地址（Base URL）</label>' +
      sInp('ai.base', a.base, 'https://.../v1') +
      '</div><div class="field"><label>模型名称</label>' +
      sInp('ai.model', a.model, '如：deepseek-chat') +
      '</div></div>' +
      '<div class="row2"><div class="field"><label>创造性（temperature）</label>' +
      sInp('ai.temp', a.temp, '0.7', 'number', ' step="0.1" min="0" max="1.5"') +
      '<div class="hint">写材料建议 0.6–0.8；越高越发散</div></div>' +
      '<div class="field"><label>隐私</label><label class="chk" style="height:38px"><input type="checkbox" data-chg="ai-mask"' +
      (a.mask ? ' checked' : '') +
      '>发送前隐去学生姓名</label><div class="hint">姓名替换成【学生07】这样的编号，结果回来后自动换回；家长电话从不发送</div></div></div>' +
      '<div style="display:flex;gap:10px;align-items:center"><button class="btn btn-dark" data-act="ai-test">测试连接</button><span id="aiTestRes" class="muted" style="font-size:14px"></span></div></div>' +
      '<div class="panel set-sec"><div class="panel-title">连不上？</div><div style="font-size:14px;line-height:1.85;color:var(--ink2)">网页直接调用 AI 时，有些服务商会拦截（跨域限制）。DeepSeek、Kimi、OpenAI、Claude 一般可以直接用；如果提示「连不上」，可以：<br>① 换一家服务商试试；② 用开源包里的 <span class="kbd">ai-proxy.js</span>：电脑装好 Node.js 后运行 <span class="kbd">node ai-proxy.js</span>，再把接口地址改成 <span class="kbd">http://127.0.0.1:8787/</span> 加原地址，例如 <span class="kbd">http://127.0.0.1:8787/https://api.deepseek.com</span>。<br>API Key 只保存在这台电脑的浏览器里，不会上传到任何地方。</div></div>';
  } else if (SetP.sec === 'data') {
    var size = 0;
    try {
      size = (Store.get(STORE_KEY) || '').length;
    } catch (e) {}
    h +=
      '<div class="panel set-sec"><div class="panel-title">数据与备份</div><div class="panel-sub">班级数据保存在当前浏览器。清理浏览器或换电脑前，请先导出备份。</div>' +
      '<div class="info-grid" style="margin-bottom:16px"><div class="k">当前数据</div><div>' +
      S.students.length +
      ' 名学生 · ' +
      S.exams.length +
      ' 场考试 · ' +
      S.points.length +
      ' 条点评 · ' +
      S.records.length +
      ' 条成长记录 · ' +
      S.chats.length +
      ' 个 AI 对话</div>' +
      '<div class="k">占用空间</div><div class="num">' +
      (size / 1024).toFixed(1) +
      ' KB</div>' +
      '<div class="k">上次备份</div><div>' +
      (st.lastBackup ? fmtTime(st.lastBackup) : '<span class="dn">还没有备份过</span>') +
      '</div>' +
      '<div class="k">存储状态</div><div>' +
      (Store.ok()
        ? '正常'
        : '<span class="dn">浏览器禁止了本地存储，关闭页面后数据会丢失，请及时导出备份</span>') +
      '</div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-dark" data-act="backup">' +
      ICON.down +
      '导出备份</button><label class="btn btn-light" style="cursor:pointer">' +
      ICON.up +
      '从备份恢复<input type="file" accept=".json" hidden data-chg="restore"></label></div></div>' +
      '<div class="panel set-sec"><div class="panel-title">重新开始</div><div class="panel-sub">以下操作会覆盖当前数据，建议先导出备份</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-light" data-act="load-demo">载入示例班级</button><button class="btn btn-light" data-act="wipe" style="color:var(--red)">' +
      ICON.trash +
      '清空全部数据</button></div></div>';
  } else if (SetP.sec === 'about') {
    h +=
      '<div class="panel set-sec"><div style="display:flex;gap:14px;align-items:center">' +
      brandMark().replace(
        'class="brand-mark"',
        'class="brand-mark" style="width:52px;height:52px"'
      ) +
      '<div><div style="font-size:20px;font-weight:700">cyz的教师工作台</div><div class="muted" style="font-size:14px">cyz · v' +
      VERSION +
      '</div></div></div>' +
      '<div style="font-size:14px;line-height:1.9;color:var(--ink2);margin-top:14px">一个打开就能用的单文件工作台：学生档案、考勤、课堂点评、排座位、成绩录入与分析，外加可接入任意大模型的 AI 助手。所有数据都留在你自己的电脑上。<br>开源版只做 PC 端；手机端和更多职业版本会陆续推出。</div>' +
      '<div style="font-size:14px;line-height:1.8;color:var(--ink2);margin-top:24px"><b style="color:var(--ink)">开源协议</b><br>个人可以免费使用、修改和二次开发，分享时请保留作者署名和协议；禁止任何形式的商业使用。完整条款见随软件附带的 LICENSE 文件。</div>' +
      '<div class="sign" style="padding:14px 0 0;font-size:12px">Developed by @赛博老爸</div></div>';
  }
  el.innerHTML = h;
}

function fixSeats() {
  resizeSeating(S, S.settings.rows, columnCount(S.settings));
  Cls.seatUndo = null;
  Cls.layoutUndo = null;
  autoGroups();
  Cls.view.fit = true;
}
export function registerFeaturesSettings() {
  UI.act['teacher-character'] = function (el) {
    const id = el.getAttribute('data-character');
    if (!characterById(id)) return;
    S.settings.teacher.characterId = id;
    save();
    UI.refreshSide();
    renderSetBody();
  };

  UI.register('settings', {
    render: function (main, opts) {
      if (opts && opts.sec) SetP.sec = opts.sec;
      main.innerHTML =
        '<div class="page scroll"><div class="page-head"><div><h1 class="page-title">设置</h1></div></div>' +
        '<div class="set-layout"><nav class="set-nav">' +
        SET_SECS.map(function (s) {
          return (
            '<button class="' +
            (SetP.sec === s[0] ? 'on' : '') +
            '" data-act="set-sec" data-s="' +
            s[0] +
            '">' +
            s[1] +
            '</button>'
          );
        }).join('') +
        '</nav><div id="setBody"></div></div></div>';
      renderSetBody();
    }
  });

  UI.act['set-sec'] = function (el) {
    SetP.sec = el.getAttribute('data-s');
    $$('.set-nav button').forEach(function (b) {
      b.classList.toggle('on', b === el);
    });
    renderSetBody();
  };

  UI.inp['set'] = function (el) {
    var path = el.getAttribute('data-path'),
      v = el.type === 'number' ? parseFloat(el.value) : el.value;
    if (el.type === 'number' && isNaN(v)) return;
    setPath(path, v);
    save();
    if (/className|teacher\.name|teacher\.subject/.test(path)) UI.refreshSide();
  };

  UI.chg['set-stage'] = function (el) {
    S.settings.stage = el.value;
    save();
  };

  UI.act['set-gender'] = function (el) {
    S.settings.teacher.gender = el.getAttribute('data-g');
    delete S.settings.teacher.characterId;
    save();
    UI.refreshSide();
    renderSetBody();
  };

  UI.act['set-rows'] = function (el) {
    S.settings.rows = +el.getAttribute('data-n');
    fixSeats();
    save();
    renderSetBody();
  };

  UI.act['set-pairs'] = function (el) {
    S.settings.pairs = +el.getAttribute('data-n');
    S.settings.cols = S.settings.pairs * 2;
    fixSeats();
    save();
    renderSetBody();
  };

  UI.chg['set-anim'] = function (el) {
    S.settings.anim = el.checked;
    save();
  };

  UI.inp['set-sub-full'] = function (el) {
    var v = parseFloat(el.value);
    if (v > 0) {
      S.settings.subjects[+el.getAttribute('data-i')].full = v;
      save();
    }
  };

  UI.act['set-sub-del'] = function (el) {
    S.settings.subjects.splice(+el.getAttribute('data-i'), 1);
    save();
    renderSetBody();
  };

  UI.act['set-sub-add'] = function () {
    var n = $('#newSub').value.trim(),
      f = parseFloat($('#newSubFull').value) || 100;
    if (!n) {
      $('#newSub').focus();
      return;
    }
    if (
      !S.settings.subjects.some(function (s) {
        return s.name === n;
      })
    )
      S.settings.subjects.push({ name: n, full: f });
    save();
    renderSetBody();
  };

  UI.act['set-sub-preset'] = function () {
    S.settings.subjects = SUBJECT_PRESETS[S.settings.stage].map(function (x) {
      return { name: x[0], full: x[1] };
    });
    save();
    renderSetBody();
    UI.toast('已按' + S.settings.stage + '重置科目');
  };

  UI.inp['set-rs-d'] = function (el) {
    var v = parseInt(el.value, 10);
    if (!isNaN(v) && v !== 0) {
      S.settings.reasons[+el.getAttribute('data-i')].d = v;
      save();
    }
  };

  UI.act['set-rs-del'] = function (el) {
    S.settings.reasons.splice(+el.getAttribute('data-i'), 1);
    save();
    renderSetBody();
  };

  UI.act['set-rs-add'] = function () {
    var t = $('#newRs').value.trim(),
      d = parseInt($('#newRsD').value, 10) || 1;
    if (!t) {
      $('#newRs').focus();
      return;
    }
    S.settings.reasons.push({ t: t, d: d });
    save();
    renderSetBody();
  };

  UI.chg['ai-provider'] = function (el) {
    var p = presetOf(el.value),
      a = S.settings.ai;
    a.provider = p.id;
    if (p.id !== 'custom') {
      a.base = p.base;
      a.model = p.model;
    }
    save();
    renderSetBody();
  };

  UI.act['ai-key-eye'] = function () {
    var k = $('#aiKey');
    k.type = k.type === 'password' ? 'text' : 'password';
  };

  UI.act['ai-test'] = function () {
    var r = $('#aiTestRes');
    if (!AIC.ready()) {
      r.innerHTML = '<span class="dn">请先填写接口地址、模型名称和 API Key</span>';
      return;
    }
    r.textContent = '正在连接…';
    var t0 = Date.now();
    AIC.stream([{ role: 'user', content: '请只回复四个字：连接成功' }], function () {}, null, 20)
      .then(function (txt) {
        r.innerHTML =
          '<span class="up">' +
          ICON.check.replace('<svg', '<svg style="display:inline;vertical-align:-3px"') +
          ' 连接成功（' +
          ((Date.now() - t0) / 1000).toFixed(1) +
          ' 秒）</span> <span class="muted">模型回复：' +
          esc(String(txt).slice(0, 30)) +
          '</span>';
      })
      .catch(function (e) {
        r.innerHTML = '<span class="dn" style="white-space:pre-line">' + esc(e.message) + '</span>';
      });
  };

  UI.act['backup'] = function () {
    S.settings.lastBackup = Date.now();
    save(true);
    var d = new Date();
    downloadFile(
      '班主任工作台备份-' +
        S.settings.className +
        '-' +
        todayStr() +
        '-' +
        pad2(d.getHours()) +
        pad2(d.getMinutes()) +
        '.json',
      JSON.stringify(S, null, 1),
      'application/json'
    );
    UI.toast('备份已下载，请妥善保存');
    if (UI.page === 'settings') renderSetBody();
  };

  UI.chg['restore'] = function (el) {
    var f = el.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        if (!d || !d.settings || !Array.isArray(d.students)) throw new Error('bad');
        UI.confirm(
          '从备份恢复',
          '备份里有 ' +
            d.students.length +
            ' 名学生、' +
            (d.exams || []).length +
            ' 场考试。恢复会覆盖当前全部数据，确定吗？',
          '恢复',
          function () {
            replaceState(migrate(d));
            save(true);
            UI.shell();
            UI.go('class');
            UI.toast('已恢复');
          }
        );
      } catch (e) {
        UI.toast('这不是有效的备份文件');
      }
    };
    rd.readAsText(f, 'utf-8');
    el.value = '';
  };

  UI.act['load-demo'] = function () {
    UI.confirm(
      '载入示例班级',
      '会用一个 46 人的示例班级覆盖当前数据（保留你的形象和 AI 设置）。',
      '载入',
      function () {
        var keep = { teacher: S.settings.teacher, ai: S.settings.ai };
        replaceState(demoState());
        S.settings.teacher = keep.teacher;
        S.settings.ai = keep.ai;
        save(true);
        Cls.entered = false;
        UI.shell();
        UI.go('class');
      },
      true
    );
  };

  UI.act['wipe'] = function () {
    UI.confirm(
      '清空全部数据',
      '学生、成绩、考勤、点评、AI 对话都会被删除，无法恢复。确定吗？',
      '清空',
      function () {
        var keep = { teacher: S.settings.teacher, ai: S.settings.ai };
        replaceState(defaultState());
        S.settings.teacher = keep.teacher;
        S.settings.ai = keep.ai;
        S.settings.onboarded = true;
        save(true);
        UI.shell();
        UI.go('class');
        UI.toast('已清空');
      },
      true
    );
  };
}
