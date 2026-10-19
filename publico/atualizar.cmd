@echo off
rem lol-ultra-client: atualiza o plugin e o complemento coach para a versao mais nova publicada no GitHub, sem admin.
rem Origem fixa (api.github.com e github.com do REPO de versao.js), hash conferido (SHA256SUMS.txt e digest da API), troca
rem item a item com volta e recusa de juncao ou de pasta dentro de um repositorio git. O resto deste arquivo e PowerShell.
setlocal
set "LUC_CMD=%~f0"
cd /d "%TEMP%"
setlocal EnableDelayedExpansion
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=[IO.File]::ReadAllText($env:LUC_CMD,[Text.Encoding]::UTF8); $m='#PS'+'-INICIO#'; iex $c.Substring($c.IndexOf($m)+$m.Length)" & exit /b !errorlevel!
#PS-INICIO#
# A linha acima do marcador roda tudo e sai na mesma linha: o cmd nunca relê este arquivo depois da troca (a pasta dele muda).
# Mesmas regras do complemento coach (coletor/atualizar.py, P3 de roadmap/2026-10-19-publicacao-e-complemento-publico.md):
#   release   https://api.github.com/repos/<REPO>/releases/latest
#   assets    browser_download_url == https://github.com/<REPO>/releases/download/<tag>/<nome>, exato; cada redirecionamento
#             só em https e nos hosts de $ORIGENS
#   hash      sha256 calculado == SHA256SUMS.txt == digest da API (digest ausente = falha), nos zips e no próprio SHA256SUMS
#   troca     extrai em <pasta>\.atualizacao\nova, confere, troca item a item (o que sai vai para <pasta>\.atualizacao\anterior;
#             o dados\ do complemento fica); só rename no mesmo volume, nunca cópia; falha no meio devolve tudo, o plugin inclusive
#   recusa    junção, pasta num repositório git (até a pasta do usuário, exclusive), troca anterior que não voltou inteira
#             (.atualizacao\troca-em-curso), complemento coach em execução (antes da rede e de novo antes de trocar; o botão do
#             client é o caminho dele)
# Rodando da pasta do plugin, atualiza também o complemento em %LOCALAPPDATA%\lol-client\complemento\lol-ultra-client-complemento
# (se existir); rodando da pasta do complemento, acha o plugin pela ativação do Pengu Loader (registro, só leitura).
# Teste (tools/teste-atualizar.py): LUC_API = http://127.0.0.1:<porta> (só loopback), LUC_PLUGINS, LUC_SEM_PAUSA.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression
Set-Location -LiteralPath ([IO.Path]::GetTempPath())

$NOME = 'lol-ultra-client'
$PASTA_PLUGIN = 'lol-ultra-client'
$PASTA_COMPLEMENTO = 'lol-ultra-client-complemento'
$API = 'https://api.github.com'
$DOWNLOAD = 'https://github.com'
$ORIGENS = @('https://github.com', 'https://objects.githubusercontent.com', 'https://release-assets.githubusercontent.com')
$SUMS = 'SHA256SUMS.txt'
$MARCA = 'troca-em-curso'                          # <pasta>\.atualizacao\troca-em-curso: troca começou e não fechou
$IFEO = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\LeagueClientUx.exe'
$LIMITE_API = 2MB
$LIMITE_SUMS = 64KB
$LIMITE_ZIP = 200MB

$TEXTOS = @{
  'desenvolvimento' = 'Instalação de desenvolvimento (pasta ligada a um repositório de código): nada foi trocado.'
  'sem-plugin' = "Pasta plugins\$PASTA_PLUGIN do Pengu Loader não encontrada: nada foi trocado."
  'rodando' = 'O complemento coach está em execução: use o botão atualizar nas Configurações do client, ou feche o complemento e rode de novo.'
  'versao' = 'Versão instalada não identificada: nada foi trocado.'
  'hash' = 'Os arquivos baixados não conferem com o release: nada foi trocado.'
  'origem' = 'Os arquivos não vieram do endereço oficial: nada foi trocado.'
  'pacote' = 'O pacote baixado está incompleto: nada foi trocado.'
  'release' = 'Versão não encontrada no GitHub: tente de novo mais tarde.'
  'rede' = 'Não foi possível baixar a versão nova: tente de novo mais tarde.'
  'troca' = 'Não foi possível trocar os arquivos: a versão anterior continua instalada.'
  'troca-incompleta' = 'A troca dos arquivos parou no meio: a versão anterior está em .atualizacao\anterior, dentro da pasta.'
}

