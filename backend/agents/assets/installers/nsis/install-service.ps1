# MSPByte Agent Core — Windows service registration helper
# Called from the NSIS installer; can also be run standalone for manual installs.
# Requires elevation (Run as Administrator).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install-service.ps1 `
#       -ServerUrl "https://agents.mspbyte.com" `
#       -EnrollmentToken "tok_live_..." `
#       -InstallDir "C:\ProgramData\MSPAgent"
#
param(
    [Parameter(Mandatory=$true)]  [string]$ServerUrl,
    [Parameter(Mandatory=$true)]  [string]$EnrollmentToken,
    [string]$InstallDir   = "C:\ProgramData\MSPAgent",
    [string]$BinaryPath   = "",
    [string]$ServiceName  = "MSPAgentCore",
    [string]$DisplayName  = "MSPByte Agent Core"
)

$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Must be run as Administrator."
    exit 1
}

if (-not $BinaryPath) {
    $BinaryPath = Join-Path $InstallDir "agent-core.exe"
}

# Ensure install dir exists
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Write config.toml if it doesn't already exist
$ConfigPath = Join-Path $InstallDir "config.toml"
if (-not (Test-Path $ConfigPath)) {
    @"
[agent]
server_url = "$ServerUrl"
enrollment_token = "$EnrollmentToken"
"@ | Set-Content -Encoding UTF8 $ConfigPath
    Write-Host "Wrote $ConfigPath"
}

# Remove existing service if present
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Stopping existing service…"
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
}

# Create the service
Write-Host "Creating Windows service '$ServiceName'…"
New-Service -Name $ServiceName `
            -BinaryPathName "`"$BinaryPath`"" `
            -DisplayName $DisplayName `
            -Description "MSPByte end-user support agent core" `
            -StartupType Automatic | Out-Null

# Configure failure recovery: restart after 60 s on first three failures
sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null

# Start
Write-Host "Starting service…"
Start-Service -Name $ServiceName
Write-Host "Done. Service status:"
Get-Service -Name $ServiceName | Format-List Name, Status, StartType
