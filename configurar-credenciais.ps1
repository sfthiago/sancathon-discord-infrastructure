[CmdletBinding()]
param(
    [Parameter()]
    [string]$GuildId,

    [Parameter()]
    [securestring]$SecureBotToken,

    [Parameter()]
    [string]$CredentialPath = $env:DISCORD_REPORT_CREDENTIAL_PATH
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not [OperatingSystem]::IsWindows()) {
    throw 'Este armazenamento seguro usa a DPAPI e so pode ser criado no Windows.'
}

if ([string]::IsNullOrWhiteSpace($CredentialPath)) {
    $localAppData = [Environment]::GetFolderPath('LocalApplicationData')
    $CredentialPath = Join-Path `
        $localAppData `
        'DiscordPermissionReport\credentials.clixml'
}

if ([string]::IsNullOrWhiteSpace($GuildId)) {
    $GuildId = Read-Host 'Cole o ID do servidor (Guild ID)'
}

if ($GuildId -notmatch '^\d{17,20}$') {
    throw 'O Guild ID deve ser um ID numerico do Discord com 17 a 20 digitos.'
}

if ($null -eq $SecureBotToken) {
    $SecureBotToken = Read-Host `
        'Cole o token do bot (a entrada ficara oculta)' `
        -AsSecureString
}

if ($SecureBotToken.Length -eq 0) {
    throw 'O token do bot nao pode estar vazio.'
}

$resolvedCredentialPath = [IO.Path]::GetFullPath($CredentialPath)
$credentialDirectory = Split-Path -Parent $resolvedCredentialPath

if (-not (Test-Path -LiteralPath $credentialDirectory)) {
    New-Item `
        -ItemType Directory `
        -Path $credentialDirectory `
        -Force | Out-Null
}

# O Guild ID nao e secreto e ocupa o campo UserName. O token fica no campo
# Password, criptografado pela DPAPI para o usuario e computador atuais.
$credential = [System.Management.Automation.PSCredential]::new(
    $GuildId,
    $SecureBotToken
)

$credential | Export-Clixml `
    -LiteralPath $resolvedCredentialPath `
    -Force

$credential = $null
$SecureBotToken = $null

Write-Host 'Credenciais protegidas salvas com sucesso.'
Write-Host "Arquivo: $resolvedCredentialPath"
Write-Host 'O token so pode ser aberto por este usuario neste computador.'
