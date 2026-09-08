# MSPByte Agent Core — Windows service registration helper
# Called from the NSIS installer; can also be run standalone for manual installs.
# Requires elevation (Run as Administrator).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install-service.ps1 `
#       -ServerUrl "https://agents.mspbyte.com" `
#       -OrgId "<org-id>" `
#       -EnrollmentToken "tok_live_..." `
#       -InstallDir "C:\ProgramData\MSPAgent"
#
param(
    [Parameter(Mandatory=$true)]  [string]$ServerUrl,
    [Parameter(Mandatory=$true)]  [string]$OrgId,
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

$LogDir  = Join-Path $InstallDir "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir "install.log"
function Write-ILog {
    param([string]$Message)
    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $line = "[$ts] $Message"
    Write-Host $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

Write-ILog "=== MSPByte Agent Core install — $(Get-Date -Format 'u') ==="
Write-ILog "  server:   $ServerUrl"
Write-ILog "  binary:   $BinaryPath"

# Write config.toml if it doesn't already exist
$ConfigPath = Join-Path $InstallDir "config.toml"
if (-not (Test-Path $ConfigPath)) {
    @"
[agent]
server_url = "$ServerUrl"
org_id = "$OrgId"
enrollment_token = "$EnrollmentToken"
"@ | Set-Content -Encoding UTF8 $ConfigPath
    Write-ILog "Wrote $ConfigPath"
} else {
    Write-ILog "Preserved existing $ConfigPath"
}

# Remove existing service if present
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-ILog "Stopping existing service..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
    Write-ILog "Existing service removed"
}

# Create the service
Write-ILog "Creating Windows service '$ServiceName'..."
New-Service -Name $ServiceName `
            -BinaryPathName "`"$BinaryPath`"" `
            -DisplayName $DisplayName `
            -Description "MSPByte end-user support agent core" `
            -StartupType Automatic | Out-Null

# Configure failure recovery: restart after 60 s on first three failures
sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null

# Start
Write-ILog "Starting service..."
Start-Service -Name $ServiceName
Write-ILog "=== install complete ==="

Write-Host "Done. Service status:"
Get-Service -Name $ServiceName | Format-List Name, Status, StartType
