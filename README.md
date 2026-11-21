# cyz 的教师工作台 v1.0（独立桌面客户端）

面向教师日常教学的高颜值独立桌面工作台：集**自适应矢量像素教室与智能排座、学生成长档案曲线、Excel/CSV 成绩分析交互图表、手写答卷 AI 批阅台与原生内置智学网伴侣**于一体。

完整架构与技术选型决策见：[技术选型决策](docs/decisions-desktop-tech-stack.md) · [架构与界面重构蓝图](docs/ARCHITECTURE_BLUEPRINT.md) · [开发日志](CHANGELOG.md)。

## 核心特性（v1.0 桌面重构版）

- **Obsidian 式本地资料库（Vault）**：数据直存于你电脑上的真实文件夹（默认 `~/Documents/cyz教师工作台`），包含单文件 `workbench.sqlite`（Electron 内置 Node 24 `node:sqlite`，零 C++ 编译）与 `photos/` 照片目录；可直接拷贝备份或放入坚果云 / iCloud 同步。
- **全站数据闭环**：
  - 彻底合并「成绩册」与「手写阅卷」为**统一考试中心**——每道主观题批改确认后自动回填进本场成绩总表。
  - 点击教室人物或花名册姓名，右侧滑出**学生成长档案抽屉**（Apache ECharts 个人历次成绩 vs 班级均分趋势折线图 + 近期答卷原图）。
  - 排座支持**参考考试成绩智能排座**（强弱互助同桌 / 大组均衡 / S 形 / 成绩梯度）与**随机点名**。
  - 支持**软删除回收站**（可恢复，清空时同步释放硬盘照片）与**正式成绩改分留痕日志**。
- **现代工作室前端 + 多主题扩展引擎**：
  - 基于 React 19 + Tailwind CSS + Radix UI + Apache ECharts + `cmdk`（`Cmd+K` / `Ctrl+K` 全局快捷搜学生/考试/切班级）。
  - 首发「现代暖白工作室」与「深夜护眼工作室」双主题，并预留标准 `ThemeDefinition` 换肤扩展接口。
  - 保留 29 个动漫像素角色与课桌（6 张图集转码 WebP 体积瘦身 **81.5%** 至 1.85 MB），背景升级为无畸变自适应矢量精致教室。
- **零跨域 AI 代理 + 系统钥匙串 + 内置智学网伴侣**：
  - API Key 通过 Electron `safeStorage` 加密存于本机系统钥匙串，重启不丢失、绝不进资料库文件夹。
  - 主进程无 CORS 代理：支持只读「学情对话助教」（隐私透明切换）与两段防幻觉 AI 批阅引擎（Otsu 空白闸门 + VLM×OCR 数值/单位标黄 + 4 维置信度 + 可调半自动功率）。
  - 通过原生 `WebContentsView` 内嵌智学网与任意网阅平台，保持持久登录态，无需装浏览器扩展，支持一键抓图 AI 识图判分并填入打分框。

## 开发与打包命令（中国大陆国内镜像直连）

```sh
# 1. 安装依赖（.npmrc 已配置 npmmirror）
ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/" ELECTRON_CUSTOM_DIR="45.4.1" npm install

# 2. 启动桌面端开发预览
npm run dev

# 3. 严格类型检查 & 自动化测试 & 三端构建
npm run typecheck
npm test
npm run build

# 4. 打包独立安装包
npm run pack:mac    # 输出 macOS .dmg（release/ 目录）
npm run pack:win    # 在 Mac 上直接输出 Windows 绿色免安装 .zip（同事解压双击 .exe 即用）
```

> **首次发给同事打开未签名安装包指引**：
> - **macOS**：首次双击如提示“无法验证开发者”，前往「系统设置 → 隐私与安全性」底部点击「仍要打开」即可。
> - **Windows**：解压 `.zip` 双击 `.exe` 如弹出 SmartScreen 蓝屏提示，点击「更多信息 → 仍要运行」即可。
