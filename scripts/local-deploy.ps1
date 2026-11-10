<#
.SYNOPSIS
  Build FlightOps from this folder and (re)start it locally in Docker.

.DESCRIPTION
  Rebuilds the app and relay images from your CURRENT working tree (committed or not, pushed or not),
  restarts the containers, and waits until both report healthy.

    App:    http://localhost:8080
    Relay:  http://localhost:8787   (optional; set it under Settings -> Integrations hub -> Relay)

  Your workspace data lives in your browser (or a folder you connect in Settings), so rebuilding never touches it.
  Relay snapshots live in the "relay-data" Docker volume and also survive rebuilds.

.PARAMETER Token
  Optional relay access token. Also enter the same value in Settings -> Relay -> Access token.
  If omitted, the RELAY_TOKEN environment variable (or a .env file next to docker-compose.yml) is used.

.PARAMETER Stop
  Stop the local containers instead of starting them (data is kept).

.PARAMETER Down
  Stop and remove the containers (the relay-data volume is kept).

.EXAMPLE
  ./scripts/local-deploy.ps1
  ./scripts/local-deploy.ps1 -Token "a-long-random-string"
  ./scripts/local-deploy.ps1 -Stop
#>
[CmdletBinding()]
param(
  [string]$Token,
  [switch]$Stop,
  [switch]$Down
)

# Native tools (docker) write progress/warnings to stderr; keep going and check exit codes explicitly instead.
$ErrorActionPreference = "Continue"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker isn't installed or isn't on PATH." }
$null = (docker info 2>&1)
if ($LASTEXITCODE -ne 0) { throw "Docker is installed but its engine isn't running. Start Docker Desktop (or the engine) and try again." }

if ($Stop) { docker compose stop 2>&1 | ForEach-Object { "$_" }; Write-Host "Stopped. Run this script again to start it." ; return }
if ($Down) { docker compose down 2>&1 | ForEach-Object { "$_" }; Write-Host "Containers removed (relay-data volume kept)."; return }

if ($Token) { $env:RELAY_TOKEN = $Token }

Write-Host "Building from $(Get-Location) ..." -ForegroundColor Cyan
docker compose up -d --build 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) { throw "docker compose failed (see output above)." }

function Wait-Url([string]$Url, [int]$Seconds = 60) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try { if ((Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { return $true } } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}

$appOk = Wait-Url "http://localhost:8080/"
$relayOk = Wait-Url "http://localhost:8787/health"

Write-Host ""
Write-Host ("App    http://localhost:8080        " + $(if ($appOk) { "UP" } else { "NOT RESPONDING" })) -ForegroundColor $(if ($appOk) { "Green" } else { "Red" })
Write-Host ("Relay  http://localhost:8787/health " + $(if ($relayOk) { "UP" } else { "NOT RESPONDING" })) -ForegroundColor $(if ($relayOk) { "Green" } else { "Red" })
if ($env:RELAY_TOKEN) { Write-Host "Relay token is set: enter it in Settings -> Relay -> Access token." }
else { Write-Host "No relay token set (fine for a private machine; use -Token to require one)." -ForegroundColor DarkYellow }
if (-not ($appOk -and $relayOk)) { Write-Host "Check logs with: docker compose logs" -ForegroundColor Yellow; exit 1 }
