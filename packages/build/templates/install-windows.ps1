# install-windows.ps1 - copy the built devices into the Ableton User Library
# (Max For Live\m4l-jweb), replacing any previous install.
#
# The User Library path is read from the newest Live preferences file
# (%APPDATA%\Ableton\Live <version>\Preferences\Library.cfg, <ProjectPath>);
# Live's default location is the fallback. No registry or env vars are involved -
# Live keeps all of this in plain config files.
#
# The folder of devices is FOUND (the one beside this script holding `.amxd`
# files), so the unzipped release installs itself with no arguments. -DeviceName and
# -Src are passed by `m4l-jweb install`, and those win.
param([string]$DeviceName = "", [string]$Src = "")
$ErrorActionPreference = "Stop"
$deviceName = $DeviceName

# WHERE THE DEVICES ARE. The name used to DEFAULT to the library's own
# ("m4l-jweb"), which is right in that repo and wrong in every consumer's release:
# the zip holds `m4l-gugelhupf\`, the script looked for `m4l-jweb\`, and a user who
# had unzipped a perfectly good build was told to go and run `pnpm build`.
#
# So the folder is DISCOVERED rather than assumed - it is the one next to this
# script with `.amxd` files in it - and the device name comes from what was found.
# An explicit -DeviceName / -Src still wins, which is how `m4l-jweb install` drives it.
$src = $Src
if (-not $src -and $deviceName) {
    foreach ($c in @((Join-Path $PSScriptRoot $deviceName), (Join-Path (Split-Path $PSScriptRoot) "dist\$deviceName"))) {
        if (@(Get-ChildItem (Join-Path $c "*.amxd") -ErrorAction SilentlyContinue).Count -gt 0) { $src = $c; break }
    }
}
if (-not $src) {
    # Next to this script covers the unzipped release AND dist\ after a build;
    # ..\dist\* covers running it straight out of a repo checkout.
    $roots = @($PSScriptRoot, (Join-Path (Split-Path $PSScriptRoot) "dist"))
    $candidates = @()
    foreach ($r in $roots) {
        foreach ($d in @(Get-ChildItem $r -Directory -ErrorAction SilentlyContinue)) {
            if (@(Get-ChildItem (Join-Path $d.FullName "*.amxd") -ErrorAction SilentlyContinue).Count -gt 0) {
                $candidates += $d.FullName
            }
        }
    }
    if ($candidates.Count -gt 1) {
        Write-Error "More than one folder of devices here. Name the one you want: .\$(Split-Path $PSCommandPath -Leaf) -DeviceName <folder-name>"
    }
    if ($candidates.Count -eq 1) { $src = $candidates[0] }
}
$devices = @(Get-ChildItem (Join-Path $src "*.amxd") -ErrorAction SilentlyContinue)
if ($devices.Count -eq 0) {
    Write-Error "No .amxd found. Looked next to this script ($PSScriptRoot) and in $(Join-Path (Split-Path $PSScriptRoot) 'dist'). From the release zip, run this script where you unzipped it - the devices are in the folder beside it."
}
# The folder's own name is the name the User Library gets, so a repo scaffolded
# under any name installs under that name without being told what it is.
if (-not $deviceName) { $deviceName = Split-Path $src -Leaf }

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
# The folder is NOT wiped first. It is the same folder the devices SAVE INTO - exports,
# downloaded samples, anything a user dragged out of it - so clearing it to get a clean
# install threw away their work, and failed outright the moment Live held one of those
# files open. Overwrite what this build produces; leave everything else alone.
New-Item -ItemType Directory -Force $dest | Out-Null

# Each .amxd is self-contained: the UI rides inside it as a payload in wrapper.js.
foreach ($f in $devices) {
    try {
        Copy-Item $f.FullName $dest -Force -ErrorAction Stop
        Write-Host "  installed $($f.Name)"
    } catch {
        Write-Error "Could not replace $($f.Name) - it is open in Live. Close the set (or remove the device from the track) and run this again."
    }
}

# Presets (hand-saved Live racks, packaged next to the devices by the build) go in
# the same folder, so a rack that names these devices finds them one drag away.
foreach ($f in @(Get-ChildItem (Join-Path $src "*.adg") -ErrorAction SilentlyContinue) + @(Get-ChildItem (Join-Path $src "*.adv") -ErrorAction SilentlyContinue)) {
    Copy-Item $f.FullName $dest -Force
    Write-Host "  installed $($f.Name) (preset)"
}

# A `site:` window's content is a whole prebuilt site - too big to ride inside the
# .amxd as a payload - so it ships as a folder NEXT TO the device and has to be
# installed with it. Without the folder the device still plays; that window opens
# empty, and the wrapper says so in the Max console.
foreach ($d in @(Get-ChildItem (Join-Path $src "*-site") -Directory -ErrorAction SilentlyContinue)) {
    # This one IS replaced wholesale: it is entirely build output, and a file dropped
    # from the site between builds would otherwise linger and be served.
    $siteTarget = Join-Path $dest $d.Name
    if (Test-Path $siteTarget) { Remove-Item $siteTarget -Recurse -Force }
    Copy-Item $d.FullName $dest -Recurse -Force
    Write-Host "  installed $($d.Name)/ (site sidecar)"
}

# The manual and anything else the release carries for a person rather than for Max.
foreach ($f in @(Get-ChildItem (Join-Path $src "*.pdf") -ErrorAction SilentlyContinue) + @(Get-ChildItem (Join-Path $src "*.md") -ErrorAction SilentlyContinue)) {
    Copy-Item $f.FullName $dest -Force
    Write-Host "  installed $($f.Name) (doc)"
}

Write-Host "Installed to $dest"
Write-Host "In Live: User Library > Max For Live > $deviceName"
Write-Host "NOTE: Live embeds a copy of the device in the set. Instances already"
Write-Host "      on a track will NOT update - delete and re-drag them."
