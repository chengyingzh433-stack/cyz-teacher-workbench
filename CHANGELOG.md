# 开发日志（CHANGELOG）

本文档记录 `cyz-teacher-workbench-web` 的架构演进、版本交付与真实完成边界。未经过真机/外网账号实测的能力均明确标出，不混淆“已完成底座”与“待联网实测项”。

---

## 1.0.0 独立桌面端架构与工作室级 UI 全面重构 · 2026-11-21

依据甲方审查与正式技术选型记录（[decisions-desktop-tech-stack.md](docs/decisions-desktop-tech-stack.md)），彻底抛弃 16.9 MB 单文件 HTML + 浏览器 IndexedDB 的旧形态，重构为 **Electron 45 + Node.js 24 原生 `node:sqlite` + React 19 + Tailwind CSS v4 + Apache ECharts 6** 独立跨平台桌面客户端（首选 macOS `.dmg`，同时从 macOS 零原生依赖交叉构建 Windows 绿色版 `.zip`）。

### 核心架构重构
- **Obsidian 式本地资料库（Vault）+ 原生单文件 SQLite**（[db.ts](src/main/db.ts)、[vault.ts](src/main/vault.ts)、[photo-store.ts](src/main/photo-store.ts)）：
  - 所有班级、花名册、排座方案、统一考试成绩、手写批阅细则与记录统一存于资料库目录（默认 `~/Documents/cyz教师工作台`）的 `workbench.sqlite`（`DELETE` 日志模式，适配 iCloud / 坚果云单文件同步），答卷照片按内容哈希直存磁盘 `photos/<examId>/<sha256>.<ext>` 彻底告别内存膨胀。
  - 新增 `withTransaction` 可重入 `SAVEPOINT` 嵌套事务保护、**软删除回收站**（可随时恢复；彻底清空时自动回收磁盘孤立照片）与**成绩修改留痕（`score_audit_logs`）**。
- **系统钥匙串加密 + 主进程零跨域 AI 代理**（[keychain.ts](src/main/keychain.ts)、[ai-proxy.ts](src/main/ai-proxy.ts)）：
  - API Key 经 Electron `safeStorage` 原生系统钥匙串加密后存于 `userData/ai-config.json`，绝不写入可共享的 Vault 文件夹；所有大模型 / VLM / HTTP OCR 请求由主进程发起，彻底根除浏览器 CORS 拦截。
  - 保留并提纯两段防幻觉盲识图引擎（[ai-engine.ts](src/shared/ai-engine.ts)），新增**隐私透明只读学情对话抽屉**（仅汇总统计指标，不外发学生姓名/学号）。
- **独立净室内置「智学网 / 通用网阅伴侣」**（[zhixue-view.ts](src/main/zhixue-view.ts)、[ZhixueCompanion.tsx](src/renderer/features/zhixue/ZhixueCompanion.tsx)）：
  - 采用 Electron 原生 `WebContentsView` 与独立持久化会话分区（`persist:zhixue`），持久保持智学网 / 七天网络 / 好分数登录态，免装浏览器扩展；支持原生 `capturePage()` 截屏送入统一评分细则与 AI 引擎，并由教师显式触发填入打分框（绝不盲目自动提交）。

### 前端美学与深度业务打通
- **工作室级设计语言 + 可扩展 Design Token 主题引擎**（[tokens.css](src/renderer/themes/tokens.css)、[themes/index.ts](src/renderer/themes/index.ts)）：
  - 首发精雕双旗舰主题：`studio-light`（温润米纸 × 雾面黑板松林绿）与 `studio-dark`（深夜工作室炭灰 × 柔和翡翠绿），支持侧栏一键切换并同步更新矢量教室与 ECharts 配色，预留多主题扩展接口。
  - 新增全局 `⌘K / Ctrl+K` 命令面板（[CommandPalette.tsx](src/renderer/components/ui/CommandPalette.tsx)），毫秒级直达任意学生成长档案、考试与主题切换。
- **自适应矢量像素教室 + WebP 资产瘦身 81.5%**（[VectorClassroom.tsx](src/renderer/features/classroom/VectorClassroom.tsx)、[SpriteArt.tsx](src/renderer/features/classroom/SpriteArt.tsx)）：
  - 废除拉伸变形的 `room.png`，重绘支持 `1×1` 至 `12×16` 任意尺寸零变形缩放的矢量建筑教室（木地板纹理、日光窗影、橡木框黑板、讲台与过道标线），保留 29 位像素角色与课桌并转为 WebP 外置资产（`9.99 MB → 1.85 MB`）。
  - 打通**按考试成绩一键智能排座**（蛇形均衡 / 强弱帮扶 / 高分靠前 / 小组均衡）与**点击任意座位直开学生成长档案抽屉**（ECharts 个人得分 vs 班级均分趋势曲线 + 历史答卷缩略图）。
