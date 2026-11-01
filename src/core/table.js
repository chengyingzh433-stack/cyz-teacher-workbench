// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE

function csvCell(v) {
  v = v == null ? '' : String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function toCSV(rows) {
  return (
    '﻿' +
    rows
      .map(function (r) {
        return r.map(csvCell).join(',');
      })
      .join('\r\n')
  );
}

function parseTable(text, keepEmpty) {
  // 支持 Excel 复制（Tab 分隔）与 CSV；正确处理带引号、带换行的单元格
  text = String(text || '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n');
  var d = text.indexOf('\t') >= 0 ? '\t' : ',';
  var rows = [],
    row = [],
    cur = '',
    q = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"' && cur.trim() === '') {
      q = true;
      cur = '';
      continue;
    }
    if (ch === d) {
      row.push(cur.trim());
      cur = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cur.trim());
      rows.push(row);
      row = [];
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur !== '' || row.length) {
    row.push(cur.trim());
    rows.push(row);
  }
  function blank(r) {
    return r.every(function (c) {
      return c === '';
    });
  }
  while (rows.length && blank(rows[rows.length - 1])) rows.pop();
  // 粘贴成绩时保留空行（空单元格），否则后面的分数会错位
  return keepEmpty
    ? rows
    : rows.filter(function (r) {
        return !blank(r);
      });
}

export { parseTable, toCSV };
