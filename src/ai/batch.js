// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { examById, prevExam, stuById } from '../core/queries.js';
import { Mask } from './mask.js';
import { studentContext, sysPrompt } from './context.js';
import { commentPrompt } from './templates.js';
import { rankMap } from '../core/statistics.js';
import { S } from '../core/state.js';
import { UI, stuAva } from '../ui/workspace.js';
import { AIC } from './providers.js';
import { AIP, busyGuard, chatById } from './session.js';
let view; // Thread rendering and prompt presentation are injected at registration.
import { $, esc, todayStr, uid } from '../core/utils.js';
import { save } from '../core/storage.js';
import { ICON } from '../ui/icons.js';
import { copyText } from '../ui/files.js';

/* ---------- 批量 ---------- */
function batchJobs(tpl, v) {
  if (tpl.id === 'comments')
    return v.students.map(function (sid) {
      var s = stuById(sid);
      return {
        sid: sid,
        prompt: Mask.apply(studentContext(s) + '\n【任务】\n' + commentPrompt(v))
      };
    });
  if (tpl.id === 'parent-batch') {
    var ex = examById(v.exam),
      pe = v.cmp ? examById(v.cmp) : ex ? prevExam(ex) : null;
    if (!ex || !pe || pe === ex) return [];
    var rm = rankMap(ex),
      pm = rankMap(pe);
    return S.students
      .filter(function (s) {
        return rm[s.id] && pm[s.id] && pm[s.id].rank - rm[s.id].rank <= -5;
      })
      .map(function (s) {
        return {
          sid: s.id,
          prompt: Mask.apply(
            studentContext(s) +
              '\n【任务】\n这位同学在「' +
              ex.name +
              '」中比「' +
              pe.name +
              '」退步了 ' +
              (rm[s.id].rank - pm[s.id].rank) +
              ' 名。请写一条给家长的' +
              v.channel +
              '：先肯定孩子的优点，再客观说明变化（不要直接说排名，用各科表现描述），提出 2 条家校配合的具体办法，语气尊重温和，250 字以内。只输出正文。'
          )
        };
      });
  }
  return [];
}

function batchCombinedPrompt(tpl, v) {
  var jobs = batchJobs(tpl, v);
  if (!jobs.length) return '（没有符合条件的学生）';
  var head =
    sysPrompt() +
    '\n\n下面有 ' +
    jobs.length +
    ' 位同学的资料，请逐一完成任务，每位同学用「### 【学生编号】」或「### 姓名」作为小标题分隔。\n\n';
  return (
    head +
    jobs
      .map(function (j, i) {
        return '=== 第 ' + (i + 1) + ' 位 ===\n' + j.prompt;
      })
      .join('\n\n')
  );
}

function startBatch(tpl, v) {
  var jobs = batchJobs(tpl, v);
  if (!jobs.length) {
    UI.toast(tpl.id === 'parent-batch' ? '没有退步 5 名以上的同学' : '请至少选择一位学生');
    return;
  }
  if (!AIC.ready()) {
    view.copyPromptModal(batchCombinedPrompt(tpl, v));
    return;
  }
  if (busyGuard()) return;
  UI.closeModal();
  var title =
    tpl.id === 'comments'
      ? '期末评语 · ' + jobs.length + ' 人'
      : '退步同学家长沟通 · ' + jobs.length + ' 人';
  var c = {
    id: uid('c'),
    title: title,
    date: Date.now(),
    tpl: tpl.id,
    batchOnly: true,
    saveAs: tpl.id === 'comments' ? 'comment' : null,
    msgs: [
      {
        role: 'user',
        show:
          tpl.id === 'comments'
            ? '帮我给 ' +
              jobs.length +
              ' 位同学写期末评语（' +
              v.style +
              '，' +
              v.len +
              '，' +
              v.person +
              '）'
            : '给退步 5 名以上同学的家长写' + v.channel + '（' + jobs.length + ' 人）',
        content: ''
      },
      {
        role: 'assistant',
        content: '',
        batch: {
          kind: tpl.id,
          items: jobs.map(function (j) {
            return { sid: j.sid, prompt: j.prompt, text: '', st: 'wait' };
          })
        }
      }
    ]
  };
  S.chats.unshift(c);
  save(true);
  UI.renderRecent();
  AIP.chat = c.id;
  UI.go('ai', { chat: c.id });
  runBatch(c);
}

