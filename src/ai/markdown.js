// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { esc } from '../core/utils.js';
import { downloadFile } from '../ui/files.js';

/* ---------- Markdown 渲染（够用版） ---------- */
function mdInline(s) {
  return s
    .replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
}

function mdToHtml(md) {
  var lines = esc(md || '').split('\n'),
    out = [],
    list = null,
    para = [],
    tbl = null;
  function flushP() {
    if (para.length) {
      out.push('<p>' + mdInline(para.join('<br>')) + '</p>');
      para = [];
    }
  }
  function flushL() {
    if (list) {
      out.push(
        '<' +
          list.t +
          '>' +
          list.items
            .map(function (x) {
              return '<li>' + mdInline(x) + '</li>';
            })
            .join('') +
          '</' +
          list.t +
          '>'
      );
      list = null;
    }
  }
  function flushT() {
    if (!tbl) return;
    var rows = tbl.filter(function (r) {
      return !/^\s*\|?\s*:?-{2,}/.test(r);
    });
    out.push(
      '<table>' +
        rows
          .map(function (r, i) {
            var cells = r
              .replace(/^\s*\|/, '')
              .replace(/\|\s*$/, '')
              .split('|');
            return (
              '<tr>' +
              cells
                .map(function (c) {
                  return (
                    (i === 0 ? '<th>' : '<td>') + mdInline(c.trim()) + (i === 0 ? '</th>' : '</td>')
                  );
                })
                .join('') +
              '</tr>'
            );
          })
          .join('') +
        '</table>'
    );
    tbl = null;
  }
  lines.forEach(function (ln) {
    var m;
    if (/^\s*\|.*\|\s*$/.test(ln)) {
      flushP();
      flushL();
      (tbl = tbl || []).push(ln);
      return;
    } else flushT();
    if ((m = ln.match(/^(#{1,4})\s+(.*)$/))) {
      flushP();
      flushL();
      var lv = Math.min(3, m[1].length);
      out.push('<h' + lv + '>' + mdInline(m[2]) + '</h' + lv + '>');
      return;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(ln)) {
      flushP();
      flushL();
      out.push('<hr>');
      return;
    }
    if ((m = ln.match(/^\s*[-*•]\s+(.*)$/))) {
      flushP();
      if (!list || list.t !== 'ul') {
        flushL();
        list = { t: 'ul', items: [] };
      }
      list.items.push(m[1]);
      return;
    }
    if ((m = ln.match(/^\s*\d+[.、)]\s+(.*)$/))) {
      flushP();
      if (!list || list.t !== 'ol') {
        flushL();
        list = { t: 'ol', items: [] };
      }
      list.items.push(m[1]);
      return;
    }
    if ((m = ln.match(/^\s*&gt;\s?(.*)$/))) {
      flushP();
      flushL();
      out.push('<blockquote>' + mdInline(m[1]) + '</blockquote>');
      return;
    }
    if (!ln.trim()) {
      flushP();
      flushL();
      return;
    }
    flushL();
    para.push(ln);
  });
  flushP();
  flushL();
  flushT();
  return out.join('');
}

function exportWord(title, md) {
  var html =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>' +
    esc(title) +
    '</title>' +
    '<style>body{font-family:"宋体",SimSun,"Songti SC",serif;font-size:12pt;line-height:1.8}h1{font-size:18pt;text-align:center}h2{font-size:15pt}h3{font-size:13pt}table{border-collapse:collapse;margin:6pt 0}td,th{border:1px solid #999;padding:4pt 8pt}blockquote{color:#555;border-left:3px solid #ccc;padding-left:8pt}</style></head><body><h1>' +
    esc(title) +
    '</h1>' +
    mdToHtml(md) +
    '</body></html>';
  downloadFile(
    String(title).replace(/[\\\/:*?"<>|]/g, '_') + '.doc',
    '﻿' + html,
    'application/msword'
  );
}

export { exportWord, mdToHtml };
