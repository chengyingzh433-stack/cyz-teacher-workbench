# 代码、依赖与美术来源

2026-11-17 G0 实现补充：新增阅卷基础模型、附件校验、迁移、分段暂存与备份界面均为本项目独立实现。受限 STORE ZIP 编解码按 [PKWARE APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) 的公开格式说明编写；未复制第三方脚本，没有新增运行依赖。`scripts/create-g0-fixtures.py` 通过 Python 标准库生成虚构格网图片与输入包，不导入或运行应用代码。AI-Marker 历史格式适配器尚未实现。

2026-11-17 阅卷方案补充：功能参考来自本机 AI-Marker-Suite stable 1.21.25.0，提交 `4a849464e07c75dc84941b696bac9accc7dbb066`，其 package.json 声明 GPL-3.0；[源码核对记录](research/2026-11-17-ai-marker-source-audit.md)与[整合 V2 方案](GRADING_INTEGRATION_V2.md)记录了具体依据和独立实现边界。本次仅进行产品/技术规划，没有将其源码、平台适配器或提示词原文复制到工作台，没有修改源项目。既有源码来源说明保持有效。

日期：2026-11-03。实施依据为本目录 PRD、TECH_SPEC、ACCEPTANCE 和用户提供的资源说明。

## 业务与渲染代码

`src/`、业务测试、浏览器测试页与构建脚本按新规格在本目录编写。没有复制旧 `workstation-teacher` 应用代码、渲染代码或数据库实现，也没有读取或覆盖旧版浏览器存储键。新数据库名为 `cyz-teacher-workbench-independent-v1`。本轮工具没有向旧项目目录写入。

已有的 AGENTS、PRD、技术方案、验收清单、准备检查脚本、能力验证页及图像予以保留。README 与完成状态更新为本轮实际实现；准备阶段证据仍按历史记录保留。

## 固定依赖

早期依赖从官方 npm 包名安装；新增 SheetJS 使用官方固定 tarball（见文末）。早期依赖通过 `npm view` 和安装包元数据核对版本、仓库与许可证。完整解析版本见 `package-lock.json`。下表列直接依赖与主要开发依赖；类型声明包、平台二进制等传递依赖也由 lockfile 固定。

| 包 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| dexie | 4.4.7 | Apache-2.0 | IndexedDB 事务 |
| react | 19.3.1 | MIT | 界面组件与状态 |
| react-dom | 19.3.1 | MIT | 浏览器渲染 |
| uuid | 14.0.3 | MIT | 稳定随机 ID |
| zod | 4.6.7 | MIT | 输入与备份结构校验 |
| xlsx（SheetJS CE） | 0.20.3 | Apache-2.0 | 本地 Excel/文本表格解析 |
| @types/node | 26.6.6 | MIT | 开发期类型声明 |
| @types/pngjs | 6.0.5 | MIT | 开发期类型声明 |
| @types/react | 19.3.0 | MIT | 开发期类型声明 |
| @types/react-dom | 19.3.0 | MIT | 开发期类型声明 |
| esbuild | 0.28.2 | MIT | 浏览器 IIFE 打包 |
| pngjs | 7.0.0 | MIT | 构建期 PNG 尺寸与 Alpha 核查 |
| prettier | 3.9.10 | MIT | 源码格式化 |
| tsx | 4.23.15 | MIT | Node 业务测试运行 |
| typescript | 7.0.2 | Apache-2.0 | 严格类型检查 |

运行依赖（含 react-dom 引入的 scheduler）的完整必要许可证文本保存在 [THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt)，同时内嵌 HTML。构建期依赖不在成品中执行。

