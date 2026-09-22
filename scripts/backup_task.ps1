<#
.SYNOPSIS
    Script d'automatisation des sauvegardes RDV-Hub SaaS pour Planificateur de tâches Windows (Task Scheduler).
.DESCRIPTION
    Exécute backup_data.py avec rotation des logs dans docker/logs/backup.log.
.EXAMPLE
    # Exécution ponctuelle
    .\scripts\backup_task.ps1
    
    # Création d'une tâche planifiée quotidienne à 02:00
    $Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-ExecutionPolicy Bypass -File "C:\Chemin\rdv_hub_omnicanal\scripts\backup_task.ps1"'
    $Trigger = New-ScheduledTaskTrigger -Daily -At 2am
    Register-ScheduledTask -TaskName "RDV-Hub-Daily-Backup" -Action $Action -Trigger $Trigger
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
Set-Location -Path $ProjectDir

$LogDir = Join-Path $ProjectDir "docker\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir "backup.log"

$timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"
Add-Content -Path $LogFile -Value "[$timestamp] [TASK] Début de la sauvegarde planifiée..."

$pythonBin = "python"
if (Test-Path "C:\Program Files\LibreOffice\program\python.exe") {
    $pythonBin = "C:\Program Files\LibreOffice\program\python.exe"
}

$output = & $pythonBin "$ScriptDir\backup_data.py" --cron 2>&1
$exitCode = $LASTEXITCODE

Add-Content -Path $LogFile -Value "[$timestamp] [RESULT] Code de retour: $exitCode | Détails: $output"

if ($exitCode -eq 0) {
    Write-Host "✅ Sauvegarde terminée avec succès." -ForegroundColor Green
    exit 0
} else {
    Write-Host "❌ Échec de la sauvegarde." -ForegroundColor Red
    exit 1
}
