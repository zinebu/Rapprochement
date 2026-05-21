# Test envoi note de frais NDF-000175 vers l'API partenaire
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot + "\.."

$key = (Get-Content .env | Where-Object { $_ -match '^PARTNER_API_KEYS=' }) -replace '^PARTNER_API_KEYS=', ''
$port = (Get-Content .env | Where-Object { $_ -match '^PORT=' }) -replace '^PORT=', ''
if (-not $port) { $port = '8001' }

$uri = "http://localhost:$port/api/partner/invoices"
$jsonPath = Join-Path $PSScriptRoot "test-ndf-000175.json"

Write-Host "POST $uri"
Write-Host "Body: $jsonPath"
Write-Host ""

curl.exe -s -w "`nHTTP:%{http_code}`n" -X POST $uri `
  -H "Content-Type: application/json" `
  -H "X-API-Key: $key" `
  --data-binary "@$jsonPath"