实现时核对的官方资料：[React 客户端应用](https://react.dev/learn/creating-a-react-app)、[Dexie 事务完成语义](https://dexie.org/docs/Dexie/Dexie.transaction%28%29)、[Zod 类型校验](https://zod.dev/)、[esbuild 的 TypeScript 支持与独立类型检查](https://esbuild.github.io/content-types/#typescript)。

## 美术

13 个 PNG 为用户明确指定继续使用的本对话资源，其中七张运行图、六张参考原图。具体来源与第三方角色说明见 [资源 README](../assets/README.md)。本轮没有改写任何 PNG 像素，也没有生成替代角色。构建逐一检查原始 SHA-256。

`assets/catalog.json` 继续作为图像、角色性别、固定 ID、教师默认值及裁切的唯一目录。新增桌椅、椅背和讲台的裁切登记；根据浏览器实绘修正部分角色矩形，变更前后数据见 [裁切调整记录](evidence/crop-adjustments.json)。

源图存在透明边缘，浏览器用精确 clipPath 防止 SVG 留白区域显示邻近图集内容。桌前姿态是既有正反面图与桌椅的叠放，不宣称存在独立坐姿原画。

图像与第三方角色来源记录不因为业务代码独立实现而被移除。参考原图不进入成品；备份仅保存角色 ID，不含图像副本。

## 2026-11-03 体验修订

根据用户已展示并实际操作过的改版工作台体验，独立重写新项目的教室几何、姓名排版、档案抽屉与工具区；新增 `SeatedPerson`、`StudentProfile`、`ToolbarMenu`。没有复制旧版业务或渲染代码；本轮没有写入旧目录。当前快照和备份结构保持原样。

全部 PNG 与 catalog.json 保持原值。新的角色核查页直接复用新的桌椅人物组件，避免核查页与真实教室比例不一致。运行截图由本机 Chrome 工具直接采集，保留实际 JPEG 字节并使用 `.jpg` 后缀；前后对照没有用图像生成或改图。

## 2026-11-04 拖动反馈修订

按用户提出的拖动体验要求，独立编写 `src/scene/useSeatDrag.ts`，在现有教室加入同一角色组件的指针跟随画面和换座预览。预览复用本项目的纯座位移动规则，提交仍走现有保存与撤销流程。没有新增依赖、素材或修改数据格式；旧目录未写入。`tests/drag-audit.ts` 仅观察生产成品副本的浏览器 DOM，附加记录器不进入交付文件。截图为真实拖动期间直接截取，未改图。

## 2026-11-17 G1 人工阅卷

新增 grading 业务操作、score-policy、assets/prepare 与 ui/grading 均在本项目独立实现，未读取或复制 AI-Marker 的 UI、提示词或平台适配器。旋转和裁剪由运行时 Canvas 产生新图片，原件保留。无新增运行依赖，角色素材未修改。本批只有静态代码/构建证据，没有实际 UI 截图或评分测试结果。

## 2026-11-17 G5a 分析与导出

assessment、知识点映射与参测 UI、CSV/HTML 编码均按本地需求独立实现；没有复制外部平台代码，没有新增依赖或素材。HTML 直接生成转义后的文本与经资产校验的内嵌图片，不使用外部样式。只有静态代码/构建证据，没有运行导出、浏览器截图或教学分析功能测试。

## 2026-11-17 成绩单与内置工具

gradebook 识别、预览、身份匹配、版本化导入、分析、导出及 assistant 工具/连接适配独立实现。新增运行依赖 SheetJS CE xlsx 0.20.3，Apache-2.0，按[官方安装文档](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/)使用官方 CDN 的固定 tarball，lockfile 记录完整性；未使用 npm 镜像上的旧版本。参考[读取选项文档](https://docs.sheetjs.com/docs/api/parse-options/)并核对本地类型/源码，库仅在内嵌 Worker 读取表格，许可证一并打包，不在运行时访问 CDN。

DeepSeek 默认地址和模型依据[官方模型页](https://api-docs.deepseek.com/quick_start/pricing/)及[工具调用页](https://api-docs.deepseek.com/guides/tool_calls/)核对（2026-11-17）：https://api.deepseek.com、deepseek-flash。没有实际发送请求、测试Key或导入真实学生文件。本批角色素材未改变，代码/构建证据不代替表格识别、模型和平台验收。
