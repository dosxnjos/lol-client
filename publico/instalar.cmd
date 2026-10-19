@echo off
rem lol-ultra-client: instala o complemento coach sem administrador. Python 3.12 ou mais novo (64 bits), ambiente Python
rem proprio em LOCALAPPDATA\lol-client\complemento\venv, bibliotecas com versao fixa, o plugin na pasta do Pengu Loader e um
rem atalho na pasta Inicializar do Windows que espera o client abrir. Nada de tarefa agendada. O resto e PowerShell.
setlocal
set "LUC_CMD=%~f0"
cd /d "%TEMP%"
setlocal EnableDelayedExpansion
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=[IO.File]::ReadAllText($env:LUC_CMD,[Text.Encoding]::UTF8); $m='#PS'+'-INICIO#'; iex $c.Substring($c.IndexOf($m)+$m.Length)" & exit /b !errorlevel!
#PS-INICIO#
# A linha acima do marcador roda tudo e sai na mesma linha (o mesmo molde do atualizar.cmd: sem rótulo nem goto, funciona com
# LF; cd para o TEMP antes, a pasta do pacote pode ser trocada). P4.3 de roadmap/2026-10-19-publicacao-e-complemento-publico.md.
#   origem    a pasta onde este arquivo está (a extraída do zip lol-ultra-client-complemento-<versão>.zip)
#   destino   %LOCALAPPDATA%\lol-client\complemento\lol-ultra-client-complemento (onde o atualizar.cmd e o botão atualizar
#             procuram); o dados\ de uma instalação anterior fica (banco, config, calibração), o .atualizacao\ sai (é a saída
#             de uma troca-incompleta do botão atualizar), o resto é trocado pelo do pacote
#   python    py -3.14, -3.13, -3.12 e o python.exe do PATH, nessa ordem: o 1º com 3.12 ou mais e 64 bits; sem ele, diz onde baixar
#   venv      %LOCALAPPDATA%\lol-client\complemento\venv (fora da pasta trocada pela atualização); reaproveitado se for da mesma
#             versão do Python; pip install -r requirements-complemento.txt (versões fixas, só pacote pronto: --only-binary)
#   plugin    pengu\ do pacote + LICENSE, TERCEIROS.md, LEIA-ME.md e atualizar.cmd para plugins\lol-ultra-client, com a pasta
#             plugins achada pela ativação do Pengu Loader (registro, só leitura) ou perguntada; nunca por cima de junção ou pasta
#             num repositório git, nem com um plugins\lol-client ao lado (carregaria duas vezes)
#   atalho    lol-ultra-client.lnk na pasta Inicializar: pythonw.exe do venv + coletor\relancador.py (espera o client, sobe o
#             coletor de novo se ele cair); e já sobe o relançador agora
#   recusa    destino que é junção ou está num repositório git (instalação de desenvolvimento), partida aberta; complemento em
#             execução é fechado (pid das travas em dados\, só processo python com a pasta do destino na linha de comando) e
#             volta no fim
# Teste (tools/teste-instalar.py): LOCALAPPDATA e as pastas no temp, LUC_PLUGINS, LUC_INICIALIZAR, LUC_PYTHON, LUC_PIP_RODAS
# (pasta com os pacotes: pip sem rede), LUC_SEM_INICIAR, LUC_SEM_PAUSA.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-Location -LiteralPath ([IO.Path]::GetTempPath())

$PASTA_PLUGIN = 'lol-ultra-client'
$PASTA_COMPLEMENTO = 'lol-ultra-client-complemento'
$PLUGIN_ANTIGO = 'lol-client'
$ATALHO = 'lol-ultra-client.lnk'
$IFEO = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\LeagueClientUx.exe'
$MINIMO = [Version]'3.12'
$VERSOES_PY = @('3.14', '3.13', '3.12')
$DO_PLUGIN = @('LICENSE', 'TERCEIROS.md', 'LEIA-ME.md', 'atualizar.cmd')
$TRAVAS = @('dados\relancador.lock', 'dados\coletor.lock')   # relançador antes: senão ele sobe o coletor de novo
$interativo = -not $env:LUC_SEM_PAUSA

