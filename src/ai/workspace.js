import { AIP, busyGuard, chatById } from './session.js';
// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { S } from '../core/state.js';
import { AIC } from './providers.js';
import { $, $$, esc, fmtTime, todayStr, uid } from '../core/utils.js';
import { TPLS, TPL_CATS, tplById } from './templates.js';
import { examById, examsSorted, prevExam, stuById, studentsByNo } from '../core/queries.js';
import { UI, aiAvatar } from '../ui/workspace.js';
import { ICON } from '../ui/icons.js';
import { Mask } from './mask.js';
import { classContext, examContext, studentContext, sysPrompt } from './context.js';
import { save } from '../core/storage.js';
import { exportWord, mdToHtml } from './markdown.js';
import { batchCombinedPrompt, batchHTML, startBatch } from './batch.js';
import { copyText } from '../ui/files.js';

/* ---------- 页面状态 ---------- */

function apiPill() {
  var ok = AIC.ready();
  return (
    '<button class="api-pill' +
    (ok ? ' ok' : '') +
    '" data-act="go" data-page="settings" data-sec="ai" title="AI 接口设置">' +
    (ok ? esc(AIC.label()) : '配置 AI 接口') +
    '</button>'
  );
}

function renderAIHome(main) {
  var list = TPLS.filter(function (x) {
    return x.cat !== 'hidden' && (AIP.tab === 'rec' ? x.rec : x.cat === AIP.tab);
  });
  var studentOpts =
    '<option value="">+ 学生档案</option>' +
    studentsByNo()
      .map(function (s) {
        return (
          '<option value="' +
          s.id +
          '"' +
          (AIP.ctx.sid === s.id ? ' selected' : '') +
          '>' +
          esc(s.name) +
          '</option>'
        );
      })
      .join('');
  var examOpts =
    '<option value="">+ 考试数据</option>' +
    examsSorted()
      .reverse()
      .map(function (e) {
        return (
          '<option value="' +
          e.id +
          '"' +
          (AIP.ctx.exam === e.id ? ' selected' : '') +
          '>' +
          esc(e.name) +
          '</option>'
        );
      })
      .join('');
  main.innerHTML =
    '<div class="ai-page"><div class="ai-home scroll"><div class="ai-wrap">' +
    '<div class="ai-head"><h1 class="page-title">AI 助手</h1>' +
    apiPill() +
    '</div>' +
    '<div class="composer"><textarea id="aiInput" aria-label="输入需求" placeholder="输入需求" data-key="ai-send"></textarea>' +
    '<div class="composer-bar"><button class="ctx-chip' +
    (AIP.ctx.cls ? ' on' : '') +
    '" data-act="ctx-cls">' +
    (AIP.ctx.cls ? ICON.check : ICON.plus) +
    '班级概况</button>' +
    '<select class="ctx-chip' +
    (AIP.ctx.sid ? ' on' : '') +
    '" data-chg="ctx-sid" style="border:0;outline:none;appearance:none;padding-right:12px">' +
    studentOpts +
    '</select>' +
    '<select class="ctx-chip' +
    (AIP.ctx.exam ? ' on' : '') +
    '" data-chg="ctx-exam" style="border:0;outline:none;appearance:none;padding-right:12px">' +
    examOpts +
    '</select>' +
    '<span class="grow"></span><label class="chk muted" style="font-size:12px" title="学生姓名会替换成【学生07】这样的编号再发给 AI，结果回来后自动换回真名"><input type="checkbox" data-chg="ai-mask"' +
    (S.settings.ai.mask ? ' checked' : '') +
    '>隐去学生姓名</label>' +
    '<button class="send" data-act="ai-send" aria-label="发送">' +
    ICON.send +
    '</button></div></div>' +
    '<div class="tpl-tabs">' +
    TPL_CATS.map(function (c) {
      return (
        '<button class="' +
        (AIP.tab === c[0] ? 'on' : '') +
        '" data-act="tpl-tab" data-c="' +
        c[0] +
        '">' +
        c[1] +
        '</button>'
      );
    }).join('') +
    '</div>' +
    '<div class="tpl-grid">' +
    list
      .map(function (x) {
        return (
          '<button class="tpl" data-act="ai-tpl" data-tpl="' +
          x.id +
          '"><div class="t">' +
          esc(x.title) +
          '</div></button>'
        );
      })
      .join('') +
    '</div>' +
    (S.chats.length
      ? '<div class="tpl-tabs"><button class="on" style="cursor:default">最近对话</button></div><div class="mini-list">' +
        S.chats
          .slice(0, 8)
          .map(function (c) {
            return (
              '<button class="mini-item" data-act="open-chat" data-id="' +
              c.id +
              '" style="margin-bottom:6px;padding:10px 0"><span class="grow"><b style="font-weight:600">' +
              esc(c.title) +
              '</b></span><span class="r">' +
              fmtTime(c.date) +
              '</span></button>'
            );
          })
          .join('') +
        '</div>'
      : '') +
    '</div></div></div>';
}

