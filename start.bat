@echo off
chcp 65001 >nul 2>&1

echo ========================================
echo   BookLearning Launcher
echo ========================================
echo.

echo [1/2] Starting backend (port 8000)...
start "BL-Backend" cmd /k "cd /d D:\booklearning\backend && .venv\Scripts\uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

timeout /t 2 /nobreak >nul

echo [2/2] Starting frontend (port 5173)...
start "BL-Frontend" cmd /k "cd /d D:\booklearning\frontend && npm run dev"

timeout /t 3 /nobreak >nul

echo.
echo ========================================
echo   Backend: http://127.0.0.1:8000/docs
echo   Frontend: http://localhost:5173
echo ========================================
echo.
echo Press any key to open browser...
pause >nul
start http://localhost:5173
