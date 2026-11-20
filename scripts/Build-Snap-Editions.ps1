param([string]$Version = '', [string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$desktopVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if (!$Version) { $Version = $desktopVersion }
if ($Version -ne $desktopVersion) { throw "Build version must match package.json ($desktopVersion)." }
. (Join-Path $PSScriptRoot 'Initialize-Snap-BuildTools.ps1')
Initialize-SnapBuildTools -ProjectRoot $projectRoot | Out-Null
if (!$OutputDirectory) { $OutputDirectory = Join-Path $projectRoot "release-artifacts\v$Version" }
if (![IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory = Join-Path $projectRoot $OutputDirectory }
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$buildRecords = @()
function Assert-WindowsX64Exe([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $reader = New-Object IO.BinaryReader($stream)
    try {
        if ($reader.ReadUInt16() -ne 0x5A4D) { throw 'Output is not a Windows executable.' }
        [void]$stream.Seek(0x3C, [IO.SeekOrigin]::Begin)
        $header = $reader.ReadUInt32()
        [void]$stream.Seek($header, [IO.SeekOrigin]::Begin)
        if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'Output is not a Windows x64 executable.' }
        [void]$stream.Seek($header + 92, [IO.SeekOrigin]::Begin)
        if ($reader.ReadUInt16() -ne 2) { throw 'Output must use the Windows GUI subsystem.' }
    } finally { $reader.Dispose(); $stream.Dispose() }
}
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
        $binary = Get-Item -LiteralPath $source
        $product = if ($edition -eq 'full') { 'Snap' } else { "Snap $((Get-Culture).TextInfo.ToTitleCase($edition))" }
        if ($binary.VersionInfo.ProductVersion -ne $Version) { throw "Unexpected executable version for $edition." }
        if ($binary.VersionInfo.ProductName -ne $product) { throw "Unexpected product identity for $edition`: $($binary.VersionInfo.ProductName)." }
        Assert-WindowsX64Exe $source
        $destination = Join-Path $OutputDirectory $name
        Copy-Item -LiteralPath $source -Destination $destination -Force
        $digest = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        [IO.File]::WriteAllText("$destination.sha256", "$digest  $name`n", (New-Object Text.UTF8Encoding($false)))
        $buildRecords += [ordered]@{ edition = $edition; file = $name; product = $product; version = $Version; bytes = $binary.Length; sha256 = $digest }
        Write-Host "Prepared $name ($digest)"
    }
    if (@($buildRecords.sha256 | Select-Object -Unique).Count -ne 3) { throw 'The three editions must be distinct builds.' }
    $record = [ordered]@{ version = $Version; builtAt = [DateTime]::UtcNow.ToString('o'); architecture = 'x64'; editions = $buildRecords }
    [IO.File]::WriteAllText((Join-Path $OutputDirectory 'build-info.json'), ($record | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
    Write-Host "Verified all three editions in $OutputDirectory"
} finally { Set-Location -LiteralPath $originalDirectory }