function readTplForm(tpl) {
  var v = {},
    miss = null;
  tpl.fields.forEach(function (f) {
    var el = $('#modalHost [data-f="' + f[0] + '"]');
    if (!el) return;
    if (f[1] === 'select') {
      var on = el.querySelector('.on');
      v[f[0]] = on ? on.textContent : f[3][0];
    } else if (f[1] === 'check') v[f[0]] = el.checked;
    else if (f[1] === 'students')
      v[f[0]] = $$('input:checked', el).map(function (i) {
        return i.value;
      });
    else v[f[0]] = (el.value || '').trim();
    if (f[5] && !v[f[0]] && !miss) miss = f[2];
  });
  if (miss) {
    UI.toast('请填写「' + miss + '」');
    return null;
  }
  var needEx =
    tpl.fields.some(function (f) {
      return f[1] === 'exam';
    }) && !v.exam;
  if (needEx) {
    UI.toast('还没有考试数据，先去「成绩录入」新建一场考试');
    return null;
  }
  var badStu = tpl.fields.some(function (f) {
    return f[1] === 'student' && !stuById(v[f[0]]);
  });
  if (badStu) {
    UI.toast('班里还没有学生，先添加学生');
    return null;
  }
  return v;
}

function fullPrompt(job) {
  return Mask.apply(sysPrompt() + '\n\n' + (job.ctx || []).join('\n') + '\n' + job.prompt);
}

function userContent(job) {
  return Mask.apply(
    (job.ctx && job.ctx.length ? job.ctx.join('\n') + '\n【任务】\n' : '') + job.prompt
  );
}

function copyPromptModal(text) {
  UI.modal({
    title: '复制提示词，粘贴到任意 AI 网页版',
    wide: true,
    body:
      '<p style="margin:0 0 10px;color:var(--ink2);font-size:14px;line-height:1.7">还没有配置 AI 接口也没关系：复制下面这段，打开 <b>豆包</b>、<b>DeepSeek</b>、<b>Kimi</b>、<b>通义</b> 等任意一个网页版或 App，粘贴发送即可。' +
      (S.settings.ai.mask ? '学生姓名已替换成编号，拿到结果后对照编号即可。' : '') +
      '</p><div class="prompt-box" id="promptBox">' +
      esc(text) +
      '</div>' +
      (S.settings.ai.mask
        ? '<details style="margin-top:10px;font-size:14px;color:var(--ink2)"><summary style="cursor:pointer">查看编号对照表</summary><div style="margin-top:6px;line-height:1.9">' +
          studentsByNo()
            .map(function (s) {
              return '<span style="margin-right:12px">' + Mask.code(s) + esc(s.name) + '</span>';
            })
            .join('') +
          '</div></details>'
        : ''),
    foot:
      '<button class="btn btn-light" data-act="go" data-page="settings" data-sec="ai">配置 API，直接生成</button><button class="btn btn-dark" data-act="copy-prompt">' +
      ICON.copy +
      '复制提示词</button>'
  });
  UI.modalCtx.text = text;
}

