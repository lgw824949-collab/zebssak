# .env.local 값을 Vercel CLI 로 업로드 (vercel login 필요)
# 사용: powershell -ExecutionPolicy Bypass -File scripts/sync-vercel-env.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $root '.env.local'

if (-not (Test-Path $envFile)) {
  Write-Error ".env.local 파일이 없습니다: $envFile"
}

$names = @(
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
  'SEOUL_METRO_API_KEY',
  'PUBLIC_DATA_API_KEY',
  'ADMIN_SECRET'
)

Write-Host 'Vercel에 .env.local 환경변수 업로드 (production)...' -ForegroundColor Cyan

foreach ($name in $names) {
  $line = Get-Content $envFile | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
  if (-not $line) {
    Write-Host "  skip $name (not in .env.local)" -ForegroundColor DarkYellow
    continue
  }
  $value = ($line -split '=', 2)[1].Trim()
  if (-not $value) {
    Write-Host "  skip $name (empty)" -ForegroundColor DarkYellow
    continue
  }
  Write-Host "  add $name" -ForegroundColor Green
  $value | npx vercel@latest env add $name production --yes 2>&1
}

Write-Host ''
Write-Host '완료 후 Vercel Dashboard에서 Redeploy 하세요.' -ForegroundColor Cyan
