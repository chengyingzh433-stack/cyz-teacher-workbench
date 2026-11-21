import { AppError, copy, type Snapshot } from '../../app/model';
import { inspectImage, type AssetFiles } from '../assets';
import { points } from '../grading/score-policy';
import { buildExamReport, rateText, statusLabels, weightedPoints, type ExamReport } from './index';
export type ExportOptions = {
  identified: boolean;
  includeImages: boolean;
  saveLabel: string;
  exportedAt: string;
};
const MAX_HTML_BYTES = 128 * 1024 ** 2;
export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
function csvCell(value: string | number, forceText = false): string {
  let text = String(value);
  // Quote every cell. Text prefixes block spreadsheet formulas, including leading controls/space.
  if (
    typeof value === 'string' &&
    (forceText || /^[\s\u0000-\u001f\ufeff]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))
  )
    text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function encodeGradeCsv(report: ExamReport, options: ExportOptions): string {
  const headers = [
    '学生',
    '编号',
    ...report.items.flatMap((i) => [`第 ${i.label} 题确认分`, `第 ${i.label} 题状态`]),
    '已确认小计',
    '已确认部分满分',
    '完整总分',
    '整卷满分',
    '参测状态',
    '统计方案',
    '工作区保存状态',
    '导出时间',
  ];
  const rows = [headers.map((h) => csvCell(h)).join(',')];
  report.rows.forEach((row, index) => {
    const values: (string | number)[] = [
      options.identified ? row.name : `学生 ${index + 1}`,
      options.identified ? row.rosterNo : '',
      ...row.cells.flatMap((c) => [
        c.scoreUnits === null ? '' : points(c.scoreUnits),
        statusLabels[c.status],
      ]),
      row.cells.some((c) => c.status === 'confirmed') ? points(row.confirmedUnits) : '',
      points(row.confirmedMaxUnits),
      row.totalUnits === null ? '' : points(row.totalUnits),
      points(report.maxUnits),
      row.attendance?.status === 'absent' ? '缺考' : '参测/未标记缺考',
      report.plan ? `v${report.plan.version}` : '未映射',
      options.saveLabel,
      options.exportedAt,
    ];
    rows.push(
      values.map((v, i) => csvCell(v, i === 1 && options.identified && !!row.rosterNo)).join(','),
    );
  });
  return '\ufeff' + rows.join('\r\n');
}
function table(headers: string[], rows: string[][]) {
  return `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function meanPoints(value: number | null) {
  return value === null ? '暂无完整成绩' : (value / 100).toFixed(2);
}
function bytesToData(bytes: Uint8Array, mime: string) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return `data:${mime};base64,${btoa(binary)}`;
}
export async function encodeReportHtml(
  snapshot: Snapshot,
  files: AssetFiles,
  examId: string,
  planId: string | undefined,
  options: ExportOptions,
): Promise<string> {
  if (options.includeImages && !options.identified)
    throw new AppError('EXPORT', '匿名汇总不导出答卷图片；图片可能包含身份信息');
  const s = copy(snapshot),
    blobs = new Map(files),
    report = buildExamReport(s, examId, planId),
    g = s.data.grading;
  const title = options.identified ? `${report.className} · ${report.exam.title}` : '测验分析报告';
  const gradeRows = report.rows.map((row, index) => [
    escapeHtml(
      options.identified ? `${row.name} · ${row.rosterNo || '无编号'}` : `学生 ${index + 1}`,
    ),
    ...row.cells.map((cell, i) => {
      const text =
        cell.scoreUnits === null ? statusLabels[cell.status] : `${points(cell.scoreUnits)} 分`;
      return options.identified && cell.submission
        ? `<a href="#answer-${index}-${i}">${escapeHtml(text)}</a>`
        : escapeHtml(text);
    }),
    row.cells.some((c) => c.status === 'confirmed') ? escapeHtml(points(row.confirmedUnits)) : '—',
    escapeHtml(points(row.confirmedMaxUnits)),
    row.totalUnits === null ? '未形成完整总分' : escapeHtml(points(row.totalUnits)),
  ]);
  const topicRows = report.topics.map((t) => [
    escapeHtml(t.name),
    escapeHtml(rateText(t.earnedWeighted, t.possibleWeighted)),
    escapeHtml(weightedPoints(t.earnedWeighted)),
    escapeHtml(weightedPoints(t.possibleWeighted)),
    String(t.itemCount),
    String(t.studentCount),
    t.itemCount < 3 || t.studentCount < 5 ? '覆盖较少，仅供本次测验参考' : '仅反映本次测验',
  ]);
  const mappingRows = (report.plan?.mappings || []).map((m) => {
    const item = report.items.find((i) => i.id === m.itemId)!;
    return [
      escapeHtml(item.label),
      escapeHtml(item.scoringUnits.find((u) => u.id === m.scoringUnitId)!.label),
      escapeHtml(
        m.allocations
          .map(
            (a) =>
              `${g.knowledgePoints.find((k) => k.id === a.knowledgeId)!.name} ${a.weightBps / 100}%`,
          )
          .join('；'),
      ),
    ];
  });
  const assets = new Map(g.assets.map((a) => [a.id, a])),
    rubrics = new Map(g.rubrics.map((r) => [r.id, r]));
  const details: string[] = [];
  let embeddedBytes = 0,
    detailBytes = 0;
  function appendDetail(target: string[], html: string) {
    detailBytes += new TextEncoder().encode(html).length;
    if (detailBytes > 100 * 1024 ** 2)
      throw new AppError('EXPORT_LIMIT', '报告明细超过 100 MiB，请选择无图或匿名汇总报告');
    target.push(html);
  }

  async function imageBlock(assetId: string, label: string) {
    if (!options.includeImages) return '';
    const asset = assets.get(assetId);
    if (!asset) throw new AppError('EXPORT', '图片引用缺失，未生成报告');
    const blob = blobs.get(asset.hash);
    if (!blob) throw new AppError('EXPORT', '附件缺失，未生成报告');
    embeddedBytes += asset.bytes;
    if (embeddedBytes > 64 * 1024 ** 2)
      throw new AppError('EXPORT_LIMIT', '报告累计嵌图超过 64 MiB，请选择无图报告或完整 ZIP 备份');
    const inspected = await inspectImage(blob);
    if (
      inspected.hash !== asset.hash ||
      inspected.width !== asset.width ||
      inspected.height !== asset.height ||
      inspected.mime !== asset.mime
    )
      throw new AppError('EXPORT', '图片与资产清单不一致');
    const uri = bytesToData(new Uint8Array(await inspected.blob.arrayBuffer()), inspected.mime);
    return `<figure><figcaption>${escapeHtml(label)}</figcaption><img alt="${escapeHtml(label)}" src="${uri}"></figure>`;
  }
  if (options.identified) {
    for (let r = 0; r < report.rows.length; r++) {
      const row = report.rows[r];
      for (let c = 0; c < row.cells.length; c++) {
        const cell = row.cells[c];
        if (!cell.submission) continue;
        const submission = cell.submission,
          decision = cell.decision,
          rubric = decision ? rubrics.get(decision.rubricVersionId) : undefined;
        const imageIds = new Set(submission.assetIds);
        for (const a of submission.assetIds) {
          const original = assets.get(a)?.originalId;
          if (original) imageIds.add(original);
        }
        let images = '';
        for (const a of imageIds)
          images += await imageBlock(a, assets.get(a)?.originalId ? '答卷派生图' : '答卷原件');
        const scores =
          decision && cell.status === 'confirmed'
            ? table(
                ['评分点', '确认分', '依据'],
                decision.scores.map((score) => [
                  escapeHtml(rubric!.criteria.find((x) => x.id === score.criterionId)!.description),
                  escapeHtml(points(score.units)),
                  escapeHtml(score.reason),
                ]),
              )
            : `<p>${escapeHtml(statusLabels[cell.status])}，不导出未确认草稿分数。</p>`;
        appendDetail(
          details,
          `<section id="answer-${r}-${c}"><h3>${escapeHtml(row.name)} · ${escapeHtml(row.rosterNo)} · 第 ${escapeHtml(cell.item.label)} 题</h3><p>作答版本 ${submission.version} · ${escapeHtml(statusLabels[cell.status])}</p><p>作答 ID：${escapeHtml(submission.id)}${cell.status === 'confirmed' && decision ? ` · 教师决定 ID：${escapeHtml(decision.id)} · 细则 v${rubric!.version}` : ''}</p><pre>${escapeHtml(submission.text || '无文字转录')}</pre>${scores}${cell.status === 'confirmed' && decision ? `<p>教师说明：${escapeHtml(decision.reason)}</p>` : ''}${images}</section>`,
        );
      }
    }
  }
  const questions: string[] = [];
  if (options.identified)
    for (const item of report.items) {
      let refs = '';
      for (const a of item.referenceAssetIds) refs += await imageBlock(a, '参考图（非学生作答）');
      const usedRubrics = [
        ...new Set(
          report.rows.flatMap((row) =>
            row.cells
              .filter((c) => c.item.id === item.id && c.status === 'confirmed')
              .map((c) => c.decision!.rubricVersionId),
          ),
        ),
      ].map((id) => rubrics.get(id)!);
      appendDetail(
        questions,
        `<section><h3>第 ${escapeHtml(item.label)} 题 · ${points(item.maxUnits)} 分</h3><pre>${escapeHtml(item.prompt)}</pre>${usedRubrics
          .map(
            (r) =>
              `<h4>采用细则 v${r.version}</h4><pre>${escapeHtml(r.referenceAnswer)}</pre>${table(
                ['评分点', '上限', '步长'],
                r.criteria.map((c) => [
                  escapeHtml(c.description),
                  points(c.maxUnits),
                  points(c.stepUnits),
                ]),
              )}`,
          )
          .join('')}${refs}</section>`,
      );
    }
  const provenance: string[] = [];
  if (options.identified) {
    const rowIndices = new Map(report.rows.map((row, index) => [row.membershipId, index]));
    const itemIndices = new Map(report.items.map((item, index) => [item.id, index]));
    for (const topic of report.topics) {
      const entries: string[] = [];
      for (const evidence of topic.evidence) {
        const rowIndex = rowIndices.get(evidence.membershipId)!,
          itemIndex = itemIndices.get(evidence.itemId)!,
          row = report.rows[rowIndex],
          item = report.items[itemIndex];
        appendDetail(
          entries,
          `<tr><td>${escapeHtml(row.name)} · ${escapeHtml(row.rosterNo)}</td><td>${escapeHtml(item.label)} · ${escapeHtml(item.scoringUnits.find((u) => u.id === evidence.scoringUnitId)!.label)}</td><td>${evidence.weightBps / 100}%</td><td>${weightedPoints(evidence.earnedWeighted)} / ${weightedPoints(evidence.possibleWeighted)}</td><td><a href="#answer-${rowIndex}-${itemIndex}">作答与细则 v${rubrics.get(evidence.rubricVersionId)!.version}</a></td></tr>`,
        );
      }
      provenance.push(
        `<section><h3>${escapeHtml(topic.name)} · 统计依据</h3><table><thead><tr><th>学生</th><th>题目 / 小题</th><th>权重</th><th>加权得分 / 可得分</th><th>确认依据</th></tr></thead><tbody>${entries.join('')}</tbody></table></section>`,
      );
    }
  }
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>body{font:15px/1.6 system-ui,sans-serif;color:#25332f;max-width:1200px;margin:24px auto;padding:20px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #ccc;padding:8px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}img{max-width:100%;height:auto}section{border-top:1px solid #ddd;margin-top:24px}a{color:#315e52}@media print{body{max-width:none;margin:0;padding:0}thead{display:table-header-group}img{max-height:80vh;object-fit:contain}tr{break-inside:avoid}}</style></head><body><h1>${escapeHtml(title)}</h1><p>导出时间：${escapeHtml(options.exportedAt)} · ${escapeHtml(options.saveLabel)} · 知识点方案（按当前有效成绩计算） ${report.plan ? `v${report.plan.version}` : '未配置'}</p><p>${options.identified ? '含学生身份与作答文字，请按实际范围使用。' : '匿名汇总：以本报告学生代号显示，不输出学生姓名、编号、内部成员 ID 字段、答卷文字或图片；代号不是跨报告身份。'} ${options.includeImages ? '图片已内嵌，含原件与当前作答图片。' : '无图报告，不能回看原卷图片。'}</p><p>正式分只取最新作答的最新教师决定；缺考、未录入、待处理和未确认不计为零分。已确认小计不是完整总分。统计范围为当前在班成员及本场有历史记录的成员；名单变化会影响未录人数。</p><p>整卷满分 ${points(report.maxUnits)}，完整成绩 ${report.completeCount} 人，完整成绩均分 ${meanPoints(report.averageUnits)}。当前确认 ${report.confirmedCount} 份题目作答，未映射可得分 ${points(report.unmappedUnits)} / 已确认部分可得分 ${points(report.confirmedPossibleUnits)}。</p><h2>确认成绩表</h2>${table(['学生', ...report.items.map((i) => `第 ${i.label} 题`), '已确认小计', '已确认部分满分', '完整总分'], gradeRows)}<h2>本次测验知识点得分率</h2><p>分子和分母使用同一批已确认作答及同一知识点权重；分母为零时不生成比例。</p>${table(['知识点', '得分率', '加权得分', '加权可得分', '题量', '有效人数', '范围说明'], topicRows)}<h2>知识点映射</h2>${table(['题号', '小题', '权重'], mappingRows)}${options.identified ? `<h2>知识点统计依据</h2>${provenance.join('')}<h2>试题、细则与参考图</h2>${questions.join('')}<h2>作答与确认依据</h2>${details.join('')}` : ''}<p>这是离线阅读报告，不是完整工作区备份；报告不包含可恢复的全部历史和附件。</p></body></html>`;
  if (new TextEncoder().encode(html).length > MAX_HTML_BYTES)
    throw new AppError('EXPORT_LIMIT', '报告超过 128 MiB，请改用无图报告或完整 ZIP 备份');
  return html;
}
export function downloadReport(text: string, type: 'csv' | 'html') {
  const blob = new Blob([text], {
      type: type === 'csv' ? 'text/csv;charset=utf-8' : 'text/html;charset=utf-8',
    }),
    url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cyz测验分析-${new Date().toISOString().replace(/[:.]/g, '-')}.${type}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
