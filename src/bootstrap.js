// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { S, replaceState } from './core/state.js';
import { Store, load, save } from './core/storage.js';
import { defaultState } from './core/schema.js';
import { showWelcome } from './features/onboarding.js';
import { UI } from './ui/workspace.js';

function boot() {
  replaceState(load());
  if (!S || !S.settings.onboarded) {
    replaceState(defaultState());
    showWelcome();
    return;
  }
  save(); // Persist newly assigned character IDs without changing the backup schema.
  UI.shell();
  var h = (location.hash || '').replace('#/', '');
  UI.go(UI.pages[h] ? h : 'class');
  if (!Store.ok())
    setTimeout(function () {
      UI.toast('浏览器禁止了本地存储，关闭页面前请到设置里导出备份');
    }, 800);
}
export function registerBootstrap() {
  window.addEventListener('hashchange', function () {
    var h = (location.hash || '').replace('#/', '');
    if (S && S.settings.onboarded && UI.pages[h] && h !== UI.page) UI.go(h);
  });
}

export { boot };