function Falhar([string]$motivo, [string]$detalhe) { throw [Exception]::new("$motivo|$detalhe") }

if ($env:LUC_API) {
  if ($env:LUC_API -notmatch '^http://127\.0\.0\.1:\d{1,5}$') { Write-Host 'LUC_API aceita só http://127.0.0.1:<porta> (teste).'; exit 2 }
  $API = $env:LUC_API
  $DOWNLOAD = $env:LUC_API
  $ORIGENS = @($env:LUC_API)
}

function Origem([string]$url) {
  try { $u = [Uri]$url } catch { return $null }
  if (-not $u.IsAbsoluteUri -or $u.UserInfo) { return $null }
  return ('{0}://{1}' -f $u.Scheme.ToLowerInvariant(), $u.Authority.ToLowerInvariant())
}

# GET com redirecionamento conferido salto a salto
function Pegar([string]$url, [string[]]$origens, [long]$limite, [string]$aceitar) {
  for ($i = 0; $i -le 5; $i++) {
    if ($origens -notcontains (Origem $url)) { Falhar 'origem' ("fora da origem fixa: " + (Origem $url)) }
    $req = [Net.HttpWebRequest]::Create($url)
    $req.AllowAutoRedirect = $false
    $req.UserAgent = $NOME
    $req.Accept = $aceitar
    $req.Timeout = 30000
    $req.ReadWriteTimeout = 30000
    $resp = $null
    try { $resp = $req.GetResponse() } catch [Net.WebException] {
      $resp = $_.Exception.Response
      if (-not $resp) { Falhar 'rede' $_.Exception.Message }
    }
    try {
      $cod = [int]$resp.StatusCode
      if (@(301, 302, 303, 307, 308) -contains $cod) {
        $loc = $resp.Headers['Location']
        if (-not $loc) { Falhar 'rede' 'redirecionamento sem destino' }
        $url = ([Uri]::new([Uri]$url, $loc)).AbsoluteUri
        continue
      }
      if ($cod -eq 404) { Falhar 'release' 'HTTP 404' }
      if ($cod -ne 200) { Falhar 'rede' "HTTP $cod" }
      if ($resp.ContentLength -gt $limite) { Falhar 'rede' 'grande demais' }
      $ms = New-Object IO.MemoryStream
      try {
        $s = $resp.GetResponseStream()
        $buf = New-Object byte[] 65536
        while (($n = $s.Read($buf, 0, $buf.Length)) -gt 0) {
          $ms.Write($buf, 0, $n)
          if ($ms.Length -gt $limite) { Falhar 'rede' 'grande demais' }
        }
      } catch { if ($_.Exception.Message -like '*|*') { throw } ; Falhar 'rede' 'conexão caiu no meio' }
      if ($resp.ContentLength -ge 0 -and $ms.Length -ne $resp.ContentLength) { Falhar 'rede' 'download incompleto' }
      return , $ms.ToArray()
    } finally { $resp.Close() }
  }
  Falhar 'origem' 'redirecionamentos demais'
}

function Sha([byte[]]$b) {
  $h = [Security.Cryptography.SHA256]::Create()
  try { return (-join ($h.ComputeHash($b) | ForEach-Object { $_.ToString('x2') })) } finally { $h.Dispose() }
}

