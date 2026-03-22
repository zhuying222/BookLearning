# 日志与排障

## 日志位置

- 后端运行日志：`logs/app.log`
- 活动日志：`data/activity_log.jsonl`
- 页级缓存：`data/cache/{pdf_hash}/`

## 常见问题定位

### AI 调用失败

优先检查：

1. `logs/app.log` 中是否有 `AI connect error`、`AI timeout`、`AI error status`
2. `data/activity_log.jsonl` 中是否有 `parse_page_failed`、`task_failed`
3. 当前 AI 配置的 `base_url`、`api_key`、`model_name` 是否正确

### 导出失败

优先检查：

1. `data/activity_log.jsonl` 中是否有 `export_pdf_failed`
2. 当前页图像是否已经成功渲染
3. 讲解内容是否为空或异常过长

## 脱敏规则

- 后端异常返回不直接透传未处理的内部异常
- 日志和错误消息会对 `Bearer token`、`api_key`、`sk-...` 这类内容做基础脱敏
- 真正的本地敏感数据应只保存在被 Git 忽略的 `data/` 目录