- **统一考试中心（原成绩册 + 主观题阅卷深度合一）**（[ExamCenter.tsx](src/renderer/features/exams/ExamCenter.tsx)、[GradingWorkbenchTab.tsx](src/renderer/features/grading/GradingWorkbenchTab.tsx)）：
  - 同一场考试下整合「成绩分析与明细」与「手写阅卷与讲评」，确认手写题得分后**自动实时回填**至考试总表并参与 ECharts 分数段柱状图点击筛选与多考趋势分析。

### 本轮验证记录
- `npm run typecheck`：主进程 + 渲染进程双严格 TypeScript 检查 0 错误。
- `npm test`：**10 / 10** 项核心单元测试全部通过（含 Vault + `node:sqlite` 全链路、嵌套事务 `SAVEPOINT`、系统钥匙串加密、AI 两段防幻觉与 OCR 交叉标黄、P0 成绩单公式与多行表头识别）。
- **Electron 45 实机启动与 9 场景视觉截图验收**：在真实 Electron 生产构建包中逐一验证欢迎页、6 张 WebP 像素精灵 `200 OK` 加载、32 人一键演示班、矢量教室（浅色/深色）、学生成长档案 ECharts 折线图、统一考试中心 ECharts 柱状图（浅色/深色）、花名册、手写阅卷标签页、设置中心与智学网伴侣视口挂载，**0 运行时报错**。
- **待用户实机核验项**：需由教师使用真实 DeepSeek / 视觉大模型 API Key 联网实测手写照片 AI 判分，以及使用真实智学网账号在「智学网伴侣」登录并验证实际打分框填入体验；Windows 绿色版 `.zip` 需在 Windows 实体机解压双击验收。

---

## 历史记录（v0.x 单文件 HTML 原型阶段）

### 0.6.0-ai-grading-p1 AI 智能阅卷核心引擎（第 1 期） · 2026-11-19

按重新规划的 V3.1 方案完成**第 1 期（工作台内置核心引擎）**落地，彻底取代过于繁琐的 V2 旧规划：

### 新增核心能力
- **统一模型 + 分阶段自定义配置**（[provider.ts](src/modules/assistant/provider.ts)、[AssistantSettings.tsx](src/ui/AssistantSettings.tsx)）：
  - 复用工作台既有 AI 连接作为统一默认模型；并在「智能阅卷分工与 OCR」页签支持**阶段一盲识图模型（VLM）**与**阶段二得分点采纳模型**各自一键切换「跟随统一模型」或「单独自定义」（内置通义千问 VL / 硅基流动 VL / 豆包视觉 / 本机 Ollama 快捷模板）。
  - 支持 3 档可选**辅助交叉核对 OCR**（关闭单路轻模式 / 独立视觉 OCR 模型 / 本地或云端 HTTP OCR 如 Pix2Text、PaddleOCR，本机 `localhost` 可免 Key）。所有 API Key 仅存当前会话内存，不入库不进备份。
- **可移植 AI 阅卷核心引擎**（[ai-engine.ts](src/modules/grading/ai-engine.ts)，零 UI/数据库依赖，第 2 期智学网伴侣端可直接复用）：
  - **参考答案一键拆得分点**（集成于 [ItemEditor.tsx](src/ui/grading/ItemEditor.tsx)）：支持粘贴参考答案文字或上传参考答案照片，AI 自动拆解为带分值与步长的小题得分点清单。
  - **本地图像前置闸门**：借鉴 `AI-Marker-Suite` 实坑经验，内置尺寸残片废图拦截（如 `942×4`）与 Otsu 灰度二值化空白卡检测，疑似空白卷触发硬红线停机提醒人工而非静默判 0 分。
  - **防幻觉两段解耦流水线**：阶段一「盲识图 VLM + 并行 OCR 交叉比对」**严禁传入参考答案**，专门核对数字、小数点、正负号与物理单位（如 `m/s²`、`N`、`kg`）；阶段二仅依据扫描复原文本对照得分点逐条采纳，并由程序**核验所引用学生原文（quote）真实存在**且调用既有 `score-policy.ts` 确定性累加总分。
  - **4 维客观置信度引擎（0–100）+ 可调“半自动功率”滑块**（[AiScanView.tsx](src/ui/grading/AiScanView.tsx)）：综合 OCR 一致性（40）+ 笔迹与图像闸门（20）+ 采分确定性与原文锚定（25）+ 规则合法性（15），配合冲突硬封顶（OCR 分歧 ≤65%、无 OCR ≤82%、潦草 ≤75%、存疑 ≤78%、虚假引用 ≤60%）与 **4 条不可逾越硬红线**（废图/空白/无法辨认、规则非法或自相矛盾等强制归零 0% 停机）。提供 4 档预设（`纯把关 100%` / `稳健挡 88%` / `提速挡 78%` / `强力挡 68%`）及连续滑块。
