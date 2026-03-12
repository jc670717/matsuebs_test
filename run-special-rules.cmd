@echo off
setlocal
cd /d "%~dp0"

if exist ".\node.exe" (
  .\node.exe .\node_modules\playwright\cli.js test tests\ticket-types-special-rules.spec.js --output .\test-results
) else (
  node .\node_modules\playwright\cli.js test tests\ticket-types-special-rules.spec.js --output .\test-results
)

exit /b %ERRORLEVEL%