/* ---------- 对话 ---------- */

function startChat(job) {
  if (!AIC.ready()) {
    copyPromptModal(fullPrompt(job));
    return;
  }
  if (busyGuard()) return;
  UI.closeModal();
  var c = {
    id: uid('c'),
    title: job.title || '新对话',
    date: Date.now(),
    tpl: job.tpl || '',
    sid: job.sid || null,
    saveAs: job.saveAs || null,
    msgs: [{ role: 'user', show: job.show, content: userContent(job) }]
  };
  S.chats.unshift(c);
  save(true);
  UI.renderRecent();
  AIP.chat = c.id;
  UI.closeDrawer();
  UI.go('ai', { chat: c.id });
  runChat(c);
}

function followUp(text) {
  var c = chatById(AIP.chat);
  if (!c || busyGuard()) return;
  c.msgs.push({ role: 'user', show: text, content: Mask.apply(text) });
  $('#aiInput').value = '';
  save(true);
  renderThread($('#main'));
  runChat(c);
}

function runChat(c) {
  var msgs = [{ role: 'system', content: sysPrompt() }].concat(
    c.msgs
      .filter(function (m) {
        return !m.err && !m.batch && (m.role === 'user' || (m.content && m.content.trim()));
      })
      .map(function (m) {
        return {
          role: m.role,
          content: m.role === 'assistant' ? Mask.apply(m.content) : m.content
        };
      })
  );
  var bot = { role: 'assistant', content: '', streaming: true };
  c.msgs.push(bot);
  renderThread($('#main'));
  AIP.busy = true;
  AIP.ctrl = new AbortController();
  var raf = null;
  AIC.stream(
    msgs,
    function (d, full) {
      bot.content = Mask.restore(full);
      if (!raf)
        raf = requestAnimationFrame(function () {
          raf = null;
          updateStreaming(bot);
        });
    },
    AIP.ctrl.signal
  )
    .then(function () {
      bot.streaming = false;
      AIP.busy = false;
      c.date = Date.now();
      save();
      if (AIP.chat === c.id) renderThread($('#main'));
    })
    .catch(function (e) {
      bot.streaming = false;
      AIP.busy = false;
      if (!bot.content) {
        bot.err = e.message;
      } else bot.content += '\n\n（' + e.message + '）';
      save();
      if (AIP.chat === c.id) renderThread($('#main'));
    });
}

function updateStreaming(bot) {
  var el = $('#streamMd');
  if (!el) return;
  el.innerHTML = mdToHtml(bot.content) + '<span class="cursor"></span>';
  var th = $('#aiThread');
  if (th && th.scrollHeight - th.scrollTop - th.clientHeight < 180) th.scrollTop = th.scrollHeight;
}

