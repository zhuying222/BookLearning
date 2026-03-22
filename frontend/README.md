# Frontend

前端基于 React 19、TypeScript 和 Vite，负责以下能力：

- 本地 PDF 打开与单页阅读
- 页码跳转、缩放、键盘翻页、拖拽分栏
- AI 配置与提示词编辑弹窗
- 单页解析、范围解析、任务状态轮询
- 右侧讲解展示、编辑与导出入口

## 运行

```powershell
cd D:\booklearning\frontend
npm install
npm run dev
```

默认开发地址为 `http://localhost:5173`。

## 构建

```powershell
cd D:\booklearning\frontend
npm run build
```

构建产物输出到 `frontend/dist`，该目录不会进入 Git 仓库。

## 关键文件

- `src/App.tsx`: 主界面与整体状态管理
- `src/components/`: 配置面板、讲解面板、解析控制区
- `src/lib/api.ts`: 前后端 API 调用封装
- `src/lib/pdf.ts`: PDF 加载与页面渲染
- `src/lib/export.ts`: JSON / HTML / PDF 导出逻辑
