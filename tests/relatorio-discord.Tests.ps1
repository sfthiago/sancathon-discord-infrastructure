Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$global:DiscordReportMockRoles = @(
    [pscustomobject]@{
        id = '11111111111111111'
        name = '@everyone'
        position = 0
        managed = $false
        permissions = '1024'
    }
    [pscustomobject]@{
        id = '22222222222222222'
        name = 'Moderacao'
        position = 1
        managed = $false
        permissions = '8192'
    }
)

$categoryOverwrites = @(
    [pscustomobject]@{
        id = '11111111111111111'
        type = 0
        allow = '1024'
        deny = '2048'
    }
)

$global:DiscordReportMockChannels = @(
    [pscustomobject]@{
        id = '33333333333333333'
        name = 'Equipe'
        type = 4
        parent_id = $null
        position = 0
        permission_overwrites = $categoryOverwrites
    }
    [pscustomobject]@{
        id = '44444444444444444'
        name = 'moderacao'
        type = 0
        parent_id = '33333333333333333'
        position = 0
        permission_overwrites = $categoryOverwrites
    }
    [pscustomobject]@{
        id = '55555555555555555'
        name = 'geral'
        type = 0
        parent_id = $null
        position = 1
        permission_overwrites = @()
    }
)

function global:Invoke-RestMethod {
    param(
        [string]$Method,
        [string]$Uri,
        [hashtable]$Headers,
        [int]$TimeoutSec
    )

    if ($Uri.EndsWith('/channels')) {
        return $global:DiscordReportMockChannels
    }

    if ($Uri.EndsWith('/roles')) {
        return $global:DiscordReportMockRoles
    }

    throw "URI inesperada no teste: $Uri"
}

$workspace = [IO.Path]::GetFullPath((Resolve-Path (Join-Path $PSScriptRoot '..')).Path)
$testDirectory = Join-Path $workspace ('.test-output-' + [guid]::NewGuid().ToString('N'))
$testCredentialPath = Join-Path $testDirectory 'credentials.clixml'

try {
    $testToken = ConvertTo-SecureString `
        'credencial-simulada' `
        -AsPlainText `
        -Force

    & (Join-Path $workspace 'configurar-credenciais.ps1') `
        -GuildId '11111111111111111' `
        -SecureBotToken $testToken `
        -CredentialPath $testCredentialPath

    & (Join-Path $workspace 'relatorio-discord.ps1') `
        -CredentialPath $testCredentialPath `
        -OutputDirectory $testDirectory

    $roleRows = @(
        Import-Csv (Join-Path $testDirectory 'discord-roles.csv')
    )
    $channelRows = @(
        Import-Csv (Join-Path $testDirectory 'discord-channel-permissions.csv')
    )
    $rawReport = Get-Content `
        -Raw `
        (Join-Path $testDirectory 'discord-raw-report.json') |
        ConvertFrom-Json

    if ($roleRows.Count -ne 2) {
        throw "Quantidade de cargos incorreta: $($roleRows.Count)"
    }

    if ($channelRows.Count -ne 3) {
        throw "Quantidade de linhas de canais incorreta: $($channelRows.Count)"
    }

    $moderationChannel = $channelRows |
        Where-Object channel_name -eq 'moderacao'

    if ($moderationChannel.synced_with_category -ne 'sim') {
        throw 'Sincronizacao com a categoria incorreta.'
    }

    if ($moderationChannel.allow_permissions -notmatch 'VIEW_CHANNEL') {
        throw 'Decodificacao da permissao permitida incorreta.'
    }

    if ($moderationChannel.deny_permissions -notmatch 'SEND_MESSAGES') {
        throw 'Decodificacao da permissao negada incorreta.'
    }

    if ($rawReport.guild_id -ne '11111111111111111') {
        throw 'Snapshot JSON incorreto.'
    }

    Write-Host 'Teste de integracao simulado aprovado.'
}
finally {
    Remove-Item Function:\Invoke-RestMethod -ErrorAction SilentlyContinue
    Remove-Variable `
        DiscordReportMockRoles, DiscordReportMockChannels `
        -Scope Global `
        -ErrorAction SilentlyContinue

    if (Test-Path -LiteralPath $testDirectory) {
        $resolvedTestDirectory = [IO.Path]::GetFullPath($testDirectory)
        $expectedPrefix = $workspace + [IO.Path]::DirectorySeparatorChar + '.test-output-'

        if (-not $resolvedTestDirectory.StartsWith($expectedPrefix)) {
            throw "Diretorio temporario inesperado: $resolvedTestDirectory"
        }

        Remove-Item -LiteralPath $resolvedTestDirectory -Recurse -Force
    }
}
