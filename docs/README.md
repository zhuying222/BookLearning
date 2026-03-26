# BookLearning 用户指南

BookLearning 是一个本地运行的 AI PDF 阅读器，适合一边看书一边拿 AI 做讲解、追问、整理和导出。

## 这版能做什么

- 导入本地 PDF，放进书架和文件夹里管理
- 单页阅读，支持翻页、跳页、缩放，并记住上次阅读位置
- 配置多个 AI 接口和全局提示词
- 解析当前页、批量解析一组页码、对当前页继续追问
- 编辑讲解内容、给页面加书签、收到解析完成通知
- 导出 JSON、HTML、PDF，导出 PDF 前可先看预览

## 启动方式

### 方式一：直接启动

在项目根目录运行：

```powershell
.\start.bat
```

启动后访问 `http://localhost:5173`。

### 方式二：手动启动

后端：

```powershell
cd .\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e .
uvicorn app.main:app --reload --port 8000
```

前端：

```powershell
cd .\frontend
npm install
npm run dev
```

## 怎么使用

### 1. 先导入 PDF

- 进入书架后导入 PDF
- 可以新建文件夹、重命名、拖拽整理

### 2. 配置 AI

- 点击顶部 `AI 配置`
- 填写接口地址、API Key、模型名等信息
- 设为默认后即可开始解析

### 3. 开始阅读和解析

- 用上一页、下一页、跳转或键盘翻页
- 点击 `解析当前页` 获取当前页讲解
- 也可以给当前页补充提示词，例如“重点解释公式”

### 4. 批量解析和追问

- 在批量输入框里输入页码范围，例如 `1-5,8,10-12`
- 任务支持暂停、继续、取消
- 当前页已有讲解时，可以进入 `追问` 模式继续问细节

### 5. 书签、编辑和通知

- 可以给当前页添加书签和备注
- 解析结果支持手动编辑保存
- 单页解析、批量解析、追问完成后，右下角会弹出通知

### 6. 导出

- `导出数据`：导出 JSON 备份
- `导出 HTML`：导出左右双栏页面
- `导出 PDF`：导出学习版 PDF，导出前可先看预览

## 数据保存在哪里

这些内容默认都保存在本地，不会自动提交到 Git：

- `data/`：AI 配置、提示词、缓存、活动记录
- `logs/`：后端日志
- `exports/`：导出结果

## 隐私说明

- API Key 只应该保存在本地 AI 配置里
- `data/`、`logs/`、`exports/` 默认已被 `.gitignore` 忽略
- 如果准备提交仓库，建议先运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\pre_commit_audit.ps1
```

## 遇到问题先看哪里

- AI 解析失败：先检查 AI 配置、网络和模型名
- 导出 PDF 效果异常：优先使用 Chrome
- 想看最近发生了什么：查看 `logs/app.log` 和 `data/activity_log.jsonl`