$TEXTOS = @{
  'pacote' = 'Rode o instalar.cmd de dentro da pasta extraída do zip do complemento coach (lol-ultra-client-complemento), fora da pasta de instalação.'
  'desenvolvimento' = 'O destino é uma instalação de desenvolvimento (pasta ligada a um repositório de código): nada foi instalado.'
  'partida' = 'Uma partida do League of Legends está aberta: rode o instalar.cmd depois dela.'
  'venv' = 'Não foi possível criar o ambiente Python do complemento: reinstale o Python (python.org) e rode de novo.'
  'pip' = 'Não foi possível instalar as bibliotecas do complemento: confira a conexão com a internet e rode de novo. Com um Python mais novo que o 3.14, instale também o Python 3.14 (python.org).'
  'copia' = 'Não foi possível copiar os arquivos do complemento: feche o que estiver usando a pasta e rode de novo.'
  'parar' = 'O complemento coach em execução não fechou: reinicie o computador e rode o instalar.cmd de novo.'
}

function Falhar([string]$motivo, [string]$detalhe) { throw [Exception]::new("$motivo|$detalhe") }

function Reparse([string]$p) {
  try { return [bool]([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) } catch { return $false }
}

function MesmaPasta([string]$a, [string]$b) {
  if (-not $a -or -not $b) { return $false }
  try { return ([IO.Path]::GetFullPath($a).TrimEnd('\') -ieq [IO.Path]::GetFullPath($b).TrimEnd('\')) } catch { return $false }
}

function Dentro([string]$filha, [string]$mae) {
  try { return [IO.Path]::GetFullPath($filha).TrimEnd('\').StartsWith([IO.Path]::GetFullPath($mae).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) } catch { return $false }
}

# .git na pasta ou acima, parando ANTES da pasta do usuário (o mesmo do atualizar.cmd e de coletor/atualizar.py em_git)
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

function CopiarArvore([string]$de, [string]$para) {
  [void][IO.Directory]::CreateDirectory($para)
  foreach ($f in [IO.Directory]::GetFiles($de)) { [IO.File]::Copy($f, (Join-Path $para ([IO.Path]::GetFileName($f))), $true) }
  foreach ($d in [IO.Directory]::GetDirectories($de)) {
    $n = [IO.Path]::GetFileName($d)
    if ($n -ieq '__pycache__' -or (Reparse $d)) { continue }
    CopiarArvore $d (Join-Path $para $n)
  }
}

function PastaPlugins {
  if ($env:LUC_PLUGINS) { return $env:LUC_PLUGINS }
  try { $dbg = (Get-ItemProperty -LiteralPath $IFEO -Name Debugger -ErrorAction Stop).Debugger } catch { return $null }
  $m = [regex]::Match([string]$dbg, '"([^"]+core\.dll)"')
  if (-not $m.Success) { $m = [regex]::Match([string]$dbg, '(\S+core\.dll)') }
  if (-not $m.Success) { return $null }
  return (Join-Path (Split-Path -Parent $m.Groups[1].Value) 'plugins')
}

# pid dono da trava, só se for python com a pasta do complemento na linha de comando (pid reaproveitado por outro programa
# e o coletor de outra instalação ficam de fora)
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

# versão e bits de um Python, sem deixar o stderr dele virar erro do PowerShell
function InfoPython([string]$exe, [string[]]$pre) {
  $ErrorActionPreference = 'Continue'
  try {
    $saida = & $exe @pre -c "import sys, struct; print('%d.%d|%d|%s' % (sys.version_info[0], sys.version_info[1], struct.calcsize('P') * 8, sys.executable))" 2>$null
  } catch { return $null }
  if ($LASTEXITCODE -ne 0 -or -not $saida) { return $null }
  $p = ([string](@($saida)[-1])).Split('|')
  if ($p.Count -lt 3) { return $null }
  try { $v = [Version]$p[0] } catch { return $null }
  return [pscustomobject]@{ Versao = $v; Bits = [int]$p[1]; Exe = $p[2].Trim() }
}

function AcharPython {
  $cands = New-Object Collections.ArrayList
  if ($env:LUC_PYTHON) { [void]$cands.Add(@($env:LUC_PYTHON, @())) }
  else {
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) { foreach ($v in $VERSOES_PY) { [void]$cands.Add(@($py.Source, @("-$v"))) } }
    foreach ($c in @(Get-Command python.exe -All -ErrorAction SilentlyContinue)) { [void]$cands.Add(@($c.Source, @())) }
  }
  $vistos = New-Object Collections.ArrayList
  foreach ($c in $cands) {
    $i = InfoPython $c[0] $c[1]
    if (-not $i) { continue }
    [void]$vistos.Add($i)
    if ($i.Versao -ge $MINIMO -and $i.Bits -eq 64) { return , @($i, $vistos) }
  }
  return , @($null, $vistos)
}

function Rodar([string]$exe, [string[]]$argumentos) {
  $ErrorActionPreference = 'Continue'
  & $exe @argumentos | Out-Host   # a saída vai para a tela, nunca para o valor devolvido
  return $LASTEXITCODE
}

function Principal {
  $origem = Split-Path -Parent $env:LUC_CMD
  if (-not [IO.File]::Exists((Join-Path $origem 'coletor\coletor.py')) -or -not [IO.File]::Exists((Join-Path $origem 'pengu\index.js')) -or
      -not [IO.File]::Exists((Join-Path $origem 'requirements-complemento.txt'))) { Falhar 'pacote' 'sem coletor, pengu ou requirements' }
  $base = Join-Path $env:LOCALAPPDATA 'lol-client\complemento'
  $destino = Join-Path $base $PASTA_COMPLEMENTO
  $venv = Join-Path $base 'venv'
  if (Dentro $origem $destino) { Falhar 'pacote' 'pacote dentro da pasta de instalação' }
  if ([IO.Directory]::Exists($destino) -and (Desenvolvimento $destino)) { Falhar 'desenvolvimento' $destino }
  if ((Reparse $venv) -or (Reparse $base)) { Falhar 'desenvolvimento' 'venv ou pasta do complemento é junção' }

  Write-Host 'lol-ultra-client: instalando o complemento coach.'
  $achado = AcharPython
  $py = $achado[0]
  if (-not $py) {
    $velhos = @($achado[1] | ForEach-Object { "$($_.Versao) ($($_.Bits) bits)" }) -join ', '
    Write-Host 'Python 3.12 ou mais novo (64 bits) não encontrado.'
    if ($velhos) { Write-Host "Encontrado: $velhos." }
    Write-Host 'Baixe em https://www.python.org/downloads/windows/ (instalador de 64 bits; marque "Add python.exe to PATH") e rode o instalar.cmd de novo.'
    return 2
  }
  Write-Host "Python $($py.Versao): $($py.Exe)"
  if (Get-Process -Name 'League of Legends' -ErrorAction SilentlyContinue) { Falhar 'partida' '' }
  # complemento desta instalação em execução: fecha antes do pip (biblioteca carregada não se troca) e volta no fim
  $parados = 0
  if ([IO.Directory]::Exists($destino)) { $parados = PararComplemento $destino }
  if ($parados) { Write-Host 'Complemento coach em execução: fechado para a instalação.' }

  # ambiente Python próprio, fora da pasta que a atualização troca
  $vpy = Join-Path $venv 'Scripts\python.exe'
  $vpyw = Join-Path $venv 'Scripts\pythonw.exe'
  $iv = $null
  if ([IO.File]::Exists($vpy)) { $iv = InfoPython $vpy @() }
  if ($iv -and $iv.Versao -eq $py.Versao) { Write-Host 'Ambiente Python do complemento: reaproveitado.' }
  else {
    if ([IO.Directory]::Exists($venv)) { Apagar $venv }
    Write-Host 'Criando o ambiente Python do complemento…'
    if ((Rodar $py.Exe @('-m', 'venv', $venv)) -ne 0 -or -not [IO.File]::Exists($vpyw)) { Falhar 'venv' 'python -m venv' }
  }
  Write-Host 'Instalando as bibliotecas com versão fixa (na 1ª vez, alguns minutos)…'
  $pip = @('-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--only-binary=:all:', '-q', '-r',
           (Join-Path $origem 'requirements-complemento.txt'))
  if ($env:LUC_PIP_RODAS) { $pip += @('--no-index', '--find-links', $env:LUC_PIP_RODAS) }
  if ((Rodar $vpy $pip) -ne 0) { Falhar 'pip' 'pip install' }

  # código do complemento: o dados\ fica, o resto é o do pacote
  try {
    if (MesmaPasta $origem $destino) { Apagar (Join-Path $destino '.atualizacao') }
    else {
      [void][IO.Directory]::CreateDirectory($destino)
      foreach ($e in [IO.Directory]::GetFileSystemEntries($destino)) {
        if ([IO.Path]::GetFileName($e) -ine 'dados') { Apagar $e }
      }
      foreach ($e in [IO.Directory]::GetFileSystemEntries($origem)) {
        $n = [IO.Path]::GetFileName($e)
        if (@('dados', '.atualizacao', '__pycache__') -contains $n.ToLowerInvariant()) { continue }
        if ([IO.Directory]::Exists($e)) { CopiarArvore $e (Join-Path $destino $n) }
        else { [IO.File]::Copy($e, (Join-Path $destino $n), $true) }
      }
    }
  } catch { Falhar 'copia' $_.Exception.Message }
  Write-Host "Complemento coach em $destino"

  # plugin na pasta do Pengu Loader
  $avisos = New-Object Collections.ArrayList
  $plugins = PastaPlugins
  if (-not $plugins -and $interativo) {
    $r = Read-Host 'Pasta plugins do Pengu Loader não encontrada. Cole o caminho dela (Enter pula a cópia do plugin)'
    if ($r) { $plugins = $r.Trim().Trim('"') }
  }
  if (-not $plugins -or -not [IO.Directory]::Exists($plugins)) {
    [void]$avisos.Add('Plugin não copiado: extraia o zip do plugin na pasta plugins do Pengu Loader (LEIA-ME, "Instalar o plugin").')
  } elseif ([IO.Directory]::Exists((Join-Path $plugins $PLUGIN_ANTIGO))) {
    [void]$avisos.Add("Plugin não copiado: já existe plugins\$PLUGIN_ANTIGO (outra instalação do mesmo plugin), e os dois carregariam juntos.")
  } else {
    $dest = Join-Path $plugins $PASTA_PLUGIN
    if ([IO.Directory]::Exists($dest) -and (Desenvolvimento $dest)) {
      [void]$avisos.Add("Plugin não copiado: $dest é uma instalação de desenvolvimento.")
    } else {
      try {
        if ([IO.Directory]::Exists($dest)) { Apagar $dest }
        CopiarArvore (Join-Path $origem 'pengu') $dest
        foreach ($n in $DO_PLUGIN) {
          $f = Join-Path $origem $n
          if ([IO.File]::Exists($f)) { [IO.File]::Copy($f, (Join-Path $dest $n), $true) }
        }
        Write-Host "Plugin em $dest"
      } catch {
        [void]$avisos.Add("Plugin não copiado: sem permissão para escrever em $plugins. Extraia o zip do plugin lá (LEIA-ME, ""Instalar o plugin"").")
      }
    }
  }

  # atalho na pasta Inicializar: sobe com o Windows e espera o client
  $ini = if ($env:LUC_INICIALIZAR) { $env:LUC_INICIALIZAR } else { [Environment]::GetFolderPath('Startup') }
  [void][IO.Directory]::CreateDirectory($ini)
  $relancador = Join-Path $destino 'coletor\relancador.py'
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut((Join-Path $ini $ATALHO))
  $lnk.TargetPath = $vpyw
  $lnk.Arguments = '"' + $relancador + '"'
  $lnk.WorkingDirectory = $destino
  $lnk.Description = 'lol-ultra-client: complemento coach (espera o client do League of Legends abrir)'
  $lnk.WindowStyle = 7
  $lnk.Save()
  Write-Host "Atalho na pasta Inicializar: $(Join-Path $ini $ATALHO)"

  if (-not $env:LUC_SEM_INICIAR) {
    Start-Process -FilePath $vpyw -ArgumentList ('"' + $relancador + '"') -WorkingDirectory $destino
    Write-Host 'Complemento coach iniciado: ele espera o client abrir.'
  } elseif ($parados) { Write-Host 'O complemento coach fechado para a instalação volta no próximo início do Windows.' }
  foreach ($a in $avisos) { Write-Host $a }
  Write-Host 'Pronto. No client: Configurações › LOL-CLIENT › Complemento coach, ligue "Usar o complemento coach". Com o client já aberto, recarregue-o na tela inicial ou no lobby.'
  return 0
}

$codigo = 1
try {
  $codigo = @(Principal)[-1]
} catch {
  $msg = [string]$_.Exception.Message
  $motivo = if ($msg -like '*|*') { $msg.Split('|')[0] } else { 'erro' }
  $texto = $TEXTOS[$motivo]
  if (-not $texto) { $texto = 'Não foi possível instalar agora: tente de novo.' }
  Write-Host $texto
  if ($env:LUC_SEM_PAUSA) { Write-Host "motivo: $motivo ($msg)" }
  if (@('pacote', 'desenvolvimento', 'partida') -contains $motivo) { $codigo = 2 } else { $codigo = 1 }
}
if ($interativo) { [void](Read-Host 'Pressione Enter para fechar') }
exit $codigo
