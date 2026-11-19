param(
    [string] $Checkout = (Join-Path (Split-Path $PSScriptRoot -Parent) 'node_modules\.cache\snap-publish-9.7.0'),
    [string] $Artifacts = (Join-Path (Split-Path $PSScriptRoot -Parent) 'release-artifacts')
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Publish-Snap.ps1') -Version '9.7.0' -Checkout $Checkout -Artifacts $Artifacts