@echo off
chcp 65001 >nul
echo ========================================
echo   폴더 감시 프로그램 설치
echo ========================================
echo.
echo npm 패키지를 설치합니다...
call npm install
echo.
echo 설치가 완료되었습니다!
echo.
echo 실행하려면 run.bat 또는 npm start 를 사용하세요.
echo 설치 파일을 만들려면 npm run build 를 실행하세요.
echo.
pause
