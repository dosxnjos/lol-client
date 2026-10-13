# desfaz o tools\instalar-gatilho.ps1: apaga a tarefa "lol-client-coletor" e devolve a
# auditoria de "Criacao de processo" ao estado salvo em dados\auditoria-anterior.txt.
# Nao para um coletor ja rodando (ele sai sozinho 10 min sem client). Exige PowerShell elevado.
# Arquivo sem acentos de proposito: o Windows PowerShell 5.1 le .ps1 sem BOM como ANSI.
$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $PSScriptRoot
$Anterior = Join-Path $Raiz 'dados\auditoria-anterior.txt'
$Tarefa = 'lol-client-coletor'

if (Get-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $Tarefa -Confirm:$false
    Write-Output "tarefa $Tarefa removida"
} else {
    Write-Output "tarefa $Tarefa nao existia"
}

if (-not (Test-Path $Anterior)) {
    Write-Output "sem ${Anterior}: auditoria mantida como esta"
    return
}
$cfg = @{}
Get-Content $Anterior | ForEach-Object { $k, $v = $_ -split '=', 2; $cfg[$k] = $v }
$valor = [int]$cfg['valor']
$sucesso = if ($valor -band 1) { 'enable' } else { 'disable' }
$falha = if ($valor -band 2) { 'enable' } else { 'disable' }
& auditpol.exe /set "/subcategory:$($cfg['guid'])" "/success:$sucesso" "/failure:$falha" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "auditpol /set falhou (rc $LASTEXITCODE)" }
Remove-Item $Anterior -Force
Write-Output "auditoria restaurada: sucesso=$sucesso falha=$falha"
Write-Output (& auditpol.exe /get "/subcategory:$($cfg['guid'])" /r | Where-Object { $_ } | Select-Object -Last 1)
