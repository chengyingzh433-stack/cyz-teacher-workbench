// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { UI } from './workspace.js';

/* 下载工具 */
function downloadFile(name, content, type) {
  var blob =
    content instanceof Blob
      ? content
      : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

function copyText(t) {
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      UI.toast('已复制');
    } catch (e) {
      UI.toast('复制失败，请手动选择复制');
    }
    ta.remove();
  }
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(t).then(function () {
      UI.toast('已复制');
    }, fallback);
  } else fallback();
}

export { copyText, downloadFile };
