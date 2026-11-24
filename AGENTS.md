# AGENTS.md — 工程防错与验收护栏

本仓库为「cyz 的教师工作台」Electron + Node.js 24 原生 `node:sqlite` 桌面端项目。任何改动在交付前必须跑通检查并留存真实截图，不允许仅凭口头“做好了”交差。

## 规则与自动拦截对照表

| 规则 | 由什么拦住 |
| --- | --- |
| 交差前跑通类型检查、单元测试与真实桌面端 E2E 流程并附截图 | `npm run typecheck && npm test && npm run test:e2e`（22 场景，截图输出至 `test-results/prove-it/`） |
| 物理题库及钥匙串被动查询严禁调用 `safeStorage.isAsyncEncryptionAvailable()`，OCR 面板必须懒挂载 | `tests/qbank-storage.test.ts` + `tests/e2e-electron.mjs` 零异步钥匙串调用断言 |
| 物理题库不引入 C++ 原生依赖，仅使用 `node:sqlite`，且 `mathml2omml` 配置 `asarUnpack` | `electron-builder.yml` + `package.json`（`pack:win` 固定 `--win zip --x64`） |
| 新增/修改主题时，主进程与渲染进程共享单一清单且 `tokens.css` 具备对应样式块 | 单一数据源 `src/shared/theme-meta.ts` + `tests/themes.test.ts` |
| SQLite 嵌套事务不得触发 `cannot start a transaction within a transaction` | `src/main/db.ts` 可重入 `SAVEPOINT` 事务 + `tests/vault-sqlite.test.ts` |
| `workbench-asset://` 资源（6 张 WebP 精灵与本地答卷照片）必须可被渲染进程 `fetch` | `src/renderer/index.html` CSP `connect-src` + `tests/e2e-electron.mjs` HTTP 200 校验 |
| macOS 原生 `vibrancy` 浅色真透明层禁止叠加 `backdrop-filter: saturate(>100%)`（避免 Skia 预乘色带） | `tests/themes.test.ts` 自动拦截 + 实机截屏人工核验 |
| Windows 便携包必须显式构建 `x64` 架构（禁止在 Apple Silicon Mac 上误打成 `win-arm64`） | `package.json` `"pack:win"` 固定 `--win zip --x64` |
| API Key 绝不得明文落盘或写入可共享的 Vault 资料库目录 | `tests/vault-sqlite.test.ts` Keychain 测试 |
| 智学网伴侣保持独立净室实现，绝不复制 GPL-3.0 外部源码；自动模式仅在置信度达标且零红线/零 OCR 冲突时经可自选间隔且按 Esc 急停的倒计时提交，严禁无拦截盲交 | 人工审查 `src/main/zhixue-view.ts` 与 `ZhixueCompanion.tsx` + E2E 实测 |
