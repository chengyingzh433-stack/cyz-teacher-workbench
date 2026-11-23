# 技术选型与架构决策记录：物理题库融入教师工作台（v1.3+）

- **决策日期**：2026-11-23
- **选定方案**：**方案 A — 原生融合进 `cyz-teacher-workbench-web`（统一 React 19 + Tailwind CSS v4 + Radix UI + 7 套主题 + `node:sqlite` 零原生编译）**
- **参考源快照**：`physics-question-bank`（分支 `codex/beta14-polish-fixes`，commit `e6e3751`，仅作只读参考，不再维护双仓库）

## 1. 背景与核心目标

1. **单一主仓库治理**：`cyz-teacher-workbench-web` 作为唯一主产品与主仓库；原独立物理题库项目已完成真题测试与 4 项关键问题修复并保留为只读参考，避免未来维护两套 Electron 壳、两套打包脚本与两套数据目录。
2. **零原生编译红线**：维持工作台现有 Mac 本地直出 Windows x64 绿色包（`pack:win`）与零 C++ 原生依赖特性，**弃用**旧题库的 `better-sqlite3`，全部切换至 Electron 内置 Node 24 的 `node:sqlite`。
3. **净室瘦身迁入**：旧题库存在约 65%–70% 的冗余外围与防御性样板（独立自动更新器、存储迁移并发锁、Mantine 7 + React Router 外壳、跨层重复校验等）。迁入时直接丢弃冗余外围，仅抽取核心领域模型、专业公式/排版引擎与真题验证通过的工作流。
4. **先稳底座、再做融合**：在迁入题库前，先完成工作台自身的第一、二档轻量瘦身（消除预设/校验重复、清理死代码、拆分 4 个超 700–1,400 行单文件），跑通全套 `/prove-it` 验证并建立干净的本地 Git 还原点。

## 2. 关键架构决策

| 维度 | 最终决策 | 理由与边界 |
| --- | --- | --- |
| **UI 框架与换肤** | 全面统一为工作台 `React 19 + Tailwind CSS v4 + Radix UI + Lucide + 7 套内置主题` | 彻底移除 Mantine 7、Tabler 图标与 `react-router-dom`，视觉、弹窗、暗色/毛玻璃主题全站一致；交互确认统一走 Radix `ConfirmDialog`，禁用 `window.confirm` |
| **专业富文本与导出引擎** | 保留并复用成熟专业库：`@tiptap/react@3.32`（原生支持 React 19）、`mathlive`、`pdfjs-dist`、`docx-preview`、`docx`、`mathml2omml`、`pdf-lib`、`pptxgenjs`、`NotoSansSC-Regular.ttf` | 题库的数学公式（OMML 原生 Word 公式）、PDF 矢量选字/切图、PPT 组卷与中文 PDF 导出是核心护城河，成熟引擎不可重造。`mathml2omml`（LGPL）需配置 `asarUnpack` 并在 `THIRD_PARTY_NOTICES.txt` 中声明 |
| **导航信息架构** | 新增「全部功能中心（Apps Hub）」总览页 + 左侧边栏支持「自选常用项置顶/取消置顶」 | 模块增多后既保持侧边栏精简（类似校园/教务门户），又能让教师一键直达高频模块；置顶列表持久化到 `preferences.json` |
| **数据存储与备份** | 题库独立子库落盘于 `<vault>/question-bank/question-bank.sqlite` + `<vault>/question-bank/projects/` | 与班级主库 `workbench.sqlite` 物理隔离（题库天然跨班级全局复用），同时随 Vault 一键切换、同步与 `VACUUM INTO` 备份；文件访问复用 `workbench-asset://question-bank/...`。老旧测试目录不做自动迁移向导 |
| **SQLite 并发与事务** | `node:sqlite` + `DELETE` 日志模式 + `withTransaction` 可重入 `SAVEPOINT` | 兼容坚果云 / iCloud 同步，杜绝嵌套事务报错 |
| **AI 与 OCR 体系** | 统一接入工作台 `MainAiProxy` + 零弹窗 `AiKeychainStore`；可选保留 Doc2X OCR 插件 | 题库图片转文字/公式识别优先复用工作台已配置的视觉/通用模型，不重复配 Key；Doc2X 仅作可选扩展，**严禁被动触发 macOS Keychain 弹窗**（被动查询仅用同步 `safeStorage.isEncryptionAvailable()`），且始终由教师手动触发识别 |
| **质量门禁** | 统一执行 `AGENTS.md` + `/prove-it` 标准 | 每次里程碑必须通过 `npm run typecheck && npm test && npm run test:e2e` 并附带真实桌面截图验收 |

## 3. 分阶段交付路线

1. **前置阶段（底座瘦身与还原点）**：
   - 清理工作台内重复预设与重复守卫函数、移除死代码与无效 PNG 开发回退路径；
   - 拆分 `homeroom.ts`、`GradingWorkbenchTab.tsx`、`ExamCenter.tsx`、`App.tsx` 为职责清晰的模块化文件（零功能与行为变化）；
   - 跑通全套 `typecheck + 单测 + 16 场景真实桌面端 E2E`，生成新本地还原点。
2. **合并 Phase 1（核心题库闭环 + 功能中心导航）**：
   - 上线「全部功能中心」页面与可自定义左侧常驻快捷栏；
   - 落地 `<vault>/question-bank/` 独立 `node:sqlite` 子库与静态资源协议路由；
   - 净室重写并接入 4 大核心闭环：**录题（含连续录题与 PDF 智能选字去空格/小图合理宽占比/无跳动裁剪）** → **校对编辑（TipTap + MathLive + 原图对照 + 历史版本）** → **题库检索与文件夹管理** → **组卷篮导出（Word 原生公式 / PDF / PPTX）**；
   - 打通统一 AI 配置与可选 Doc2X OCR（零 Keychain 弹窗）。
3. **合并 Phase 2（智能增强与跨模块联动）**：
   - 阶段 3 校对体验增强与教师确认式 AI 知识点/配图建议；
   - 题库与「统一考试中心」双向联动（从题库组卷直接建考、从试卷薄弱知识点反查同类练习题）；
   - 视需要整合旧版大题切图/试卷模板能力至功能中心。

## 4. 放弃的备选方案

- **方案 B（双窗口/子进程挂载旧题库）**：保留两套 UI 与两套依赖（含 `better-sqlite3` 原生编译），导致安装包翻倍、主题割裂、跨平台 Windows 打包重新受阻，明确放弃。
- **方案 C（先在旧题库仓库大重构再合并）**：旧仓库即将退役，在旧壳上重写 Mantine / `better-sqlite3` 属于纯双倍返工，明确放弃。