- **扫描内容可视化输出区 & AI 智能批阅台**（[AiBatchWorkbench.tsx](src/ui/grading/AiBatchWorkbench.tsx)、[ReviewEditor.tsx](src/ui/grading/ReviewEditor.tsx)、[GradingCenter.tsx](src/ui/grading/GradingCenter.tsx)）：
  - 扫描内容输出区自动将 VLM 与 OCR 存在数值/单位分歧的片段**标黄高亮**，提供一键「采用 OCR 值」与「手动修正并按修正内容重算得分点」。
  - 在「3. AI 智能批阅台」支持**本班待评答卷批量批阅**与**免绑花名册的快速照片/粘贴截图试测**：置信度达标时展示 1.5 秒可按 `Esc` 拦截的倒计时自动确认下一份；置信度不足或触红线立即暂停并播放温和提示音提醒人工接管。

### 本轮验证记录
- `npm run check`：strict TypeScript 检查 0 错误；65 个源码文件模块边界检查通过（网络 `fetch` 严格收敛于 `provider.ts`）。
- `npm test`：**27 / 27** 项单元测试通过（新增 [ai-grading-engine.test.ts](tests/ai-grading-engine.test.ts) 覆盖统一/自定义路由、Otsu 空白与废图闸门、物理数值/单位 OCR 冲突标黄、盲识图隔离、原文引用核验、可调功率阈值与硬红线熔断、参考答案拆点）。
- `npm run build` & `npm run test:browser`：单文件成品 [dist/index.html](dist/index.html)（`16,924,266` 字节，SHA-256 `660decde41b22d44522094e18bb3e7eaa337737264827cdaed85dde92da53f2d`）构建与成品完整性校验全绿；新增 UI 类名静态校验 0 缺失。
- **待实机验证**：真实视觉大模型与 OCR API 的联网实测、真实学生手写照片的准确率调优，以及第 2 期智学网伴侣端接入。

---

## 0.5.2+ 前端人机工效重构与架构瘦身 · 2026-11-19

在独立工作区副本（`教师个人系统-gemini/cyz-teacher-workbench-web`）内完成全站前端人机工效重构与方案 A 代码瘦身；原目录未改动，所有业务数据模型、持久化事务、备份兼容性与 7 张内置像素素材保持不变。

### 界面与人机工效升级
- **统一工作台架构与视觉体系**：改用深松墨绿可收起左侧导航栏（集成教师名片、班级切换、四大工作区、底部自动保存状态与备份/AI 入口）+ 温润米白主画布；通过合规 URL Hash（`#c=...&t=...`）在刷新后保持当前班级与页面，不引入 `localStorage`。
- **新手友好与白话文案**：新增首次打开双卡片欢迎页与新班 3 步起步引导条；统一全站拖拽上传区（Dropzone）、状态徽章、分页器与教师日常中文提示，消除“工作副本/事务/派生图”等工程师黑话带来的操作焦虑。
- **教室与排座升级**：日常教室新增「快速找人」搜索定位脉冲高亮，强化 48 人满班姓名牌可读性；排座模式新增 `行 × 列` 步进器与实时容量预警、带具体动作说明的撤销按钮、角色选择器本班已用人数角标。
- **名单与成绩单向导化**：
  - 名单导入重构为 2 步向导，自动侦测分隔符与中文表头，提供「一键排除全部错行」和「全部勾选更新」。
  - 成绩单导入由 690 行单页长表单重构为 **4 步固定底栏向导**（选文件/粘贴 → 点击预览行设表头与色标列 → 核对纠错 → 汇总确认），底栏就近提供「刷新核对结果」；从成绩页点「修订本场」自动带入原考试名与日期。
  - 成绩分析页新增 6 项 KPI 卡片、**点击分数段柱条直接筛选学生**的交互分布图、点击表头排序、匿名/实名导出弹窗，以及轻量化隐私透明的 AI 问数卡片。
