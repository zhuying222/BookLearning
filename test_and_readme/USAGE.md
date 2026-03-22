# BookLearning 使用指南

## 1. 环境要求

- **后端**：Python >= 3.12
- **前端**：Node.js >= 18
- **浏览器**：推荐 Chrome（导出PDF效果最佳）

## 2. 启动项目

### 启动后端

```bash
cd D:\booklearning\backend
# 首次安装依赖
pip install -e .

# 启动服务（默认 http://localhost:8000）
uvicorn app.main:app --reload
```

### 启动前端

```bash
cd D:\booklearning\frontend
# 首次安装依赖
npm install

# 启动开发服务器（默认 http://localhost:5173）
npm run dev
```

启动后在浏览器访问 `http://localhost:5173` 即可使用。

## 3. AI 配置

1. 点击顶部工具栏的 **"AI 配置"** 按钮
2. 点击 **"新增配置"**，填写以下信息：
   - **配置名称**：自定义名称
   - **请求地址**：API服务地址（如 `https://api.siliconflow.cn`）
   - **API Key**：服务商提供的密钥
   - **模型名称**：完整模型标识（如 `Qwen/Qwen2.5-VL-72B-Instruct`）
   - **最大Token数**：建议 4096
   - **温度**：建议 0.7
3. 点击 **"设为默认"** 选择当前使用的配置

支持同时保存多个配置，随时切换。

## 4. 提示词设置

1. 点击顶部 **"提示词"** 按钮
2. 可修改 **系统提示词**（控制AI讲解风格）和 **用户提示词模板**
3. 点击保存

对于特殊页面（公式密集、图表页等），可在右下角控制区的"页级附加提示词"输入框中临时添加额外要求。

## 5. 基本使用流程

1. 点击 **"打开 PDF"** 选择本地 PDF 文件
2. 使用上一页/下一页、跳转、键盘方向键浏览
3. 点击 **"解析当前页"** 让 AI 讲解当前页
4. 右侧面板自动显示 AI 生成的讲解内容
5. 翻页时右侧自动切换到对应页讲解

### 批量解析

在控制区的页范围输入框中输入页码范围（如 `1-10` 或 `1,3,5-8`），点击"批量解析"。支持暂停、继续、取消。

### 编辑讲解

点击讲解面板下方的"编辑"按钮，可手动修改 AI 讲解内容，修改后点击保存。

## 6. 导出功能

右下角控制区提供三种导出方式：

### 导出数据（JSON）
- 将所有讲解结果导出为 JSON 文件
- 用于备份、迁移、恢复数据

### 导出 HTML
- 生成左侧PDF原页+右侧讲解的双栏 HTML 文件
- 可直接在浏览器中打开查看
- 适合快速检查排版效果

### 导出 PDF
- 打开浏览器打印预览，选择"另存为 PDF"即可
- 采用 A4 横向双栏版式
- 长文本讲解会自动分页
- **推荐使用 Chrome** 浏览器以获得最佳排版效果

## 7. 快捷键

| 快捷键 | 功能 |
|--------|------|
| ← / PageUp | 上一页 |
| → / PageDown | 下一页 |
| Home | 第一页 |
| End | 最后一页 |
| Ctrl + 滚轮 | 缩放 |

## 8. 数据目录说明

```
D:\booklearning\
├── data\
│   ├── ai_configs.json        # AI配置
│   ├── prompts.json           # 提示词配置
│   ├── activity_log.jsonl     # 活动日志
│   └── cache\{pdf_hash}\      # 各PDF的讲解缓存
├── logs\
│   └── app.log                # 运行日志
└── exports\                   # 导出文件目录（备用）
```

## 9. 常见问题

**Q: AI 解析失败怎么办？**
- 检查 AI 配置中的请求地址和 API Key 是否正确
- 查看 `logs/app.log` 中的错误详情
- 查看 `data/activity_log.jsonl` 中最近的解析/导出事件
- 确认网络连接正常

**Q: 导出 PDF 弹出窗口被拦截？**
- 浏览器可能会拦截弹出窗口，请在地址栏允许弹出窗口后重试

**Q: 导出的 HTML/PDF 图片模糊？**
- 导出使用 1.75x 缩放渲染，通常效果较好
- 如需更高清晰度，可在代码中调整 `DEFAULT_EXPORT_SCALE` 值

## 10. 提交前检查

若准备提交仓库，建议先执行：

```powershell
cd D:\booklearning
powershell -ExecutionPolicy Bypass -File .\scripts\pre_commit_audit.ps1
```

脚本会检查：

- 常见敏感信息模式是否出现在待提交文本文件中
- `data/ai_configs.json`、`logs/`、`exports/` 等本地文件是否仍被 `.gitignore` 正确忽略