function runBatch(c) {
  var m = c.msgs[1],
    items = m.batch.items,
    i = 0;
  AIP.busy = true;
  AIP.ctrl = new AbortController();
  var ctrl = AIP.ctrl;
  view.renderThread($('#main'));
  function next() {
    while (i < items.length && items[i].st === 'done') i++;
    if (i >= items.length || ctrl.signal.aborted) {
      AIP.busy = false;
      items.forEach(function (x) {
        if (x.st === 'run') x.st = 'wait';
      });
      save();
      if (AIP.chat === c.id) view.renderThread($('#main'));
      return;
    }
    var it = items[i];
    it.st = 'run';
    it.text = '';
    if (AIP.chat === c.id) renderBatchList(c);
    AIC.stream(
      [
        { role: 'system', content: sysPrompt() },
        { role: 'user', content: it.prompt }
      ],
      function (d, full) {
        it.text = Mask.restore(full);
        var el = document.getElementById('bt-' + it.sid);
        if (el) el.textContent = it.text;
      },
      ctrl.signal
    )
      .then(function () {
        it.st = 'done';
        it.text = it.text.trim();
        save();
        i++;
        next();
      })
      .catch(function (e) {
        it.st = e.abort ? 'wait' : 'err';
        it.err = e.message;
        save();
        if (e.abort) {
          AIP.busy = false;
          if (AIP.chat === c.id) view.renderThread($('#main'));
          return;
        }
        i++;
        next();
      });
  }
  next();
}

function batchHTML(c, m) {
  var items = m.batch.items,
    done = items.filter(function (x) {
      return x.st === 'done';
    }).length;
  var h =
    '<div class="md" style="padding:14px 16px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><b>' +
    (AIP.busy && AIP.chat === c.id ? '正在生成 ' : '已完成 ') +
    done +
    ' / ' +
    items.length +
    '</b><div class="prog" style="flex:1;margin:0"><i style="width:' +
    Math.round((done / items.length) * 100) +
    '%"></i></div>' +
    (!AIP.busy && done < items.length
      ? '<button class="btn btn-xs btn-dark" data-act="batch-resume">继续生成</button>'
      : '') +
    (m.batch.kind === 'comments' && done
      ? '<button class="btn btn-xs btn-dark" data-act="batch-save-all">全部保存到档案</button>'
      : '') +
    '</div><div id="batchList">' +
    batchItems(c, m) +
    '</div></div>';
  return h;
}

function batchItems(c, m) {
  return m.batch.items
    .map(function (it, k) {
      var s = stuById(it.sid);
      if (!s) return '';
      return (
        '<div class="batch-item"><div class="h">' +
        stuAva(s, 24) +
        esc(s.name) +
        '<span class="grow"></span>' +
        (it.st === 'run'
          ? '<span class="tag blue">生成中</span>'
          : it.st === 'wait'
            ? '<span class="tag gray">排队中</span>'
            : it.st === 'err'
              ? '<span class="tag red" title="' + esc(it.err || '') + '">失败</span>'
              : '') +
        (it.st === 'done'
          ? '<button class="btn btn-xs btn-ghost" data-act="bt-copy" data-k="' +
            k +
            '">' +
            ICON.copy +
            '复制</button>' +
            (m.batch.kind === 'comments'
              ? '<button class="btn btn-xs btn-ghost" data-act="bt-save" data-k="' +
                k +
                '">保存到档案</button>'
              : '')
          : '') +
        '</div>' +
        '<div class="tx" id="bt-' +
        it.sid +
        '">' +
        esc(it.text || (it.st === 'err' ? it.err : '')) +
        '</div></div>'
      );
    })
    .join('');
}

function renderBatchList(c) {
  var el = $('#batchList');
  if (el) el.innerHTML = batchItems(c, c.msgs[1]);
}
export function registerAiBatch(presentation) {
  view = presentation;

  UI.act['batch-resume'] = function () {
    var c = chatById(AIP.chat);
    if (c && !AIP.busy) {
      c.msgs[1].batch.items.forEach(function (x) {
        if (x.st === 'err') x.st = 'wait';
      });
      runBatch(c);
    }
  };

  UI.act['bt-copy'] = function (el) {
    var c = chatById(AIP.chat);
    copyText(c.msgs[1].batch.items[+el.getAttribute('data-k')].text);
  };

  UI.act['bt-save'] = function (el) {
    var c = chatById(AIP.chat),
      it = c.msgs[1].batch.items[+el.getAttribute('data-k')],
      s = stuById(it.sid);
    if (!s) return;
    s.comments.push({ id: uid('c'), text: it.text, date: todayStr(), src: 'AI' });
    it.saved = true;
    save();
    UI.toast('已保存到 ' + s.name + ' 的档案');
  };

  UI.act['batch-save-all'] = function () {
    var c = chatById(AIP.chat),
      n = 0;
    c.msgs[1].batch.items.forEach(function (it) {
      var s = stuById(it.sid);
      if (s && it.st === 'done' && !it.saved && it.text) {
        s.comments.push({ id: uid('c'), text: it.text, date: todayStr(), src: 'AI' });
        it.saved = true;
        n++;
      }
    });
    save();
    UI.toast(n ? '已保存 ' + n + ' 条评语到学生档案' : '都已经保存过了');
  };
}

export { batchCombinedPrompt, batchHTML, startBatch };
