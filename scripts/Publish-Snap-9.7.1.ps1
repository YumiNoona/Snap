param(
    [string] $Checkout = (Join-Path (Split-Path $PSScriptRoot -Parent) 'node_modules\.cache\snap-publish-9.7.1'),
    [string] $Artifacts = (Join-Path (Split-Path $PSScriptRoot -Parent) 'release-artifacts\v9.7.1')
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Publish-Snap.ps1') -Version '9.7.1' -Checkout $Checkout -Artifacts $Artifacts