function Reparse([string]$p) {
  try { return [bool]([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) } catch { return $false }
}

function MesmaPasta([string]$a, [string]$b) {
  if (-not $a -or -not $b) { return $false }
  try { return ([IO.Path]::GetFullPath($a).TrimEnd('\') -ieq [IO.Path]::GetFullPath($b).TrimEnd('\')) } catch { return $false }
}

# .git na pasta ou acima, parando ANTES da pasta do usuário: um repositório de dotfiles em ~\.git não faz da instalação em
# %LOCALAPPDATA% uma de desenvolvimento (coletor/atualizar.py em_git)
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

function LerVersao([string]$arq) {
  if (-not [IO.File]::Exists($arq)) { Falhar 'versao' 'sem versao.js' }
  $t = [IO.File]::ReadAllText($arq)
  $v = [regex]::Match($t, "\bVERSAO\s*=\s*'(\d+\.\d+\.\d+)'")
  $r = [regex]::Match($t, "\bREPO\s*=\s*'([A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100})'")
  if (-not $v.Success -or -not $r.Success) { Falhar 'versao' 'versao.js sem VERSAO ou REPO' }
  return @($v.Groups[1].Value, $r.Groups[1].Value)
}

function Tupla([string]$v) {
  $m = [regex]::Match($v, '^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$')
  if (-not $m.Success) { return $null }
  return , @([int]$m.Groups[1].Value, [int]$m.Groups[2].Value, [int]$m.Groups[3].Value)
}

function MaisNova($a, $b) {
  for ($i = 0; $i -lt 3; $i++) { if ($a[$i] -ne $b[$i]) { return ($a[$i] -gt $b[$i]) } }
  return $false
}

function PastaPlugins {
  if ($env:LUC_PLUGINS) { return $env:LUC_PLUGINS }
  try { $dbg = (Get-ItemProperty -LiteralPath $IFEO -Name Debugger -ErrorAction Stop).Debugger } catch { return $null }
  $m = [regex]::Match([string]$dbg, '"([^"]+core\.dll)"')
  if (-not $m.Success) { $m = [regex]::Match([string]$dbg, '(\S+core\.dll)') }
  if (-not $m.Success) { return $null }
  return (Join-Path (Split-Path -Parent $m.Groups[1].Value) 'plugins')
}

function ComplementoRodando([string]$pasta) {
  $trava = Join-Path $pasta 'dados\coletor.lock'
  if (-not [IO.File]::Exists($trava)) { return $false }
  try { $dono = [int]([IO.File]::ReadAllText($trava).Trim()) } catch { return $false }
  $p = Get-Process -Id $dono -ErrorAction SilentlyContinue
  return [bool]($p -and $p.ProcessName -like 'python*')
}

function Apagar([string]$p) {
  if (Reparse $p) { [IO.Directory]::Delete($p); return }   # junção: só o link, nunca o conteúdo do alvo
  if ([IO.Directory]::Exists($p)) { [IO.Directory]::Delete($p, $true) }
  elseif ([IO.File]::Exists($p)) { [IO.File]::Delete($p) }
}

# só rename (o estágio mora dentro da pasta: mesmo volume); item preso falha inteiro, nunca copia nem apaga pela metade
function Mover([string]$de, [string]$para) {
  if ([IO.Directory]::Exists($de)) { [IO.Directory]::Move($de, $para) } else { [IO.File]::Move($de, $para) }
}

function Extrair([byte[]]$dados, [string]$prefixo, [string]$destino, [string[]]$preservar) {
  $ms = New-Object IO.MemoryStream(, $dados)
  try { $z = New-Object IO.Compression.ZipArchive($ms, [IO.Compression.ZipArchiveMode]::Read) } catch { Falhar 'pacote' 'zip inválido' }
  $esperados = @{}
  try {
    if ($z.Entries.Count -gt 5000) { Falhar 'pacote' 'zip grande demais' }
    [long]$total = 0
    foreach ($e in $z.Entries) {
      $nome = $e.FullName
      if ($nome.Contains('\') -or $nome.StartsWith('/') -or $nome -match '^[A-Za-z]:' -or $nome.Contains([string][char]0)) { Falhar 'pacote' 'caminho inválido no zip' }
      $partes = $nome.Split('/')
      if ($partes[0] -ne $prefixo) { Falhar 'pacote' 'caminho fora da pasta do pacote' }
      foreach ($pa in $partes) { if ($pa -eq '..' -or $pa -eq '.' -or $pa.Contains(':')) { Falhar 'pacote' 'caminho fora da pasta do pacote' } }
      if ($partes.Length -lt 2 -or $nome.EndsWith('/')) { continue }
      $rel = ($partes[1..($partes.Length - 1)]) -join '/'
      if ($preservar -contains $partes[1].ToLowerInvariant()) { Falhar 'pacote' ('o pacote traz ' + $partes[1]) }
      $total += $e.Length
      if ($total -gt 500MB) { Falhar 'pacote' 'zip grande demais' }
      $esperados[$rel] = [long]$e.Length
      $alvo = Join-Path $destino ($rel.Replace('/', '\'))
      [void][IO.Directory]::CreateDirectory((Split-Path -Parent $alvo))
      $s = $e.Open()
      $f = [IO.File]::Create($alvo)
      try { $s.CopyTo($f) } finally { $f.Close(); $s.Close() }
    }
  } finally { $z.Dispose(); $ms.Dispose() }
  if ($esperados.Count -eq 0) { Falhar 'pacote' 'zip vazio' }
  return $esperados
}

function ConferirExtraido([string]$destino, $esperados) {
  $achados = @{}
  foreach ($a in [IO.Directory]::EnumerateFiles($destino, '*', [IO.SearchOption]::AllDirectories)) {
    $achados[$a.Substring($destino.Length).TrimStart('\').Replace('\', '/')] = [long]([IO.FileInfo]::new($a).Length)
  }
  if ($achados.Count -ne $esperados.Count) { Falhar 'pacote' 'extração não confere com o zip' }
  foreach ($k in $esperados.Keys) {
    if (-not $achados.ContainsKey($k) -or $achados[$k] -ne $esperados[$k]) { Falhar 'pacote' 'extração não confere com o zip' }
  }
}

# troca item a item; $feitos guarda [de, para] para desfazer
function Trocar([string]$pasta, [string]$nova, [string]$anterior, [string[]]$preservar, [Collections.ArrayList]$feitos) {
  Apagar $anterior
  [void][IO.Directory]::CreateDirectory($anterior)
  $velhos = @([IO.Directory]::GetFileSystemEntries($pasta) | ForEach-Object { [IO.Path]::GetFileName($_) } |
    Where-Object { $preservar -notcontains $_.ToLowerInvariant() } | Sort-Object)
  $novos = @([IO.Directory]::GetFileSystemEntries($nova) | ForEach-Object { [IO.Path]::GetFileName($_) } | Sort-Object)
  foreach ($e in $velhos) { $de = Join-Path $pasta $e; $para = Join-Path $anterior $e; Mover $de $para; [void]$feitos.Add(@($de, $para)) }
  foreach ($e in $novos) { $de = Join-Path $nova $e; $para = Join-Path $pasta $e; Mover $de $para; [void]$feitos.Add(@($de, $para)) }
}

function Desfazer([Collections.ArrayList]$feitos) {
  $ok = $true
  for ($i = $feitos.Count - 1; $i -ge 0; $i--) {
    try { Mover $feitos[$i][1] $feitos[$i][0] } catch { $ok = $false }
  }
  $feitos.Clear()
  return $ok
}

function Principal {
  $aqui = Split-Path -Parent $env:LUC_CMD
  $plug = $null
  $comp = $null
  if ([IO.File]::Exists((Join-Path $aqui 'coletor\coletor.py'))) {
    $comp = $aqui
    $versaoJs = Join-Path $aqui 'pengu\versao.js'
    $plugins = PastaPlugins
    if ($plugins) { $plug = Join-Path $plugins $PASTA_PLUGIN }
  } elseif ([IO.File]::Exists((Join-Path $aqui 'index.js')) -and [IO.File]::Exists((Join-Path $aqui 'versao.js'))) {
    $plug = $aqui
    $versaoJs = Join-Path $aqui 'versao.js'
    $c = Join-Path $env:LOCALAPPDATA "lol-client\complemento\$PASTA_COMPLEMENTO"
    if ([IO.File]::Exists((Join-Path $c 'coletor\coletor.py'))) { $comp = $c }
  } else { Falhar 'pacote' 'atualizar.cmd fora da pasta do plugin ou do complemento' }

  # recusas antes de qualquer rede
  if ($plug -and (Desenvolvimento $plug)) { Falhar 'desenvolvimento' 'plugin' }
  if ($comp -and (Desenvolvimento $comp)) { Falhar 'desenvolvimento' 'complemento' }
  if (-not $plug -or -not [IO.Directory]::Exists($plug)) { Falhar 'sem-plugin' '' }
  # troca anterior que não voltou inteira (do botão ou deste .cmd): a próxima apagaria o anterior\, a única cópia velha
  foreach ($p in @($plug, $comp)) {
    if ($p -and [IO.File]::Exists((Join-Path $p ".atualizacao\$MARCA"))) { Falhar 'troca-incompleta' "marca $MARCA de uma troca anterior" }
  }
  if ($comp -and (ComplementoRodando $comp)) { Falhar 'rodando' '' }
  $lido = LerVersao $versaoJs
  $instalada = $lido[0]
  $repo = $lido[1]

  Write-Host "lol-ultra-client ${instalada}: procurando versão nova em github.com/$repo"
  $bruto = Pegar "$API/repos/$repo/releases/latest" @($API) $LIMITE_API 'application/vnd.github+json'
  try { $rel = [Text.Encoding]::UTF8.GetString($bruto) | ConvertFrom-Json } catch { Falhar 'release' 'resposta não é JSON' }
  $tag = [string]$rel.tag_name
  $alvo = Tupla $tag
  if (-not $alvo -or $rel.draft -or $rel.prerelease) { Falhar 'release' 'release não confere' }
  $versao = ($alvo -join '.')
  if (-not (MaisNova $alvo (Tupla $instalada))) {
    Write-Host "A versão instalada ($instalada) já é a mais nova."
    return 0
  }
  $zips = [ordered]@{ plugin = "$NOME-plugin-$versao.zip" }
  if ($comp) { $zips['complemento'] = "$NOME-complemento-$versao.zip" }
  $digests = @{}
  foreach ($nome in @($zips.Values) + @($SUMS)) {
    $a = @($rel.assets | Where-Object { $_.name -eq $nome })
    if ($a.Count -ne 1) { Falhar 'release' "sem o asset $nome" }
    if ([string]$a[0].browser_download_url -cne "$DOWNLOAD/$repo/releases/download/$tag/$nome") { Falhar 'origem' "URL do asset $nome fora da origem fixa" }
    $m = [regex]::Match([string]$a[0].digest, '^sha256:([0-9a-f]{64})$')
    if (-not $m.Success) { Falhar 'hash' "digest ausente em $nome" }
    $digests[$nome] = $m.Groups[1].Value
  }

  Write-Host "Baixando a versão $versao…"
  $sumsB = Pegar "$DOWNLOAD/$repo/releases/download/$tag/$SUMS" $ORIGENS $LIMITE_SUMS '*/*'
  if ((Sha $sumsB) -ne $digests[$SUMS]) { Falhar 'hash' "$SUMS não confere com o digest" }
  $sums = @{}
  foreach ($l in ([Text.Encoding]::UTF8.GetString($sumsB) -split "`r?`n")) {
    $m = [regex]::Match($l.Trim(), '^([0-9a-fA-F]{64}) [ *](\S.*)$')
    if ($m.Success) { $sums[$m.Groups[2].Value.Trim()] = $m.Groups[1].Value.ToLowerInvariant() }
  }
  $dados = @{}
  foreach ($k in @($zips.Keys)) {
    $nome = $zips[$k]
    $b = Pegar "$DOWNLOAD/$repo/releases/download/$tag/$nome" $ORIGENS $LIMITE_ZIP '*/*'
    $h = Sha $b
    if (-not $sums.ContainsKey($nome) -or $h -ne $sums[$nome] -or $h -ne $digests[$nome]) { Falhar 'hash' "$nome não confere" }
    $dados[$k] = $b
  }

  Write-Host 'Conferindo os arquivos…'
  $trocas = @()
  $novas = @()
  try {   # extração que falha (disco cheio, zip ruim) ou complemento que subiu no meio não deixa nova\ ocupando o disco
    foreach ($k in @($zips.Keys)) {
      if ($k -eq 'plugin') { $destino = $plug; $prefixo = $PASTA_PLUGIN; $preservar = @('.atualizacao') } else { $destino = $comp; $prefixo = $PASTA_COMPLEMENTO; $preservar = @('.atualizacao', 'dados') }
      $estagio = Join-Path $destino '.atualizacao'
      if (Reparse $estagio) { Falhar 'troca' '.atualizacao é junção' }
      $nova = Join-Path $estagio 'nova'
      Apagar $nova
      $novas += $nova
      [void][IO.Directory]::CreateDirectory($nova)
      $esp = Extrair $dados[$k] $prefixo $nova $preservar
      ConferirExtraido $nova $esp
      $trocas += , @($destino, $nova, (Join-Path $estagio 'anterior'), $preservar)
    }
    # de novo logo antes de trocar: o complemento pode ter subido durante o download (abriu o client)
    if ($comp -and (ComplementoRodando $comp)) { Falhar 'rodando' 'subiu durante o download' }
  } catch {
    foreach ($n in $novas) { try { Apagar $n } catch { } }
    throw
  }

  Write-Host 'Instalando…'
  $marcas = @(foreach ($t in $trocas) { Join-Path (Split-Path -Parent $t[1]) $MARCA })
  foreach ($m in $marcas) { [IO.File]::WriteAllText($m, "$versao`n") }   # antes do 1º Move: queda no meio também deixa a marca
  $feitos = New-Object Collections.ArrayList
  try {
    foreach ($t in $trocas) { Trocar $t[0] $t[1] $t[2] $t[3] $feitos }
  } catch {
    $erro = $_.Exception.Message
    $ok = Desfazer $feitos
    if ($ok) {
      foreach ($m in $marcas) { try { [IO.File]::Delete($m) } catch { } }
      foreach ($n in $novas) { try { Apagar $n } catch { } }
      Falhar 'troca' $erro
    }
    Falhar 'troca-incompleta' $erro
  }
  foreach ($m in $marcas) { [IO.File]::Delete($m) }
  foreach ($t in $trocas) { Apagar $t[1] }
  Write-Host "Atualizado para a versão $versao. Reinicie o client (e o complemento coach, se estiver instalado) para usar a versão nova."
  return 0
}

$codigo = 1
try {
  $codigo = @(Principal)[-1]
} catch {
  $msg = [string]$_.Exception.Message
  $motivo = if ($msg -like '*|*') { $msg.Split('|')[0] } else { 'erro' }
  $texto = $TEXTOS[$motivo]
  if (-not $texto) { $texto = 'Não foi possível atualizar agora: tente de novo mais tarde.' }
  Write-Host $texto
  if ($env:LUC_SEM_PAUSA) { Write-Host "motivo: $motivo ($msg)" }
  if (@('desenvolvimento', 'sem-plugin', 'rodando') -contains $motivo) { $codigo = 2 } else { $codigo = 1 }
}
if (-not $env:LUC_SEM_PAUSA) { [void](Read-Host 'Pressione Enter para fechar') }
exit $codigo