- **手写人工阅卷与安全中心升级**：明确区分「成绩册分析」与「答卷阅卷与讲评」并在空态互相指引；细则编辑改为小题嵌套卡片并实时校验分值；答卷准备新增**鼠标拖拽框选裁剪**（替代手填像素坐标）；打分复核新增一键点选快捷分值胶囊；知识点映射新增实时 100% 权重进度条与一键均分；备份抽屉新增恢复前后对比预览卡。

### 方案 A 架构瘦身与代码整理
- `src/` 总行数由原版 **12,751 行**（初版重构 18,526 行）精简至 **11,051 行**（前端界面与样式层由原版 7,530 行降至 **5,809 行**，减少 22.9%）。
- 拆分巨型单文件：将原 `App.tsx`（1,163 行）拆分为 [App.tsx](src/app/App.tsx)（604 行）、[Sidebar.tsx](src/ui/Sidebar.tsx)、[ClassroomView.tsx](src/ui/ClassroomView.tsx)、[RosterView.tsx](src/ui/RosterView.tsx)；将成绩导入拆分为 [GradeImportDialog.tsx](src/ui/gradebook/GradeImportDialog.tsx) 与 [GradeImportSteps.tsx](src/ui/gradebook/GradeImportSteps.tsx)；图标收敛为数据驱动 [Icons.tsx](src/ui/Icons.tsx)（55 行）；全站样式 [styles.css](src/ui/styles.css) 由 1,477 行收敛至 **460 行**。

### 本轮验证记录
- `npm run check`：strict TypeScript 检查 0 错误；62 个源码文件模块边界检查通过。
- `npm test`：22 / 22 项业务、导入、公式、多班、备份与只读 AI 单元测试通过。
- `npm run build` & `npm run test:browser`：单文件成品 [dist/index.html](dist/index.html)（`16,852,150` 字节，SHA-256 `0c927f796c5d1bd9e0cdfae888169faa04f1a02caa0580d8e81b853b929d5904`，7 张像素图各嵌入一次、0 外部资源）及浏览器辅助测试页构建通过；JSX 类名静态核查 0 缺失。
- **尚待人工实机验收**：本轮未通过自动浏览器完成视觉截图回归（受限于环境内置 webview 故障），需由教师在 Chrome / Safari / Windows 实机双击 `dist/index.html` 验收真实画面、DPI 与真实模型连通性。

---

## 0.5.2 物理均分只读版 · 2026-11-19

- 在“成绩单与分析”新增固定问题只读 AI 查询（`grades.physics_mean`），支持 DeepSeek 官方与自定义 OpenAI 兼容接口的会话 Key 配置。
- 查询时仅外发当前班级名、考试上下文、物理列名及均分/有效人数汇总，学生姓名、学号和个人分数留在本机；新增同名考试与多物理列消歧及单元测试。

## 0.5.1 成绩导入 P0 整改候选版 · 2026-11-18

- 修复无缓存公式单元格、排名子列误判科目、多班合表筛选与空班级汇总行排除原因错误。
- 补充 P0 验收样表与自动化测试。

## 0.5.0 成绩单导入与分析候选版 · 2026-11-17

- 按用户优先级调整，暂缓 AI 阅卷后续批次，优先落地 Excel / CSV / 粘贴成绩单本地 Web Worker 解析、多行表头与列映射、学生绑定与单元格更正、版本修订、统计分析与 CSV / HTML 导出。
- 预留工具型 AI 助手提案/授权契约与连接配置面板。

## G0 / G1 / G5a 人工阅卷底座与讲评候选版 · 2026-11-17

- 落地带图片附件的 Dexie v2 持久化与纯手写完整 ZIP 备份协议（G0）。
- 实现本地人工阅卷全流程（G1）：建题、小题与评分点细则草案/冻结、答卷图片导入/旋转/裁剪、逐点草稿与教师确认、改分留痕。
- 实现确认成绩矩阵、缺考管理、加权知识点映射与得分率统计、匿名/实名 CSV 与离线 HTML 导出（G5a）。
- AI 自动识图初评、试改校准、批处理队列与双评仲裁（G2/G3/G4）列为后续批次，当前暂缓。

## M1 基础版 · 2026-11-03 ~ 2026-11-04

- 完成独立单文件 React / TypeScript 教师工作台基础版：多班级管理、学生花名册与 CSV/粘贴导入、29 角色图集精确裁切与性别匹配、互动像素教室、拖动实时交换预览与撤销、Dexie 事务持久化与 JSON 备份恢复。
