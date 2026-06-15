# .env.local 값을 Vercel Environment Variables 에 붙여 넣기용으로 출력합니다.
# 사용: PowerShell 에서  cd C:\dev\zebssak  후  .\scripts\vercel-env-from-local.ps1

$envFile = Join-Path (Join-Path $PSScriptRoot '..') '.env.local' |
  Resolve-Path -ErrorAction SilentlyContinue
if (-not $envFile) {
  Write-Host 'ERROR: .env.local 이 없습니다. .env.example 을 복사해 .env.local 을 만드세요.' -ForegroundColor Red
  exit 1
}

$required = @(
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'JWT_SECRET'
)
$optional = @(
  'SEOUL_METRO_POSITION_API_KEY',
  'SEOUL_METRO_ARRIVAL_API_KEY',
  'SEOUL_METRO_API_KEY',
  'PUBLIC_DATA_API_KEY',
  'ADMIN_SECRET'
)

function Read-EnvMap([string]$path) {
  $map = @{}
  Get-Content $path -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    if ($val.StartsWith('"') -and $val.EndsWith('"')) {
      $val = $val.Substring(1, $val.Length - 2)
    }
    $map[$key] = $val
  }
  return $map
}

$vars = Read-EnvMap $envFile

Write-Host ''
Write-Host '========== Vercel 에 넣을 변수 (Production) ==========' -ForegroundColor Cyan
Write-Host 'Dashboard → zebssak → Settings → Environment Variables' -ForegroundColor DarkGray
Write-Host '추가 후 Deployments → Redeploy 필수' -ForegroundColor DarkGray
Write-Host ''

function Show-Key([string]$key, [bool]$isRequired) {
  $has = $vars.ContainsKey($key) -and $vars[$key].Length -gt 0
  $tag = if ($isRequired) { '[필수]' } else { '[선택]' }
  $status = if ($has) { 'OK' } else { '비어 있음' }
  $color = if ($has) { 'Green' } else { if ($isRequired) { 'Red' } else { 'Yellow' } }
  Write-Host "$tag $key → $status" -ForegroundColor $color
  if ($has) {
    Write-Host "  Name:  $key"
    Write-Host "  Value: $($vars[$key])"
    Write-Host ''
  }
}

Write-Host '--- 필수 (로그인에 필요) ---' -ForegroundColor White
foreach ($k in $required) { Show-Key $k $true }

Write-Host '--- 선택 (역/열차/관리) ---' -ForegroundColor White
foreach ($k in $optional) { Show-Key $k $false }

$missingRequired = $required | Where-Object { -not $vars.ContainsKey($_) -or $vars[$_].Length -eq 0 }
if ($missingRequired.Count -gt 0) {
  Write-Host 'ERROR: .env.local 에 필수 값이 없습니다:' -ForegroundColor Red
  $missingRequired | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}

Write-Host '========== 끝 ==========' -ForegroundColor Cyan
Write-Host '위 Name / Value 를 Vercel 에 한 줄씩 등록하세요. 키는 GitHub 에 올리지 마세요.' -ForegroundColor DarkGray
