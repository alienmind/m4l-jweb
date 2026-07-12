# install-windows.ps1 - copy the built devices into the Ableton User Library
# (Max For Live\m4l-jweb), replacing any previous install.
#
# The User Library path is read from the newest Live preferences file
# (%APPDATA%\Ableton\Live <version>\Preferences\Library.cfg, <ProjectPath>);
# Live's default location is the fallback. No registry or env vars are involved -
# Live keeps all of this in plain config files.
#
# The device-folder name defaults to this repo's, and `m4l-jweb install` passes
# the package name explicitly - so a repo scaffolded under another name works.
# -Src is passed by `m4l-jweb install`; standalone (from the zip) it is found
# next to this script.
param([string]$DeviceName = "m4l-jweb", [string]$Src = "")
$ErrorActionPreference = "Stop"
$deviceName = $DeviceName

# Source: an explicit -Src, else ./<name> next to this script (zip and dist
# layouts), else ../dist/<name> (running it straight from a repo checkout).
$src = $Src
if (-not $src) {
    $src = Join-Path $PSScriptRoot $deviceName
    if (-not (Test-Path $src)) {
        $src = Join-Path (Split-Path $PSScriptRoot) "dist\$deviceName"
    }
}
$devices = @(Get-ChildItem (Join-Path $src "*.amxd") -ErrorAction SilentlyContinue)
if ($devices.Count -eq 0) {
    Write-Error "No .amxd found next to this script or in dist\. Run 'pnpm build' first."
}

# User Library: newest Library.cfg wins.
$userLib = $null
$cfg = Get-ChildItem "$env:APPDATA\Ableton\Live *\Preferences\Library.cfg" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($cfg) {
    $m = [regex]::Match((Get-Content $cfg.FullName -Raw), '<ProjectPath Value="([^"]+)"')
    if ($m.Success) {
        $p = $m.Groups[1].Value -replace "/", "\"
        # ProjectPath may point at the library root that contains "User Library".
        if (Test-Path (Join-Path $p "User Library")) { $userLib = Join-Path $p "User Library" }
        elseif (Test-Path $p) { $userLib = $p }
    }
}
if (-not $userLib) {
    $userLib = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Ableton\User Library"
}
if (-not (Test-Path $userLib)) {
    Write-Error "Ableton User Library not found ($userLib). Is Live installed?"
}

$dest = Join-Path $userLib "Max For Live\$deviceName"
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force $dest | Out-Null

# Each .amxd is self-contained: the UI rides inside it as a payload in wrapper.js.
foreach ($f in $devices) {
    Copy-Item $f.FullName $dest -Force
    Write-Host "  installed $($f.Name)"
}

Write-Host "Installed to $dest"
Write-Host "In Live: User Library > Max For Live > $deviceName"
Write-Host "NOTE: Live embeds a copy of the device in the set. Instances already"
Write-Host "      on a track will NOT update - delete and re-drag them."
