@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   我家冰箱 · 本地预览
echo ============================================
echo.
set PORT=5188

where python >nul 2>nul
if %errorlevel%==0 (
  start "" "http://127.0.0.1:%PORT%/index.html"
  echo   已在浏览器打开：http://127.0.0.1:%PORT%/index.html
  echo   关闭这个窗口即可停止服务。
  echo.
  python -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
  start "" "http://127.0.0.1:%PORT%/index.html"
  echo   已在浏览器打开：http://127.0.0.1:%PORT%/index.html
  echo.
  py -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)

echo   没找到 Python。可以直接双击 index.html 打开（功能一样，
echo   只是浏览器可能对本地文件的存储限制更严格）。
pause
