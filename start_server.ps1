$env:PORT = $env:PORT -as [string]
if (-not $env:PORT) { $env:PORT = "5000" }
if (-not $env:NODE_ENV) { $env:NODE_ENV = "production" }

Write-Host "Starting ChemSus Backend on http://127.0.0.1:$env:PORT ..." -ForegroundColor Green
Write-Host "Tip: set OTP_SMTP_* env vars in your shell before running this script for email OTP delivery." -ForegroundColor Yellow
node backend/server.js
