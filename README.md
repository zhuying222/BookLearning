# BookLearning

BookLearning 是一个面向自用学习场景的 AI 辅助 PDF 阅读器。当前主线阶段 0 到 8 已全部完成，项目已具备本地运行、页级解析、导出、日志排查和仓库整理能力。

## 当前能力

- 打开本地 PDF 并进行单页阅读、翻页、跳页、缩放和拖拽分栏
- 管理 AI 配置与全局提示词，按单页或页范围调用视觉模型
- 缓存页级讲解结果，支持手动编辑、重跑和上下文连贯解析
- 导出项目数据 JSON、双栏 HTML、双栏学习版 PDF，并处理长文本续页
- 记录活动日志和后端运行日志，支持持续开发与问题排查

## 文档入口

- `PROJECT_PLAN.md`: 总体阶段计划与勾选状态
- `SESSION_STATUS.md`: 当前完成状态、交付说明与后续 backlog
- `docs/MVP_SCOPE.md`: MVP 边界
- `docs/ARCHITECTURE.md`: 架构说明
- `docs/WORKFLOW.md`: 开工/收工进度记录机制
- `docs/TROUBLESHOOTING.md`: 日志与错误排查说明
- `test_and_readme/USAGE.md`: 使用指南

## 目录结构

- `frontend/`: React + Vite + TypeScript 前端
- `backend/`: FastAPI 后端
- `data/`: 本地配置、缓存和活动日志目录
- `exports/`: 导出文件目录
- `logs/`: 后端运行日志目录
- `scripts/`: 仓库检查和辅助脚本

## 本地运行

### 前端

```powershell
cd D:\booklearning\frontend
npm install
npm run dev
```

### 后端

```powershell
cd D:\booklearning\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e .
uvicorn app.main:app --reload --port 8000
```

也可以直接运行根目录的 `start.bat` 同时启动前后端。

## 仓库与敏感信息规则

- `data/`、`exports/`、`logs/` 默认不纳入版本控制，用于保存本地配置、缓存、导出物和日志
- AI Key 等敏感数据只应保存在本地 `data/ai_configs.json`，不会进入 Git 提交
- 提交前可运行以下脚本做仓库审计：

```powershell
cd D:\booklearning
powershell -ExecutionPolicy Bypass -File .\scripts\pre_commit_audit.ps1
```
