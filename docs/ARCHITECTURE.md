# Stage 0.2 Architecture

最后更新：2026-03-22

## 技术选型

### 前端

- `React 19`
- `TypeScript`
- `Vite`

选择理由：
- 本地开发启动快
- 适合做桌面化、长流程、状态较多的交互界面
- 后续接入 PDF 渲染、任务队列、配置中心都比较顺手

### 后端

- `FastAPI`
- `Python 3.12`

选择理由：
- 接 AI 接口方便
- 后续做页图像生成、任务调度、项目数据持久化都合适
- 与 PDF 处理生态兼容性好

### 本地存储

第一阶段：
- `JSON` 文件存储项目配置与讲解结果

后续可选：
- `SQLite`

### PDF 能力

当前设计：
- 前端负责阅读器与交互
- 后端负责项目数据、AI 调用、后续导出

后续计划：
- 阅读与页图像获取优先结合 `PDF.js`
- 导出“左原页、右讲解”的 PDF 时，重点借鉴 `PDF2ZH / PDFMathTranslate` 的双栏导出思路

## 模块划分

### 前端模块

- `App Shell`
  - 全局布局、页面框架
- `Reader Workspace`
  - 左侧 PDF 区、右侧讲解区、中间宽度控制
- `Control Panel`
  - 当前页、页范围、提示词、任务按钮
- `Config Center`
  - AI 配置增删改查
- `Task View`
  - 显示解析队列与运行状态

### 后端模块

- `API Layer`
  - 健康检查
  - 启动信息
  - 后续 PDF、配置、解析、导出接口
- `Config Service`
  - 管理 AI 配置
- `Project Service`
  - 管理项目文件、页级结果、状态快照
- `AI Service`
  - 统一封装视觉模型调用
- `Export Service`
  - 处理 HTML/PDF 导出

## 数据对象草案

### Project

- 项目名称
- 源 PDF 路径
- 当前使用的 AI 配置
- 全局提示词
- 页级任务状态
- 页级讲解结果

### Page Explanation

- 页码
- 输入参数摘要
- 模型信息
- 讲解内容
- 手工编辑内容
- 更新时间

### AI Profile

- 名称
- `base_url`
- `api_key`
- `model`
- 其他可选参数

## API 方向

阶段 1 已先实现：
- `GET /api/v1/health`
- `GET /api/v1/bootstrap`

后续优先扩展：
- `POST /api/v1/projects/open-pdf`
- `GET /api/v1/projects/current`
- `POST /api/v1/configs`
- `GET /api/v1/configs`
- `POST /api/v1/explanations/run-page`
- `POST /api/v1/explanations/run-range`
- `POST /api/v1/explanations/rerun-page`

## 架构判断

不建议把 `PDF2ZH` 作为整个应用基座，原因如下：

- 它更适合翻译重排，不适合阅读器型产品
- 它的主流程不是页级学习任务编排
- 直接魔改其整体架构会比借用导出思路更重

建议方案：

- 阅读器、配置中心、AI 调度自己做
- 双栏导出重点借鉴 `PDF2ZH` 的输出思路

