# 开发工作流

本项目的进度记录机制由三个文件组成：

- `PROJECT_PLAN.md`：阶段目标与勾选状态
- `SESSION_STATUS.md`：本轮实际完成内容、下一步 backlog
- `README.md`：对外说明、运行方式、仓库规则

## 开工前

1. 阅读 `PROJECT_PLAN.md`，确认当前已完成与未完成项
2. 阅读 `SESSION_STATUS.md`，确认上一轮收工说明和下一步建议
3. 如果要提交仓库，先运行 `scripts/pre_commit_audit.ps1`

## 开发中

1. 新增能力时同步考虑文档、日志、忽略规则是否需要更新
2. 所有本地配置、缓存、导出物默认留在 `data/`、`exports/`、`logs/`，不直接入库

## 收工前

1. 更新 `SESSION_STATUS.md`
2. 如果阶段经用户确认完成，再更新 `PROJECT_PLAN.md`
3. 执行基础验证：前端构建、后端导入或接口检查、仓库审计
4. 用 `git status` 确认没有不应提交的本地文件
