# instala o gatilho do coletor: o Windows abre o coletor quando o LeagueClientUx.exe nasce.
# 1) salva a auditoria atual de "Criacao de processo" em dados\auditoria-anterior.txt (so na 1a vez)
# 2) liga a auditoria de sucesso (evento 4688 no log Security)
# 3) registra a tarefa "lol-client-coletor" com gatilho de evento 4688 filtrado pelo LeagueClientUx.exe
# Reverter: tools\remover-gatilho.ps1. Exige PowerShell elevado.
# Arquivo sem acentos de proposito: o Windows PowerShell 5.1 le .ps1 sem BOM como ANSI.
param(
    [string]$ClientExe = 'C:\Games\Riot Games\League of Legends\LeagueClientUx.exe',
    [string]$Pythonw = ''
)
$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $PSScriptRoot
$Coletor = Join-Path $Raiz 'coletor\coletor.py'
$Dados = Join-Path $Raiz 'dados'
$Anterior = Join-Path $Dados 'auditoria-anterior.txt'
$Tarefa = 'lol-client-coletor'

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'rode num PowerShell elevado (auditpol e o log Security exigem admin)'
}
New-Item -ItemType Directory -Force -Path $Dados | Out-Null

# GUID da subcategoria "Criacao de processo": procurado pelo prefixo, porque o nome e localizado (pt-BR)
$linha = & auditpol.exe /list /subcategory:* /v | Select-String -Pattern '\{0CCE922B-[0-9A-F-]+\}'
if (-not $linha) { throw 'subcategoria 0CCE922B (criacao de processo) nao encontrada no auditpol' }
$Guid = $linha.Matches[0].Value

# 1) estado anterior, pelo valor numerico do /backup (0 nada, 1 sucesso, 2 falha, 3 os dois)
if (Test-Path $Anterior) {
    Write-Output "auditoria anterior ja salva em $Anterior (mantida)"
} else {
    $tmp = Join-Path $env:TEMP 'lol-client-auditpol.csv'
    & auditpol.exe /backup "/file:$tmp" | Out-Null
    # cabecalho localizado (pt-BR): le por posicao
    $cols = 'maquina', 'destino', 'sub', 'guid', 'inclusao', 'exclusao', 'valor'
    $reg = Get-Content $tmp | Select-Object -Skip 1 | ConvertFrom-Csv -Header $cols |
        Where-Object { $_.guid -eq $Guid } | Select-Object -First 1
    Remove-Item $tmp -Force
    $valor = if ($reg) { $reg.valor } else { '0' }
    if (-not $valor) { $valor = '0' }
    Set-Content -Path $Anterior -Encoding ASCII -Value @("guid=$Guid", "valor=$valor")
    Write-Output "auditoria anterior salva: valor=$valor"
}

# 2) liga a auditoria de sucesso
& auditpol.exe /set "/subcategory:$Guid" /success:enable | Out-Null
if ($LASTEXITCODE -ne 0) { throw "auditpol /set falhou (rc $LASTEXITCODE)" }

# 3) tarefa
if (-not $Pythonw) {
    $py = (& python -c 'import sys;print(sys.executable)').Trim()
    $Pythonw = Join-Path (Split-Path -Parent $py) 'pythonw.exe'
}
if (-not (Test-Path $Pythonw)) { throw "pythonw nao encontrado: $Pythonw" }

$esc = { param($s) [Security.SecurityElement]::Escape($s) }
# XPath 1.0 do Event Log nao tem ends-with: caminho completo do executavel
$consulta = "<QueryList><Query Id=`"0`" Path=`"Security`"><Select Path=`"Security`">" +
    "*[System[EventID=4688]] and *[EventData[Data[@Name='NewProcessName']='$ClientExe']]" +
    "</Select></Query></QueryList>"
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>$(& $esc $id.Name)</Author>
    <Description>lol-client: abre o coletor de partidas quando o client do LoL abre; ele sai sozinho 10 min depois que o client fecha. Remover: tools\remover-gatilho.ps1</Description>
    <URI>\$Tarefa</URI>
  </RegistrationInfo>
  <Triggers>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>$(& $esc $consulta)</Subscription>
    </EventTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$($id.User.Value)</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$(& $esc $Pythonw)</Command>
      <Arguments>$(& $esc ('"' + $Coletor + '"'))</Arguments>
      <WorkingDirectory>$(& $esc $Raiz)</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
Register-ScheduledTask -TaskName $Tarefa -Xml $xml -Force | Out-Null

$t = Get-ScheduledTask -TaskName $Tarefa
$aud = (& auditpol.exe /get "/subcategory:$Guid" /r | Where-Object { $_ } | Select-Object -Last 1)
Write-Output "tarefa: $($t.TaskName) estado=$($t.State)"
Write-Output "acao: $Pythonw `"$Coletor`""
Write-Output "gatilho: 4688 com NewProcessName = $ClientExe"
Write-Output "auditoria: $aud"

# o gatilho so precisa do NewProcessName; com a linha de comando ligada, cada 4688 do client
# grava o --remoting-auth-token (credencial da LCU) no log Security. Nao mexemos: e config da maquina.
$chave = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit'
$cmd = (Get-ItemProperty -Path $chave -Name ProcessCreationIncludeCmdLine_Enabled -ErrorAction SilentlyContinue).ProcessCreationIncludeCmdLine_Enabled
if ($cmd -eq 1) {
    Write-Output "AVISO: ProcessCreationIncludeCmdLine_Enabled=1 -> o 4688 do client grava o token da LCU no log Security (ate o log circular sobrescrever). Ver docs\COLETOR.md (Seguranca)."
}
