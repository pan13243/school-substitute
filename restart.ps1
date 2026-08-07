Get-NetTCPConnection -LocalPort 3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$env:FORCE_LOCAL = '1'
cd "C:\Users\HUA WEI\Downloads\school-substitute"
node server.js
