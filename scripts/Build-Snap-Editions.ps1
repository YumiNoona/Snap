param([string]$Version = '9.8.0', [string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (!$OutputDirectory) { $OutputDirectory = Join-Path $projectRoot "release-artifacts\v$Version" }
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$originalDirectory = Get-Location
try {
    Set-Location -LiteralPath $projectRoot
    foreach ($edition in @('full','recorder','editor')) {
        $arguments = @('run','tauri','build','--','--no-bundle')
        if ($edition -ne 'full') { $arguments += @('--config',"src-tauri/tauri.$edition.conf.json",'--features',"$edition-only") }
        & npm @arguments
        if ($LASTEXITCODE -ne 0) { throw "The $edition build failed (exit $LASTEXITCODE)." }
        $assets = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'dist\assets') -File
        if ($edition -eq 'recorder' -and @($assets | Where-Object { $_.Name -match '^(Editor|AutoClips)-.*\.js$' }).Count) { throw 'Recorder build unexpectedly includes the editor UI.' }
        if ($edition -eq 'editor' -and @($assets | Where-Object { $_.Name -match '^(RecorderLauncher|RecordingDock|RecordingOverlay|DeviceView)-.*\.js$' }).Count) { throw 'Editor build unexpectedly includes the recorder UI.' }
        $name = if ($edition -eq 'full') { "Snap_${Version}_x64.exe" } else { "Snap_$((Get-Culture).TextInfo.ToTitleCase($edition))_${Version}_x64.exe" }
        $source = Join-Path $projectRoot 'src-tauri\target\release\snap.exe'
        if ((Get-Item -LiteralPath $source).VersionInfo.ProductVersion -ne $Version) { throw "Unexpected executable version for $edition." }
        $destination = Join-Path $OutputDirectory $name
        Copy-Item -LiteralPath $source -Destination $destination -Force
        $digest = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        [IO.File]::WriteAllText("$destination.sha256", "$digest  $name`n", (New-Object Text.UTF8Encoding($false)))
        Write-Host "Prepared $name ($digest)"
    }
} finally { Set-Location -LiteralPath $originalDirectory }
