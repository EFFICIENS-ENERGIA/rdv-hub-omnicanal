<#
.SYNOPSIS
    Point d'entrée racine deploy.ps1 délégant vers scripts/deploy.ps1.
#>

[CmdletBinding()]
param(
    [switch]$Prod,
    [switch]$SkipGit,
    [switch]$SimulateFailure,
    [switch]$DryRun
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$ScriptDir\scripts\deploy.ps1" -Prod:$Prod -SkipGit:$SkipGit -SimulateFailure:$SimulateFailure -DryRun:$DryRun
