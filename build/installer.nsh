; DocWatch NSIS 설치 스크립트 확장
; 설치 전 실행 중인 DocWatch 프로세스 종료

!macro customInit
  ; 설치 시작 전 DocWatch 프로세스 종료
  nsExec::ExecToLog 'taskkill /F /IM "DocWatch.exe" /T'
  ; 잠시 대기 (프로세스 종료 완료 대기)
  Sleep 1000
!macroend

!macro customInstall
  ; 설치 완료 후 추가 작업 (필요시)
!macroend

!macro customUnInit
  ; 제거 시작 전 DocWatch 프로세스 종료
  nsExec::ExecToLog 'taskkill /F /IM "DocWatch.exe" /T'
  Sleep 1000
!macroend
