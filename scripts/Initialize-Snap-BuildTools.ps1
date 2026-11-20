function Initialize-SnapBuildTools {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $ErrorActionPreference = 'Stop'
    $sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
    $sdkVersion = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Lib') -Directory |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'um\x64\kernel32.lib') } |
        Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
    if (!$sdkVersion) { throw 'Install the Windows 10/11 SDK with the Visual Studio C++ Build Tools.' }

    $vcRoot = $env:VCToolsInstallDir
    if (!$vcRoot -or !(Test-Path -LiteralPath (Join-Path $vcRoot 'bin\Hostx64\x64\link.exe'))) {
        $vcRoot = $null
        $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
        if (Test-Path -LiteralPath $vswhere) {
            $installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
            if ($installation) {
                $toolsets = Join-Path $installation 'VC\Tools\MSVC'
                $vcRoot = Get-ChildItem -LiteralPath $toolsets -Directory |
                    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\Hostx64\x64\link.exe') } |
                    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 -ExpandProperty FullName
            }
        }
    }

    if (!$vcRoot) {
        # Visual Studio can leave valid Microsoft payloads cached after its
        # installation registration is lost. Restore only the x64 toolchain
        # into this project's cache; no system installation or admin is needed.
        $cacheRoot = [IO.Path]::GetFullPath((Join-Path $ProjectRoot '.cache\windows-build-tools'))
        $toolsets = Join-Path $cacheRoot 'VC\Tools\MSVC'
        if (Test-Path -LiteralPath $toolsets) {
            $vcRoot = Get-ChildItem -LiteralPath $toolsets -Directory |
                Where-Object {
                    (Test-Path -LiteralPath (Join-Path $_.FullName 'bin\Hostx64\x64\link.exe')) -and
                    (Test-Path -LiteralPath (Join-Path $_.FullName 'lib\x64\msvcrt.lib')) -and
                    (Test-Path -LiteralPath (Join-Path $_.FullName 'include\vcruntime.h'))
                } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 -ExpandProperty FullName
        }
        if (!$vcRoot) {
            $packageCache = Join-Path $env:ProgramData 'Microsoft\VisualStudio\Packages'
            $packages = @(Get-ChildItem -LiteralPath $packageCache -Directory -ErrorAction SilentlyContinue)
            $compiler = $packages | Where-Object { $_.Name -match '^Microsoft\.VC\.[\d.]+\.Tools\.HostX64\.TargetX64\.base,version=' } |
                Sort-Object { [version]([regex]::Match($_.Name, 'version=([\d.]+)').Groups[1].Value) } -Descending | Select-Object -First 1
            if (!$compiler) { throw 'Install the Desktop development with C++ workload in Visual Studio Build Tools, then run this build again.' }
            $family = [regex]::Match($compiler.Name, '^Microsoft\.VC\.([\d.]+)\.Tools').Groups[1].Value
            $prefix = '^Microsoft\.VC\.' + [regex]::Escape($family) + '\.'
            $required = @($compiler)
            foreach ($component in @('CRT.Headers.base', 'CRT.x64.Desktop.base', 'CRT.x64.Store.base', 'Tools.HostX64.TargetX64.Res.base')) {
                $pattern = $prefix + [regex]::Escape($component) + ',version='
                $package = $packages | Where-Object { $_.Name -match $pattern } |
                    Sort-Object { [version]([regex]::Match($_.Name, 'version=([\d.]+)').Groups[1].Value) } -Descending | Select-Object -First 1
                if (!$package) { throw "Cached Microsoft C++ component is missing: $component. Install the C++ Build Tools workload." }
                $required += $package
            }
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [IO.Directory]::CreateDirectory($cacheRoot) | Out-Null
            $cachePrefix = $cacheRoot.TrimEnd('\') + '\'
            foreach ($package in $required) {
                Write-Host "Restoring $($package.Name.Split(',')[0])"
                $archive = [IO.Compression.ZipFile]::OpenRead((Join-Path $package.FullName 'payload.vsix'))
                try {
                    foreach ($entry in $archive.Entries) {
                        if (!$entry.FullName.StartsWith('Contents/VC/Tools/MSVC/') -or !$entry.Name) { continue }
                        $relative = $entry.FullName.Substring('Contents/'.Length).Replace('/', '\')
                        $destination = [IO.Path]::GetFullPath((Join-Path $cacheRoot $relative))
                        if (!$destination.StartsWith($cachePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid compiler archive path.' }
                        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
                        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
                    }
                } finally { $archive.Dispose() }
            }
            $vcRoot = Get-ChildItem -LiteralPath $toolsets -Directory |
                Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\Hostx64\x64\link.exe') } |
                Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 -ExpandProperty FullName
        }
    }
    if (!$vcRoot) { throw 'Microsoft x64 C++ tools are unavailable.' }
    $vcRoot = $vcRoot.TrimEnd('\')
    $compilerBin = Join-Path $vcRoot 'bin\Hostx64\x64'
    $sdkBin = Join-Path $sdkRoot "bin\$($sdkVersion.Name)\x64"
    $sdkLib = Join-Path $sdkRoot "Lib\$($sdkVersion.Name)"
    $sdkInclude = Join-Path $sdkRoot "Include\$($sdkVersion.Name)"
    $requiredFiles = @(
        (Join-Path $compilerBin 'link.exe'), (Join-Path $compilerBin 'cl.exe'),
        (Join-Path $vcRoot 'lib\x64\msvcrt.lib'), (Join-Path $vcRoot 'lib\x64\vcruntime.lib'),
        (Join-Path $sdkBin 'rc.exe')
    )
    foreach ($file in $requiredFiles) {
        if (!(Test-Path -LiteralPath $file)) { throw "Required build tool is missing: $file" }
    }
    $env:Path = "$compilerBin;$sdkBin;$env:Path"
    $env:LIB = "$(Join-Path $vcRoot 'lib\x64');$(Join-Path $sdkLib 'ucrt\x64');$(Join-Path $sdkLib 'um\x64')"
    $env:INCLUDE = "$(Join-Path $vcRoot 'include');$(Join-Path $sdkInclude 'ucrt');$(Join-Path $sdkInclude 'shared');$(Join-Path $sdkInclude 'um');$(Join-Path $sdkInclude 'winrt');$(Join-Path $sdkInclude 'cppwinrt')"
    $env:VCToolsInstallDir = $vcRoot + '\'
    $env:VCINSTALLDIR = (Split-Path (Split-Path (Split-Path $vcRoot -Parent) -Parent) -Parent) + '\'
    $env:WindowsSdkDir = $sdkRoot + '\'
    $env:WindowsSDKVersion = $sdkVersion.Name + '\'
    $env:VSCMD_ARG_TGT_ARCH = 'x64'
    $env:VSCMD_ARG_HOST_ARCH = 'x64'
    $env:CC_x86_64_pc_windows_msvc = Join-Path $compilerBin 'cl.exe'
    $env:AR_x86_64_pc_windows_msvc = Join-Path $compilerBin 'lib.exe'
    Write-Host "Using MSVC $(Split-Path $vcRoot -Leaf) and Windows SDK $($sdkVersion.Name)."
    [pscustomobject]@{ Compiler = $vcRoot; Sdk = $sdkRoot; SdkVersion = $sdkVersion.Name }
}
