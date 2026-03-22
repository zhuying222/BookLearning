# Backend

FastAPI 后端负责：

- 提供基础 API
- 管理后续项目状态与配置
- 调用视觉模型
- 处理导出流程

## 运行

```powershell
cd D:\booklearning\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e .
uvicorn app.main:app --reload --port 8000
```

## 当前接口

- `GET /api/v1/health`
- `GET /api/v1/bootstrap`

