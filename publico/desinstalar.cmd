@echo off & set "LUC_CMD=%~f0" & cd /d "%TEMP%" & powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=[IO.File]::ReadAllText($env:LUC_CMD,[Text.Encoding]::UTF8); $m='#PS'+'-INICIO#'; iex $c.Substring($c.IndexOf($m)+$m.Length)" & call exit /b %%errorlevel%%
rem lol-ultra-client: desinstala o complemento coach e o plugin, sem administrador: fecha o complemento em execucao, apaga
rem o atalho da pasta Inicializar, a pasta plugins\lol-ultra-client do Pengu Loader e LOCALAPPDATA\lol-client\complemento
rem (codigo, ambiente Python e as partidas guardadas por ele). O resto e PowerShell.
rem Tudo roda na 1a linha e sai nela: o cmd nunca le a 2a (ARMADILHAS, Windows: pagina de codigo UTF-8). Sem setlocal: o
rem endlocal da saida voltaria para a pasta atual de antes, que este arquivo acabou de apagar.
#PS-INICIO#
# A 1ª linha roda tudo e sai nela mesma: este arquivo pode estar dentro da pasta que ele apaga (o cmd não relê nada depois,
# nem depende da página de código do console; cd para o TEMP antes). P4.3 de roadmap/2026-10-19-publicacao-e-complemento-publico.md.
#   fecha     relançador e coletor pelo pid das travas em dados\, só processo python com a pasta do complemento na linha de
#             comando (pid reaproveitado e o coletor de outra instalação ficam de fora)
#   apaga     o atalho lol-ultra-client.lnk da pasta Inicializar; plugins\lol-ultra-client (nunca junção nem pasta num
#             repositório git: instalação de desenvolvimento); %LOCALAPPDATA%\lol-client\complemento inteira; o pacote de
#             vozes baixado pelo botão (%LOCALAPPDATA%\lol-client\voz\pacotes\aoede, só com "origem": "release"; P5); a pasta
#             %LOCALAPPDATA%\lol-client só se ficar vazia. Rodando de dentro dela, este arquivo sai por último (um cmd solto,
#             2 s depois da saída: o cmd relê o arquivo dele ao sair)
#   recusa    partida aberta; complemento que é instalação de desenvolvimento
# Teste (tools/teste-instalar.py): LOCALAPPDATA no temp, LUC_PLUGINS, LUC_INICIALIZAR, LUC_SEM_PAUSA (sem a pergunta).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-Location -LiteralPath ([IO.Path]::GetTempPath())

$PASTA_PLUGIN = 'lol-ultra-client'
$PASTA_COMPLEMENTO = 'lol-ultra-client-complemento'
$ATALHO = 'lol-ultra-client.lnk'
$IFEO = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\LeagueClientUx.exe'
$TRAVAS = @('dados\relancador.lock', 'dados\coletor.lock')   # relançador antes: senão ele sobe o coletor de novo
$interativo = -not $env:LUC_SEM_PAUSA

$TEXTOS = @{
  'desenvolvimento' = 'O complemento instalado é de desenvolvimento (pasta ligada a um repositório de código): nada foi apagado.'
  'partida' = 'Uma partida do League of Legends está aberta: rode o desinstalar.cmd depois dela.'
  'parar' = 'O complemento coach em execução não fechou: reinicie o computador e rode o desinstalar.cmd de novo.'
}

function Falhar([string]$motivo, [string]$detalhe) { throw [Exception]::new("$motivo|$detalhe") }

