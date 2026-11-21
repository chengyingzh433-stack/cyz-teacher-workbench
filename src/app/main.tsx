import { createRoot } from 'react-dom/client';
import { Component, type ReactNode } from 'react';
import { App } from './App';
import '../ui/styles.css';
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="empty">
        <h1>界面暂时无法显示</h1>
        <p>没有执行清空资料。请重新打开页面；如仍出现此提示，请保留原 HTML 与备份，并反馈错误。</p>
        <button onClick={() => location.reload()}>重新打开</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <Boundary>
    <App />
  </Boundary>,
);
