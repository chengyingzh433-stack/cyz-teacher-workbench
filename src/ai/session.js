import { S } from '../core/state.js';
import { UI } from '../ui/workspace.js';

var AIP = {
  tab: 'rec',
  chat: null,
  ctrl: null,
  busy: false,
  ctx: { cls: false, sid: '', exam: '' }
};
function chatById(id) {
  for (var i = 0; i < S.chats.length; i++) if (S.chats[i].id === id) return S.chats[i];
  return null;
}
function busyGuard() {
  if (AIP.busy) {
    UI.toast('上一个任务还在生成，等它写完或先点「停止」');
    return true;
  }
  return false;
}

export { AIP, busyGuard, chatById };
