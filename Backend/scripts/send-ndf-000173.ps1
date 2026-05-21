# Test NDF-000173 — Ghassen SAKOUHI / GROUPE MIND7
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$key = (Get-Content .env | Where-Object { $_ -match '^PARTNER_API_KEYS=' }) -replace '^PARTNER_API_KEYS=', ''
$port = (Get-Content .env | Where-Object { $_ -match '^PORT=' }) -replace '^PORT=', ''
if (-not $port) { $port = '8001' }

$jsonPath = Join-Path $PSScriptRoot "test-ndf-000173.json"
$uri = "http://localhost:$port/api/partner/invoices"

Write-Host "POST $uri"
curl.exe -s -w "`nHTTP:%{http_code}`n" -X POST $uri `
  -H "Content-Type: application/json" `
  -H "X-API-Key: $key" `
  --data-binary "@$jsonPath"
