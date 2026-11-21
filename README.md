# cyz 的教师工作台

面向教师日常使用的本地工作台：集**互动像素教室排座、学生花名册与成长档案、Excel/CSV 成绩分析、手写答卷 AI 智能阅卷与知识点讲评**于一体。

## 当前状态

- **现行代码基线**：`v0.6.0-ai-grading-p1`（单文件 Web 架构，已完成 200+ MB 开发中间产物大扫除并纳入 Git 管理）。
- **下一阶段（v1.0 桌面端重构蓝图）**：已就绪，见 [架构与界面重构蓝图](docs/ARCHITECTURE_BLUEPRINT.md)。将升级为 **Electron 独立桌面客户端 + Obsidian 式本地 SQLite/照片资料库 + 统一考试中心 + 现代工作室可切换主题前端 + 自适应矢量教室场景**。
- **历史演进**：见 [开发日志](CHANGELOG.md) 与 [依赖与素材来源](docs/SOURCES.md)。

## 现行基线开发命令

```sh
npm ci
npm run check      # TypeScript 严格检查 + 模块边界检查
npm test           # 27 项单元测试（域模型、成绩导入、物理均分、AI 阅卷引擎）
npm run build      # 构建旧版单文件 HTML 至 dist/index.html（已 gitignore）
npm run format     # Prettier 格式化
```

## 目录结构（清理后）

```text
├── assets/          # 29 个像素角色图集、课桌素材与 catalog.json
├── docs/            # 架构重构蓝图与第三方来源声明
├── scripts/         # 检查、构建与本地预览脚本
├── src/             # 应用源码（app / modules / scene / ui）
└── tests/           # 自动化单元测试
```
