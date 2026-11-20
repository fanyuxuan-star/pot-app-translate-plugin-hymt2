# Install and start the Hy-MT2 local relay.
# Run this once as the current user (no administrator required).

$ErrorActionPreference = "Stop"

$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:APPDATA "pot-hymt2-relay"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$relaySource = Join-Path $sourceDir "relay-hymt2.js"
$vbsPath = Join-Path $installDir "start-relay.vbs"

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item -LiteralPath $relaySource -Destination (Join-Path $installDir "relay-hymt2.js") -Force

$vbs = @"
' Start Pot x Hy-MT2 local relay (hidden window)
Option Explicit

Dim fso, shell, baseDir, scriptPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = fso.BuildPath(baseDir, "relay-hymt2.js")

shell.CurrentDirectory = baseDir
shell.Run """" & "$nodePath" & """ """ & scriptPath & """", 0, False
"@

Set-Content -LiteralPath $vbsPath -Value $vbs -Encoding ASCII

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
New-ItemProperty -Path $runKey -Name "PotHymt2Relay" `
    -Value "wscript.exe `"$vbsPath`"" -PropertyType String -Force | Out-Null

Write-Host "Relay installed to: $installDir"
Write-Host "Autostart entry:   HKCU\Software\Microsoft\Windows\CurrentVersion\Run\PotHymt2Relay"

Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbsPath`""
Start-Sleep -Seconds 2

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:18766/health" -TimeoutSec 3
    Write-Host ("Relay is running: " + ($health | ConvertTo-Json -Compress))
} catch {
    Write-Warning "Relay did not answer on 127.0.0.1:18766. Check that Node.js is installed, then run start-relay.vbs again."
}

Write-Host ""
Write-Host "The plugin checks this relay automatically. No plugin config change is needed."
