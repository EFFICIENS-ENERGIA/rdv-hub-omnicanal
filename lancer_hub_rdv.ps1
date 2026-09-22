# 🚀 Lanceur Local 1-Clic — RDV-Hub Omnicanal SaaS
# Démarre le serveur local et lance automatiquement le navigateur par défaut de Seb

$port = 8092
$sitePath = $PSScriptRoot
$url = "http://localhost:$port/index.html"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 🚀 LANCEMENT DU RDV-HUB SAAS (CENTRALISATION OMNICANALE)" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "• Emplacement du projet : $sitePath"
Write-Host "• Accès direct Navigateur : $url"

$pythonPath = "C:\Program Files\LibreOffice\program\python.exe"

if (Test-Path $pythonPath) {
    Write-Host "• Démarrage du serveur HTTP local sur le port $port..." -ForegroundColor Green
    $proc = Start-Process -FilePath $pythonPath -ArgumentList "-m", "http.server", "$port", "--directory", "$sitePath" -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 1
    Start-Process $url
    Write-Host "• Navigateur ouvert ! Appuyez sur Entrée pour arrêter le serveur local." -ForegroundColor Cyan
    Read-Host
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
} else {
    $fileUrl = "file:///" + ($sitePath.Replace('\', '/') + "/index.html")
    Write-Host "• Ouverture directe du fichier dans le navigateur : $fileUrl" -ForegroundColor Green
    Start-Process $fileUrl
}
