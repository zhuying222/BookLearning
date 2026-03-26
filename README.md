# BookLearning

BookLearning 是一个本地运行的 AI PDF 阅读器，适合阅读教材、技术文档和笔记型 PDF 时边看边问、边看边整理。

## 你可以做什么

- 把本地 PDF 导入书架，按文件夹整理
- 阅读单页 PDF，支持翻页、跳页、缩放和阅读进度记忆
- 配置多个 AI 接口与提示词，解析当前页或批量解析多页
- 对当前页继续追问，编辑讲解内容，给页面加书签
- 在解析完成后收到右下角通知，点击可跳回对应页
- 导出 JSON、HTML、PDF，PDF 导出前可先预览

## 快速开始

最省事的方式：

```powershell
.\start.bat
```

启动后打开 `http://localhost:5173`。

如果你想手动启动，完整步骤见 [docs/README.md](docs/README.md)。

## 本地数据与隐私

- AI 配置、缓存、日志、导出文件都保存在本地
- `data/`、`logs/`、`exports/` 默认不会进入 Git
- API Key 不要写进代码，只保存在本地 AI 配置中

## 用户文档

- [docs/README.md](docs/README.md)