function renderThread(main) {
  var c = chatById(AIP.chat);
  if (!c) {
    renderAIHome(main);
    return;
  }
  var keepInput = $('#aiInput') ? $('#aiInput').value : '';
  var h =
    '<div class="ai-page"><div class="thread-head"><button class="btn btn-ghost btn-sm" data-act="ai-home">' +
    ICON.back +
    '新对话</button><div class="t">' +
    esc(c.title) +
    '</div>' +
    apiPill() +
    '<button class="btn btn-ghost btn-sm" data-act="chat-word">' +
    ICON.doc +
    '导出 Word</button><button class="btn btn-ghost btn-sm btn-icon" data-act="chat-del" title="删除对话" aria-label="删除对话">' +
    ICON.trash +
    '</button></div>' +
    '<div class="ai-thread scroll" id="aiThread"><div class="ai-wrap">';
  c.msgs.forEach(function (m, i) {
    if (m.role === 'user') {
      h += '<div class="msg user"><div class="bubble">' + esc(m.show || m.content) + '</div></div>';
      return;
    }
    h +=
      '<div class="msg bot">' +
      aiAvatar(30) +
      '<div class="body"><div class="who">班级助理' +
      (m.streaming ? ' · 正在写…' : '') +
      '</div>';
    if (m.err)
      h +=
        '<div class="msg-err">' +
        esc(m.err).replace(/\n/g, '<br>') +
        '<div style="margin-top:8px;display:flex;gap:6px">' +
        (i === c.msgs.length - 1
          ? '<button class="btn btn-xs btn-dark" data-act="chat-retry">重试</button>'
          : '') +
        '<button class="btn btn-xs btn-light" data-act="go" data-page="settings" data-sec="ai">检查 AI 设置</button><button class="btn btn-xs btn-light" data-act="chat-copy-prompt">改为复制提示词</button></div></div>';
    else if (m.batch) h += batchHTML(c, m);
    else
      h +=
        '<div class="md"' +
        (m.streaming ? ' id="streamMd"' : '') +
        '>' +
        mdToHtml(m.content) +
        (m.streaming ? '<span class="cursor"></span>' : '') +
        '</div>';
    if (!m.streaming && !m.err && !m.batch) {
      h +=
        '<div class="msg-tools"><button class="btn btn-xs btn-ghost" data-act="msg-copy" data-i="' +
        i +
        '">' +
        ICON.copy +
        '复制</button><button class="btn btn-xs btn-ghost" data-act="msg-word" data-i="' +
        i +
        '">' +
        ICON.doc +
        '导出 Word</button>' +
        (c.saveAs === 'comment' && c.sid
          ? '<button class="btn btn-xs btn-ghost" data-act="msg-save-cmt" data-i="' +
            i +
            '">' +
            ICON.check +
            '保存为评语</button>'
          : '') +
        (c.sid && c.saveAs !== 'comment'
          ? '<button class="btn btn-xs btn-ghost" data-act="msg-save-rec" data-i="' +
            i +
            '">记到成长记录</button>'
          : '') +
        (i === c.msgs.length - 1
          ? '<button class="btn btn-xs btn-ghost" data-act="chat-regen">' +
            ICON.refresh +
            '重新生成</button>'
          : '') +
        '</div>';
    }
    h += '</div></div>';
  });
  h +=
    '</div></div><div class="ai-foot"><div class="ai-wrap" style="max-width:820px;margin:0 auto"><div class="composer"><textarea id="aiInput" placeholder="' +
    (c.batchOnly ? '批量任务不支持追问' : '继续追问，比如：再精简一点 / 换成更正式的语气') +
    '" data-key="ai-send"' +
    (c.batchOnly ? ' disabled' : '') +
    '>' +
    esc(keepInput) +
    '</textarea>' +
    '<div class="composer-bar"><span class="muted" style="font-size:12px">Enter 发送 · Shift + Enter 换行</span><span class="grow"></span>' +
    (AIP.busy
      ? '<button class="btn btn-sm btn-light" data-act="ai-stop">' + ICON.stop + '停止</button>'
      : '<button class="send" data-act="ai-send" aria-label="发送"' +
        (c.batchOnly ? ' disabled' : '') +
        '>' +
        ICON.send +
        '</button>') +
    '</div></div></div></div></div>';
  main.innerHTML = h;
  var th = $('#aiThread');
  if (th) th.scrollTop = th.scrollHeight;
}
export function registerAiWorkspace() {
  UI.register('ai', {
    render: function (main, opts) {
      if (opts && opts.chat) AIP.chat = opts.chat;
      else if (!AIP.busy) AIP.chat = null;
      if (AIP.chat && !chatById(AIP.chat)) AIP.chat = null;
      if (AIP.chat) renderThread(main);
      else renderAIHome(main);
    },
    unmount: function () {}
  });

  UI.act['tpl-tab'] = function (el) {
    AIP.tab = el.getAttribute('data-c');
    renderAIHome($('#main'));
  };

  UI.act['ctx-cls'] = function () {
    AIP.ctx.cls = !AIP.ctx.cls;
    var v = $('#aiInput').value;
    renderAIHome($('#main'));
    $('#aiInput').value = v;
  };

  UI.chg['ctx-sid'] = function (el) {
    AIP.ctx.sid = el.value;
    el.classList.toggle('on', !!el.value);
  };

  UI.chg['ctx-exam'] = function (el) {
    AIP.ctx.exam = el.value;
    el.classList.toggle('on', !!el.value);
  };

  UI.chg['ai-mask'] = function (el) {
    S.settings.ai.mask = el.checked;
    save();
  };

  UI.key['ai-send'] = function (el, e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      UI.act['ai-send']();
    }
  };

  UI.act['ai-send'] = function () {
    var inp = $('#aiInput');
    var text = inp ? inp.value.trim() : '';
    if (!text) {
      if (inp) inp.focus();
      return;
    }
    if (AIP.busy) return;
    if (AIP.chat) {
      followUp(text);
      return;
    }
    var ctx = [];
    if (AIP.ctx.cls) ctx.push(classContext());
    if (AIP.ctx.sid) {
      var s = stuById(AIP.ctx.sid);
      if (s) ctx.push(studentContext(s));
    }
    if (AIP.ctx.exam) {
      var ex = examById(AIP.ctx.exam);
      if (ex) ctx.push(examContext(ex, prevExam(ex)));
    }
    startChat({
      title: text.slice(0, 26),
      show: text,
      prompt: text,
      ctx: ctx,
      sid: AIP.ctx.sid || null
    });
    AIP.ctx = { cls: false, sid: '', exam: '' };
  };

  /* ---------- 模板表单 ---------- */
  UI.act['ai-tpl'] = function (el) {
    var tpl = tplById(el.getAttribute('data-tpl'));
    if (!tpl) return;
    UI.closeDrawer();
    UI.hideCard();
    var pre = {
      sid: el.getAttribute('data-sid'),
      exam: el.getAttribute('data-exam'),
      cmp: el.getAttribute('data-cmp')
    };
    var exs = examsSorted().reverse();
    var body = tpl.fields
      .map(function (f) {
        var key = f[0],
          type = f[1],
          label = f[2],
          def = typeof f[3] === 'function' ? f[3]() : f[3],
          ph = f[4] || '',
          req = f[5];
        var lab = '<label>' + label + (req ? '<span class="req">*</span>' : '') + '</label>';
        if (type === 'text')
          return (
            '<div class="field">' +
            lab +
            '<input class="inp" data-f="' +
            key +
            '" value="' +
            esc(def || '') +
            '" placeholder="' +
            esc(ph) +
            '"></div>'
          );
        if (type === 'textarea')
          return (
            '<div class="field">' +
            lab +
            '<textarea class="ta" data-f="' +
            key +
            '" placeholder="' +
            esc(ph) +
            '" style="min-height:70px">' +
            esc(def || '') +
            '</textarea></div>'
          );
        if (type === 'select')
          return (
            '<div class="field">' +
            lab +
            '<div class="chips" data-f="' +
            key +
            '" data-sel="1">' +
            def
              .map(function (o, i) {
                return (
                  '<button type="button" class="' +
                  (i === 0 ? 'on' : '') +
                  '" data-act="chip-one">' +
                  esc(o) +
                  '</button>'
                );
              })
              .join('') +
            '</div></div>'
          );
        if (type === 'check')
          return (
            '<div class="field"><label class="chk"><input type="checkbox" data-f="' +
            key +
            '"' +
            (def ? ' checked' : '') +
            '>' +
            label +
            '</label></div>'
          );
        if (type === 'student')
          return (
            '<div class="field">' +
            lab +
            '<select class="sel" data-f="' +
            key +
            '">' +
            studentsByNo()
              .map(function (s) {
                return (
                  '<option value="' +
                  s.id +
                  '"' +
                  (pre.sid === s.id ? ' selected' : '') +
                  '>' +
                  esc(s.no + ' ' + s.name) +
                  '</option>'
                );
              })
              .join('') +
            '</select></div>'
          );
        if (type === 'exam' || type === 'exam0') {
          if (!exs.length)
            return (
              '<div class="field">' +
              lab +
              '<div class="muted" style="font-size:14px">还没有考试数据</div><input type="hidden" data-f="' +
              key +
              '" value=""></div>'
            );
          var sel =
            type === 'exam'
              ? pre.exam || exs[0].id
              : pre.cmp !== null && pre.cmp !== undefined
                ? pre.cmp
                : (function () {
                    var e = examById(pre.exam) || exs[0];
                    var p = prevExam(e);
                    return p ? p.id : '';
                  })();
          return (
            '<div class="field">' +
            lab +
            '<select class="sel" data-f="' +
            key +
            '">' +
            (type === 'exam0' ? '<option value="">不对比</option>' : '') +
            exs
              .map(function (e) {
                return (
                  '<option value="' +
                  e.id +
                  '"' +
                  (sel === e.id ? ' selected' : '') +
                  '>' +
                  esc(e.name) +
                  '</option>'
                );
              })
              .join('') +
            '</select></div>'
          );
        }
        if (type === 'students') {
          return (
            '<div class="field">' +
            lab +
            '<div style="display:flex;gap:6px;margin-bottom:6px"><button type="button" class="btn btn-xs btn-light" data-act="pick-all" data-v="1">全选</button><button type="button" class="btn btn-xs btn-light" data-act="pick-all" data-v="0">全不选</button><span class="muted" style="font-size:12px;margin-left:auto;align-self:center" id="pickCount"></span></div><div class="pick-grid" data-f="' +
            key +
            '">' +
            studentsByNo()
              .map(function (s) {
                return (
                  '<label><input type="checkbox" value="' +
                  s.id +
                  '"' +
                  (!pre.sid || pre.sid === s.id ? ' checked' : '') +
                  ' data-chg="pick-count">' +
                  esc(s.name) +
                  '</label>'
                );
              })
              .join('') +
            '</div></div>'
          );
        }
        return '';
      })
      .join('');
    var ok = AIC.ready();
    UI.modal({
      title: esc(tpl.title),
      body:
        body +
        (S.settings.ai.mask
          ? '<div class="muted" style="font-size:12px">' +
            ICON.lock.replace(
              'width="14" height="14"',
              'width="12" height="12" style="display:inline;vertical-align:-1px"'
            ) +
            ' 学生姓名会先替换成编号再发送，结果回来后自动换回</div>'
          : ''),
      foot:
        '<button class="btn btn-light" data-act="tpl-copy" data-tpl="' +
        tpl.id +
        '">' +
        ICON.copy +
        '复制提示词</button><button class="btn btn-dark" data-act="tpl-go" data-tpl="' +
        tpl.id +
        '"' +
        (ok ? '' : ' title="还没配置 AI 接口，会改为复制提示词"') +
        '>' +
        ICON.spark +
        (ok ? '开始生成' : '生成（复制提示词）') +
        '</button>',
      noFocus: true
    });
    setTimeout(function () {
      UI.chg['pick-count']();
      var f = $('#modalHost [data-f]');
      if (f && f.focus && f.tagName !== 'DIV') f.focus();
    }, 30);
  };

  UI.act['chip-one'] = function (el) {
    $$('button', el.parentNode).forEach(function (b) {
      b.classList.toggle('on', b === el);
    });
  };

  UI.act['pick-all'] = function (el) {
    var v = el.getAttribute('data-v') === '1';
    $$('#modalHost .pick-grid input').forEach(function (i) {
      i.checked = v;
    });
    UI.chg['pick-count']();
  };

  UI.chg['pick-count'] = function () {
    var c = $('#pickCount');
    if (c) c.textContent = '已选 ' + $$('#modalHost .pick-grid input:checked').length + ' 人';
  };

  UI.act['tpl-go'] = function (el) {
    var tpl = tplById(el.getAttribute('data-tpl')),
      v = readTplForm(tpl);
    if (!v) return;
    if (tpl.batch) {
      startBatch(tpl, v);
      return;
    }
    var job = tpl.build(v);
    job.tpl = tpl.id;
    startChat(job);
  };

  UI.act['tpl-copy'] = function (el) {
    var tpl = tplById(el.getAttribute('data-tpl')),
      v = readTplForm(tpl);
    if (!v) return;
    if (tpl.batch) {
      copyPromptModal(batchCombinedPrompt(tpl, v));
      return;
    }
    var job = tpl.build(v);
    copyPromptModal(fullPrompt(job));
  };

  UI.act['copy-prompt'] = function () {
    copyText(UI.modalCtx.text);
  };

  UI.act['ai-stop'] = function () {
    if (AIP.ctrl) AIP.ctrl.abort();
  };

  UI.act['open-chat'] = function (el) {
    AIP.chat = el.getAttribute('data-id');
    UI.go('ai', { chat: AIP.chat });
  };

  UI.act['ai-home'] = function () {
    AIP.chat = null;
    UI.go('ai');
  };

  UI.act['chat-del'] = function () {
    var c = chatById(AIP.chat);
    if (!c) return;
    UI.confirm(
      '删除对话',
      '确定删除「' + esc(c.title) + '」吗？',
      '删除',
      function () {
        S.chats = S.chats.filter(function (x) {
          return x.id !== c.id;
        });
        AIP.chat = null;
        save();
        UI.renderRecent();
        UI.go('ai');
      },
      true
    );
  };

  UI.act['msg-copy'] = function (el) {
    var c = chatById(AIP.chat);
    copyText(c.msgs[+el.getAttribute('data-i')].content);
  };

  UI.act['msg-word'] = function (el) {
    var c = chatById(AIP.chat);
    exportWord(c.title, c.msgs[+el.getAttribute('data-i')].content);
  };

  UI.act['chat-word'] = function () {
    var c = chatById(AIP.chat);
    if (!c) return;
    var md = c.msgs
      .filter(function (m) {
        return m.role === 'assistant' && !m.err;
      })
      .map(function (m) {
        if (m.batch)
          return m.batch.items
            .filter(function (x) {
              return x.text;
            })
            .map(function (x) {
              var s = stuById(x.sid);
              return '### ' + (s ? s.name : '') + '\n\n' + x.text;
            })
            .join('\n\n');
        return m.content;
      })
      .join('\n\n---\n\n');
    exportWord(c.title, md);
  };

  UI.act['msg-save-cmt'] = function (el) {
    var c = chatById(AIP.chat),
      s = stuById(c.sid);
    if (!s) return;
    s.comments.push({
      id: uid('c'),
      text: c.msgs[+el.getAttribute('data-i')].content.trim(),
      date: todayStr(),
      src: 'AI'
    });
    save();
    UI.toast('已保存到 ' + s.name + ' 的评语');
  };

  UI.act['msg-save-rec'] = function (el) {
    var c = chatById(AIP.chat),
      s = stuById(c.sid);
    if (!s) return;
    S.records.push({
      id: uid('r'),
      sid: s.id,
      type: '其他',
      text:
        c.title +
        '：' +
        c.msgs[+el.getAttribute('data-i')].content.replace(/[#*>\x60]/g, '').slice(0, 200),
      date: todayStr()
    });
    save();
    UI.toast('已记到 ' + s.name + ' 的成长记录');
  };

  UI.act['chat-regen'] = function () {
    var c = chatById(AIP.chat);
    if (!c || AIP.busy) return;
    while (c.msgs.length && c.msgs[c.msgs.length - 1].role === 'assistant') c.msgs.pop();
    if (!c.msgs.length) return;
    runChat(c);
  };

  UI.act['chat-retry'] = UI.act['chat-regen'];

  UI.act['chat-copy-prompt'] = function () {
    var c = chatById(AIP.chat);
    if (!c) return;
    copyPromptModal(
      sysPrompt() +
        '\n\n' +
        c.msgs
          .filter(function (m) {
            return m.role === 'user';
          })
          .map(function (m) {
            return m.content;
          })
          .join('\n\n')
    );
  };
}

export { copyPromptModal, renderThread };
