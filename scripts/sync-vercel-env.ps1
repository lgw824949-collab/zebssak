# .env.local → Vercel Environment Variables (production)
# 사용: cd C:\dev\zebssak  후  npm run vercel:env

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env.local'
$vercel = Join-Path $root 'node_modules\.bin\vercel.cmd'

if (-not (Test-Path $envFile)) {
  Write-Error ".env.local 파일이 없습니다: $envFile"
}

if (-not (Test-Path $vercel)) {
  Write-Host 'Vercel CLI 설치 중...' -ForegroundColor Yellow
  Set-Location $root
  npm install vercel@41.6.0 --save-dev --no-fund --no-audit
}

$names = @(
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
  'SEOUL_METRO_POSITION_API_KEY',
  'SEOUL_METRO_ARRIVAL_API_KEY',
  'SEOUL_METRO_API_KEY',
  'PUBLIC_DATA_API_KEY',
  'ADMIN_SECRET'
)

Write-Host 'Vercel에 .env.local 업로드 (production)...' -ForegroundColor Cyan
Set-Location $root

foreach ($name in $names) {
  $line = Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -match "^\s*$([regex]::Escape($name))\s*=" } | Select-Object -First 1
  if (-not $line) {
    Write-Host "  skip $name" -ForegroundColor DarkYellow
    continue
  }
  $value = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
  if (-not $value) {
    Write-Host "  skip $name (empty)" -ForegroundColor DarkYellow
    continue
  }
  Write-Host "  add $name ..." -ForegroundColor Green
  $value | & $vercel env add $name production --force 2>&1
}

Write-Host ''
Write-Host '완료. 이제 실행: npm run vercel:deploy' -ForegroundColor Cyan
