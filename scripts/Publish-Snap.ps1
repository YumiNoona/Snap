param(
    [Parameter(Mandatory=$true)][string] $Version,
    [Parameter(Mandatory=$true)][string] $Checkout,
    [Parameter(Mandatory=$true)][string] $Artifacts
)
$ErrorActionPreference = 'Stop'
$repository = 'YumiNoona/Snap'
$tag = "v$Version"
function Check-Exit([string] $Operation) { if ($LASTEXITCODE -ne 0) { throw "$Operation failed (exit $LASTEXITCODE)." } }

$build = Get-Content -LiteralPath (Join-Path $Artifacts 'build-info.json') -Raw | ConvertFrom-Json
$executable = Join-Path $Artifacts "Snap_${Version}_x64.exe"
$checksum = "$executable.sha256"
$commit = & git -C $Checkout rev-parse HEAD
Check-Exit 'Release checkout check'
$tagCommit = & git -C $Checkout rev-parse "$tag^{commit}"
Check-Exit 'Release tag check'
$changes = & git -C $Checkout status --porcelain
Check-Exit 'Working tree check'
if ($commit -ne $build.commit -or $tagCommit -ne $commit -or $changes) { throw 'The prepared checkout, release tag or build record has changed.' }
if ((Get-Item -LiteralPath $executable).VersionInfo.ProductVersion -ne $Version -or $build.version -ne $Version) { throw "The executable or build record is not version $Version." }
$digest = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
if ($digest -ne $build.sha256) { throw 'The executable differs from the verified build.' }
if ((Get-FileHash -LiteralPath $checksum -Algorithm SHA256).Hash.ToLowerInvariant() -ne $build.checksumSha256) { throw 'The checksum file differs from the verified build.' }

Write-Host 'Checking your signed-in GitHub account...'
$account = & gh api user --jq .login
Check-Exit 'GitHub authentication'
$canPush = & gh api "repos/$repository" --jq .permissions.push
Check-Exit 'Repository access check'
if ($canPush -ne 'true') { throw "$account does not have push access to $repository." }
Write-Host "Publishing as $account"
$previousGitPrompt = [Environment]::GetEnvironmentVariable('GIT_TERMINAL_PROMPT', 'Process')
try {
    $env:GIT_TERMINAL_PROMPT = '0'
    & git -C $Checkout -c 'credential.helper=' -c 'credential.https://github.com.helper=' -c 'credential.https://github.com.helper=!gh auth git-credential' push --atomic origin HEAD:refs/heads/main "refs/tags/$tag"
    Check-Exit 'Source and tag push using GitHub CLI credentials'
} finally { [Environment]::SetEnvironmentVariable('GIT_TERMINAL_PROMPT', $previousGitPrompt, 'Process') }

# The release workflow owns creation, publication and updater signatures.
# Wait before resolving assets: REST's tag endpoint may return 404 for a draft.
# Never create a competing draft while tauri-action is publishing the same tag.
Write-Host 'Waiting for the Windows installer workflow...'
$runId = $null
for ($attempt=0; $attempt -lt 12 -and !$runId; $attempt++) {
    $runId = & gh run list --repo $repository --workflow release.yml --commit $commit --event push --limit 1 --json databaseId --jq '.[0].databaseId'
    Check-Exit 'Installer workflow lookup'
    if (!$runId) { Start-Sleep -Seconds 5 }
}
if (!$runId) { throw 'Source was pushed, but the installer workflow has not appeared. Check GitHub Actions, then rerun this script.' }
& gh run watch $runId --repo $repository --interval 15 --exit-status
Check-Exit 'Windows installer workflow'

$viewJson = & gh release view $tag --repo $repository --json 'apiUrl,url'
Check-Exit 'Published release lookup'
$view = $viewJson | ConvertFrom-Json
if ($view.apiUrl -notmatch '^https://api\.github\.com/repos/YumiNoona/Snap/releases/\d+$') { throw 'Unexpected release API URL.' }
$releaseJson = & gh api $view.apiUrl
Check-Exit 'Release asset lookup by ID'
$release = $releaseJson | ConvertFrom-Json
if ($release.draft -or $release.tag_name -ne $tag) { throw 'The installer workflow has not published the expected release.' }
foreach ($file in @($executable, $checksum)) {
    $name = Split-Path $file -Leaf
    $asset = $release.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if ($asset) {
        $localDigest = 'sha256:' + (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($asset.digest -ne $localDigest) { throw "An existing $name has a different or unavailable checksum. Nothing was overwritten." }
    } else {
        & gh release upload $tag $file --repo $repository
        Check-Exit "Upload of $name"
    }
}
$publishedJson = & gh release view $tag --repo $repository --json 'url,assets'
Check-Exit 'Final release verification'
$published = $publishedJson | ConvertFrom-Json
foreach ($required in @("Snap_${Version}_x64.exe", "Snap_${Version}_x64-setup.exe", 'latest.json')) {
    if (!@($published.assets | Where-Object { $_.name -eq $required }).Count) { throw "Release is missing $required." }
}
Write-Host $published.url
Write-Host 'Verified standalone EXE, installer and updater manifest.'
