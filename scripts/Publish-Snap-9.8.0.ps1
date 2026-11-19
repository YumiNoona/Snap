param(
    [string]$Checkout = (Join-Path (Split-Path $PSScriptRoot -Parent) 'node_modules\.cache\snap-publish-9.8.0'),
    [string]$Artifacts = (Join-Path (Split-Path $PSScriptRoot -Parent) 'release-artifacts\v9.8.0')
)
$ErrorActionPreference = 'Stop'
$repository = 'YumiNoona/Snap'
$tag = 'v9.8.0'
function Check-Exit([string]$Operation) { if ($LASTEXITCODE -ne 0) { throw "$Operation failed (exit $LASTEXITCODE)." } }
function Get-SnapSha256([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
$build = Get-Content -LiteralPath (Join-Path $Artifacts 'build-info.json') -Raw | ConvertFrom-Json
$commit = & git -C $Checkout rev-parse HEAD
Check-Exit 'Release checkout check'
$tagCommit = & git -C $Checkout rev-parse "$tag^{commit}"
Check-Exit 'Release tag check'
$changes = & git -C $Checkout status --porcelain
Check-Exit 'Working tree check'
if ($changes -or $commit -ne $build.commit -or $tagCommit -ne $commit) { throw 'The prepared release source or tag has changed.' }
foreach ($asset in $build.executables) {
    $path = Join-Path $Artifacts $asset.name
    if ([Diagnostics.FileVersionInfo]::GetVersionInfo($path).ProductVersion -ne '9.8.0' -or (Get-SnapSha256 $path) -ne $asset.sha256) { throw "The verified $($asset.name) has changed." }
}
Write-Host 'Checking your signed-in GitHub account...'
$account = & gh api user --jq .login
Check-Exit 'GitHub authentication'
$canPush = & gh api "repos/$repository" --jq .permissions.push
Check-Exit 'Repository access'
if ($canPush -ne 'true') { throw "$account does not have push access to $repository." }
Write-Host "Publishing as $account"
$previousPrompt = [Environment]::GetEnvironmentVariable('GIT_TERMINAL_PROMPT','Process')
try {
    $env:GIT_TERMINAL_PROMPT = '0'
    & git -C $Checkout -c 'credential.helper=' -c 'credential.https://github.com.helper=' -c 'credential.https://github.com.helper=!gh auth git-credential' push --atomic origin HEAD:refs/heads/main "refs/tags/$tag"
    Check-Exit 'Source and tag push'
} finally { [Environment]::SetEnvironmentVariable('GIT_TERMINAL_PROMPT',$previousPrompt,'Process') }
Write-Host 'Waiting for the three Windows builds and signed installer...'
$runId = $null
for ($attempt=0; $attempt -lt 12 -and !$runId; $attempt++) {
    $runId = & gh run list --repo $repository --workflow release.yml --commit $commit --event push --limit 1 --json databaseId --jq '.[0].databaseId'
    Check-Exit 'Release workflow lookup'
    if (!$runId) { Start-Sleep -Seconds 5 }
}
if (!$runId) { throw 'Source pushed. Check GitHub Actions, then rerun this command once the release workflow appears.' }
& gh run watch $runId --repo $repository --interval 15 --exit-status
Check-Exit 'Windows release workflow'
# GitHub Actions builds and uploads all three editions from this exact commit.
# Do not replace those verified CI artifacts with a different machine's build.
$json = & gh release view $tag --repo $repository --json 'url,assets,isDraft,targetCommitish'
Check-Exit 'Published release lookup'
$release = $json | ConvertFrom-Json
if ($release.isDraft) { throw 'The release is still a draft.' }
$required = @('Snap_9.8.0_x64.exe','Snap_Recorder_9.8.0_x64.exe','Snap_Editor_9.8.0_x64.exe','Snap_9.8.0_x64-setup.exe','latest.json')
foreach ($name in $required) {
    if (!@($release.assets | Where-Object { $_.name -eq $name }).Count) { throw "The release is missing $name." }
}
foreach ($name in $required | Where-Object { $_ -notlike '*-setup.exe' -and $_ -like '*.exe' }) {
    if (!@($release.assets | Where-Object { $_.name -eq "$name.sha256" }).Count) { throw "The release is missing the checksum for $name." }
}
Write-Host $release.url
Write-Host 'Verified full Snap, Recorder, Editor, installer and updater manifest.'
