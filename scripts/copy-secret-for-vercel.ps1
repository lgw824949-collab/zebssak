# SUPABASE_SECRET_KEY 값만 클립보드에 복사 + Vercel 설정 페이지 열기
$root = Split-Path -Parent $PSScriptRoot
$line = Get-Content (Join-Path $root '.env.local') -Encoding UTF8 |
  Where-Object { $_ -match '^\s*SUPABASE_SECRET_KEY\s*=' } |
  Select-Object -First 1
if (-not $line) {
  Write-Host 'ERROR: .env.local 에 SUPABASE_SECRET_KEY 가 없습니다.' -ForegroundColor Red
  exit 1
}
$value = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
Set-Clipboard -Value $value
Write-Host 'SUPABASE_SECRET_KEY 가 클립보드에 복사됐습니다.' -ForegroundColor Green
Write-Host 'Vercel 페이지에서 Name=SUPABASE_SECRET_KEY, Value=Ctrl+V, Production 체크, Save, Redeploy' -ForegroundColor Cyan
Start-Process 'https://vercel.com/dashboard'