function Reparse([string]$p) {
  try { return [bool]([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) } catch { return $false }
}

function MesmaPasta([string]$a, [string]$b) {
  if (-not $a -or -not $b) { return $false }
  try { return ([IO.Path]::GetFullPath($a).TrimEnd('\') -ieq [IO.Path]::GetFullPath($b).TrimEnd('\')) } catch { return $false }
}

function EmGit([string]$p) {
  $d = [IO.DirectoryInfo]::new([IO.Path]::GetFullPath($p))
  while ($d) {
    if (MesmaPasta $d.FullName $env:USERPROFILE) { return $false }
    if ([IO.Directory]::Exists((Join-Path $d.FullName '.git')) -or [IO.File]::Exists((Join-Path $d.FullName '.git'))) { return $true }
    $d = $d.Parent
  }
  return $false
}

function Desenvolvimento([string]$p) { return ((Reparse $p) -or (EmGit $p)) }

function Apagar([string]$p) {
  if (Reparse $p) { [IO.Directory]::Delete($p); return }   # junção: só o link, nunca o conteúdo do alvo
  if ([IO.Directory]::Exists($p)) { [IO.Directory]::Delete($p, $true) }
  elseif ([IO.File]::Exists($p)) { [IO.File]::Delete($p) }
}

function PastaPlugins {
  if ($env:LUC_PLUGINS) { return $env:LUC_PLUGINS }
  try { $dbg = (Get-ItemProperty -LiteralPath $IFEO -Name Debugger -ErrorAction Stop).Debugger } catch { return $null }
  $m = [regex]::Match([string]$dbg, '"([^"]+core\.dll)"')
  if (-not $m.Success) { $m = [regex]::Match([string]$dbg, '(\S+core\.dll)') }
  if (-not $m.Success) { return $null }
  return (Join-Path (Split-Path -Parent $m.Groups[1].Value) 'plugins')
}

function DonoDaTrava([string]$pasta, [string]$trava) {
  $arq = Join-Path $pasta $trava
  if (-not [IO.File]::Exists($arq)) { return $null }
  try { $dono = [int]([IO.File]::ReadAllText($arq).Trim()) } catch { return $null }
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$dono" -ErrorAction SilentlyContinue
  if (-not $p -or $p.Name -notlike 'python*' -or -not $p.CommandLine) { return $null }
  if ($p.CommandLine.IndexOf([IO.Path]::GetFullPath($pasta).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $null }
  return $dono
}

function PararComplemento([string]$pasta) {
  $parados = 0
  foreach ($t in $TRAVAS) {
    $dono = DonoDaTrava $pasta $t
    if (-not $dono) { continue }
    Stop-Process -Id $dono -Force -ErrorAction SilentlyContinue
    try { Wait-Process -Id $dono -Timeout 15 -ErrorAction SilentlyContinue } catch { }
    if (Get-Process -Id $dono -ErrorAction SilentlyContinue) { Falhar 'parar' "pid $dono" }
    $parados++
  }
  return $parados
}

function Principal {
  $raiz = Join-Path $env:LOCALAPPDATA 'lol-client'
  $base = Join-Path $raiz 'complemento'
  $destino = Join-Path $base $PASTA_COMPLEMENTO
  if ($interativo) {
    $r = Read-Host 'Desinstalar o lol-ultra-client (plugin, complemento coach e as partidas guardadas por ele)? [s/N]'
    if ($r -notmatch '^\s*[sS]') { Write-Host 'Nada foi alterado.'; return 0 }
  }
  if ([IO.Directory]::Exists($destino) -and (Desenvolvimento $destino)) { Falhar 'desenvolvimento' $destino }
  if ((Reparse $base) -or (Reparse $raiz)) { Falhar 'desenvolvimento' 'pasta do complemento é junção' }
  if (Get-Process -Name 'League of Legends' -ErrorAction SilentlyContinue) { Falhar 'partida' '' }
  $codigo = 0
  if ([IO.Directory]::Exists($destino) -and (PararComplemento $destino)) { Write-Host 'Complemento coach fechado.' }

  $ini = if ($env:LUC_INICIALIZAR) { $env:LUC_INICIALIZAR } else { [Environment]::GetFolderPath('Startup') }
  $lnk = Join-Path $ini $ATALHO
  if ([IO.File]::Exists($lnk)) { [IO.File]::Delete($lnk); Write-Host 'Atalho da pasta Inicializar apagado.' }

  $plugins = PastaPlugins
  $dest = if ($plugins) { Join-Path $plugins $PASTA_PLUGIN } else { $null }
  if ($dest -and [IO.Directory]::Exists($dest)) {
    if (Desenvolvimento $dest) { Write-Host "Plugin mantido: $dest é uma instalação de desenvolvimento." }
    else {
      try { Apagar $dest; Write-Host "Plugin apagado: $dest" }
      catch { Write-Host "O plugin não foi apagado (arquivo em uso): feche o client e apague a pasta $dest."; $codigo = 1 }
    }
  } elseif (-not $plugins) { Write-Host 'Pasta plugins do Pengu Loader não encontrada: se o plugin estiver instalado, apague a pasta plugins\lol-ultra-client.' }

  # pacote de vozes baixado pelo botão "baixar vozes" (P5, coletor/voz_pacote.py): só pasta cujo indice.json diz "origem":
  # "release" (aoede, aoede.nova, aoede.anterior); pacote gerado neste computador fica. voz\pacotes e voz\ saem só se vazias
  $voz = Join-Path $raiz 'voz'
  $pacotes = Join-Path $voz 'pacotes'
  if ([IO.Directory]::Exists($pacotes) -and -not (Reparse $voz) -and -not (Reparse $pacotes)) {
    try {
      foreach ($n in @('aoede', 'aoede.nova', 'aoede.anterior')) {
        $p = Join-Path $pacotes $n
        if (-not [IO.Directory]::Exists($p) -or (Reparse $p)) { continue }
        $origem = $null
        try { $origem = ([IO.File]::ReadAllText((Join-Path $p 'indice.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json).origem } catch { }
        if ($origem -eq 'release') { Apagar $p; if ($n -eq 'aoede') { Write-Host "Pacote de vozes apagado: $p" } }
      }
      foreach ($p in @($pacotes, $voz)) { if (@([IO.Directory]::GetFileSystemEntries($p)).Count -eq 0) { [IO.Directory]::Delete($p) } }
    } catch { Write-Host "O pacote de vozes não foi apagado (arquivo em uso): apague a pasta $pacotes depois."; $codigo = 1 }
  }

  if ([IO.Directory]::Exists($base)) {
    # rodando de dentro da pasta que apaga (o desinstalar.cmd instalado): o cmd relê o próprio arquivo ao sair e, sem ele,
    # sai com erro ("caminho não encontrado"). Fica só este arquivo, e um cmd solto apaga o resto 2 s depois da saída
    $proprio = [IO.Path]::GetFullPath($env:LUC_CMD)
    $dentro = $proprio.StartsWith([IO.Path]::GetFullPath($base).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
    try {
      if ($dentro) {
        foreach ($e in [IO.Directory]::GetFileSystemEntries($base)) { if (-not (MesmaPasta $e $destino)) { Apagar $e } }
        foreach ($e in [IO.Directory]::GetFileSystemEntries($destino)) { if (-not (MesmaPasta $e $proprio)) { Apagar $e } }
        $limpar = 'ping -n 3 127.0.0.1 >nul & rd /s /q "' + $base + '" & rd "' + $raiz + '" 2>nul'
        Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList '/c', $limpar -WindowStyle Hidden -WorkingDirectory ([IO.Path]::GetTempPath())
      } else { Apagar $base }
      Write-Host "Complemento coach apagado: $base"
    } catch { Write-Host "Parte do complemento não foi apagada (arquivo em uso): reinicie o computador e apague a pasta $base."; $codigo = 1 }
  }
  if ([IO.Directory]::Exists($raiz) -and -not (Reparse $raiz) -and @([IO.Directory]::GetFileSystemEntries($raiz)).Count -eq 0) {
    [IO.Directory]::Delete($raiz)
  }
  if ($codigo -eq 0) { Write-Host 'lol-ultra-client desinstalado.' }
  return $codigo
}

$codigo = 1
try {
  $codigo = @(Principal)[-1]
} catch {
  $msg = [string]$_.Exception.Message
  $motivo = if ($msg -like '*|*') { $msg.Split('|')[0] } else { 'erro' }
  $texto = $TEXTOS[$motivo]
  if (-not $texto) { $texto = 'Não foi possível desinstalar agora: tente de novo.' }
  Write-Host $texto
  if ($env:LUC_SEM_PAUSA) { Write-Host "motivo: $motivo ($msg)" }
  if (@('desenvolvimento', 'partida') -contains $motivo) { $codigo = 2 } else { $codigo = 1 }
}
if ($interativo) { [void](Read-Host 'Pressione Enter para fechar') }
exit $codigo
