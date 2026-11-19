param(
    [string] $Checkout = (Join-Path (Split-Path $PSScriptRoot -Parent) 'node_modules\.cache\snap-publish-9.7.0'),
    [string] $Artifacts = (Join-Path (Split-Path $PSScriptRoot -Parent) 'release-artifacts')
)
$ErrorActionPreference = 'Stop'
$repository = 'YumiNoona/Snap'
$tag = 'v9.7.0'

function Check-Exit([string] $Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed (exit $LASTEXITCODE)." }
}

$build = Get-Content -LiteralPath (Join-Path $Artifacts 'build-info.json') -Raw | ConvertFrom-Json
$executable = Join-Path $Artifacts 'Snap_9.7.0_x64.exe'
$checksum = Join-Path $Artifacts 'Snap_9.7.0_x64.exe.sha256'
$notes = Join-Path $Checkout 'docs\release-9.7.0.md'
$commit = & git -C $Checkout rev-parse HEAD
Check-Exit 'Release checkout check'
$tagCommit = & git -C $Checkout rev-parse "$tag^{commit}"
Check-Exit 'Release tag check'
$changes = & git -C $Checkout status --porcelain
Check-Exit 'Working tree check'
if ($commit -ne $build.commit -or $tagCommit -ne $commit -or $changes) {
    throw 'The prepared release checkout, tag or build record has changed.'
}
if ((Get-Item -LiteralPath $executable).VersionInfo.ProductVersion -ne '9.7.0') {
    throw 'The executable does not report version 9.7.0.'
}
$digest = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
if ($digest -ne $build.sha256) { throw 'The executable differs from the verified build.' }
$checksumDigest = (Get-FileHash -LiteralPath $checksum -Algorithm SHA256).Hash.ToLowerInvariant()
if ($checksumDigest -ne $build.checksumSha256) { throw 'The checksum file differs from the verified build.' }

Write-Host 'Checking your signed-in GitHub account...'
$account = & gh api user --jq .login
Check-Exit 'GitHub authentication'
$canPush = & gh api "repos/$repository" --jq .permissions.push
Check-Exit 'Repository permission check'
if ($canPush -ne 'true') { throw "$account does not have push access to $repository." }
Write-Host "Publishing as $account"

Write-Host 'Pushing the prepared source commit and release tag...'
# Use the same authenticated account as the gh API checks above. Reset inherited
# helpers for this command so stale Git Credential Manager entries cannot win.
# Keep this scoped to the push; do not rewrite the user's global Git settings.
$previousGitPrompt = [Environment]::GetEnvironmentVariable('GIT_TERMINAL_PROMPT', 'Process')
try {
    $env:GIT_TERMINAL_PROMPT = '0'
    & git -C $Checkout `
        -c 'credential.helper=' `
        -c 'credential.https://github.com.helper=' `
        -c 'credential.https://github.com.helper=!gh auth git-credential' `
        push --atomic origin HEAD:refs/heads/main refs/tags/v9.7.0
    Check-Exit 'Source and tag push using GitHub CLI credentials'
} finally {
    [Environment]::SetEnvironmentVariable('GIT_TERMINAL_PROMPT', $previousGitPrompt, 'Process')
}

# Query the list: a missing release is expected on the first run, not an error.
$releases = & gh release list --repo $repository --limit 1000 --json tagName
Check-Exit 'Release lookup'
$exists = @($releases | ConvertFrom-Json | Where-Object { $_.tagName -eq $tag }).Count -gt 0
if (!$exists) {
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & gh release create $tag --repo $repository --verify-tag --title 'Snap 9.7.0' --notes-file $notes --draft
        $createExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prior }
    if ($createExit -ne 0) {
        # GitHub Actions may have created it concurrently.
        $releases = & gh release list --repo $repository --limit 1000 --json tagName
        Check-Exit 'Concurrent release lookup'
        if (!@($releases | ConvertFrom-Json | Where-Object { $_.tagName -eq $tag }).Count) {
            throw "Release creation failed (exit $createExit)."
        }
    }
}

$releaseJson = & gh api "repos/$repository/releases/tags/$tag"
Check-Exit 'Release asset lookup'
$release = $releaseJson | ConvertFrom-Json
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
& gh release edit $tag --repo $repository --notes-file $notes --draft=false --latest
Check-Exit 'Release publication'
Write-Host "Published standalone EXE: https://github.com/$repository/releases/tag/$tag"

$runId = $null
for ($attempt=0; $attempt -lt 12 -and !$runId; $attempt++) {
    $runId = & gh run list --repo $repository --workflow release.yml --commit $commit --event push --limit 1 --json databaseId --jq '.[0].databaseId'
    Check-Exit 'Installer workflow lookup'
    if (!$runId) { Start-Sleep -Seconds 5 }
}
if (!$runId) { throw 'The EXE is uploaded, but the installer workflow has not appeared. Check GitHub Actions.' }
& gh run watch $runId --repo $repository --interval 15 --exit-status
Check-Exit 'Windows installer workflow'
$publishedJson = & gh release view $tag --repo $repository --json url,assets
Check-Exit 'Published release verification'
$published = $publishedJson | ConvertFrom-Json
foreach ($required in @('Snap_9.7.0_x64.exe', 'Snap_9.7.0_x64-setup.exe', 'latest.json')) {
    if (!@($published.assets | Where-Object { $_.name -eq $required }).Count) { throw "Release is missing $required." }
}
Write-Host $published.url
Write-Host 'Verified standalone EXE, installer and updater manifest.'
