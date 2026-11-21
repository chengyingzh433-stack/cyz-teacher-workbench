# 技术选型决策记录：独立桌面端技术栈（v1.0）

- **决策日期**：2026-11-21
- **选定方案**：**方案 A — 全 TypeScript 零底层编译 Electron 桌面端（内置智学网阅卷视口 + 成熟现成组件库）**

## 1. 背景与硬约束

1. **平台与分发**：先交付 macOS 版本，后续同时面向同事/他人提供 Windows 版本；无远程服务器与多人协作。
2. **维护门槛**：使用者未亲手维护过本地开发环境、命令行构建、数据库或环境变量，需要最成熟稳妥、工具链单一、跨平台无原生编译坑的方案。
3. **成本与网络**：零额外固定预算（不购置 Apple Developer \$99/年或 Windows 代码签名证书）；纯中国大陆网络环境下开发、打包与运行。
4. **核心功能需求**：
   - 互动教室（29 个像素角色与课桌 + 自适应矢量精致教室场景）、学生与成长档案、统一考试中心（合并 Excel/CSV 成绩册与手写答卷 AI 阅卷，全站数据闭环）。
   - Obsidian 式本地资料库文件夹（Vault：单文件 SQLite + 照片目录）、软删除回收站、正式改分留痕；不兼容旧版 `.cyz.json` / `.cyz-backup.zip`。
   - **智学网网阅接入现在就要**：独立洁净实现「智学网 + 通用网页框选」内嵌阅卷伴侣，不复制 `AI-Marker-Suite`（GPL-3.0）源码，避免协议传染。
   - **Design Token 多主题切换引擎**：首发「现代精致工作室」主题并内置「深夜护眼」主题，预留标准换肤扩展接口。

## 2. 选定技术栈清单（均为大厂/基金会背书的成熟开源项目）

| 层级 | 选型 | 协议与背书 | 选型理由 |
| --- | --- | --- | --- |
| **桌面底座** | Electron（含 Node.js 24+） | MIT / OpenJS Foundation | Mac/Win 渲染 100% 一致；提供 `WebContentsView` 原生内嵌智学网与 `safeStorage` 钥匙串加密；开发期配 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 国内直连 |
| **构建与打包** | `electron-vite` + `electron-builder` | MIT | 统一管理 Main / Preload / Renderer 三端 Vite 构建；单配置输出 macOS `.dmg` 与 Windows 绿色 `.zip`（免 Wine，亦可配合 GitHub Actions 出 NSIS `.exe`） |
| **本地数据库** | Node.js 内置 `node:sqlite` | MIT / Node.js 官方内置 | **零 C++ 原生编译、零 `@electron/rebuild`**，彻底解决 Mac 跨平台打 Windows 包的最大痛点；按表增量写入 + `DELETE` 日志模式兼容坚果云/iCloud 同步 |
| **本地附件库** | Vault 文件夹 `photos/<examId>/` | Node.js 原生 `fs` | 照片直接按内容哈希落盘并按需生成缩略图，彻底根治旧版每次保存全库复制几十 MB Blob 的性能炸弹 |
| **前端核心** | React 19 + TypeScript (strict) | MIT / Meta & Microsoft | 与既有纯逻辑引擎（`ai-engine.ts`、`recognize.ts`、`score-policy.ts`、`seating/`）无缝复用 |
| **样式与组件** | Tailwind CSS + Radix UI (shadcn/ui 规范) + Lucide React + `cmdk` | MIT | 彻底告别丑陋原生 `<select>` / `window.confirm`，配合语义化 CSS Design Token 实现多主题无缝切换与全局 `Cmd+K` 命令面板 |
| **专业数据图表** | Apache ECharts | Apache-2.0 / Apache 基金会 | 替代简陋 CSS 进度条，开箱提供交互式分数段点击筛选柱图、多考趋势折线图与学生个人成长曲线 |
| **表格解析** | SheetJS CE (`xlsx`) | Apache-2.0 | 直接复用已通过 P0 复杂表头、无缓存公式、多班合表与汇总行单测的识别引擎 |
| **像素素材** | 6 张图集转码轻量 WebP 外部静态资源 | 第三方素材保留来源声明 | 剔除拉伸的 `room.png` 改为主题联动矢量教室；6 张图集压缩后外部按需加载，不再内联 14.6 MB Base64 |

## 3. 放弃的备选方案及原因

- **方案 B（桌面端 + 独立浏览器扩展）**：需要同事在 Chrome/Edge 手动开开发者模式加载扩展，配置与密钥割裂，对无维护经验的使用者门槛过高。
- **方案 C（Tauri v2 / Rust）**：需引入 Rust 双语言编译链且不支持在 Mac 本地稳定打包 Windows `.msi`；macOS WebKit 与 Windows WebView2 内核差异对智学网复杂网页嵌入与像素渲染兼容性风险高。

## 4. 明确接受的风险与应对

1. **安装包约 100~120 MB**：Electron 内置 Chromium 换取双端一致体验与智学网内嵌能力，属预期取舍。
2. **未签名系统拦截提示**：分发给同事时附带 2 行首次放行指引（macOS 隐私与安全性“仍要打开” / Windows SmartScreen“更多信息 → 仍要运行”）。
3. **智学网网页改版风险**：除智学网专用定位规则外，同步内置“通用鼠标框选抓图区”作为永不失效的兜底模式。
