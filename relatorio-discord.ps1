[CmdletBinding()]
param(
    [Parameter()]
    [string]$BotToken = $env:DISCORD_BOT_TOKEN,

    [Parameter()]
    [string]$GuildId = $env:DISCORD_GUILD_ID,

    [Parameter()]
    [string]$CredentialPath = $env:DISCORD_REPORT_CREDENTIAL_PATH,

    [Parameter()]
    [string]$OutputDirectory = $PSScriptRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($CredentialPath)) {
    $localAppData = [Environment]::GetFolderPath('LocalApplicationData')
    $CredentialPath = Join-Path `
        $localAppData `
        'DiscordPermissionReport\credentials.clixml'
}

if (
    ([string]::IsNullOrWhiteSpace($BotToken) -or
    [string]::IsNullOrWhiteSpace($GuildId)) -and
    (Test-Path -LiteralPath $CredentialPath)
) {
    if (-not [OperatingSystem]::IsWindows()) {
        throw 'O carregamento seguro por DPAPI esta disponivel somente no Windows.'
    }

    try {
        $storedCredential = [System.Management.Automation.PSCredential](
            Import-Clixml -LiteralPath $CredentialPath
        )

        if ([string]::IsNullOrWhiteSpace($BotToken)) {
            $BotToken = $storedCredential.GetNetworkCredential().Password
        }

        if ([string]::IsNullOrWhiteSpace($GuildId)) {
            $GuildId = $storedCredential.UserName
        }

        $storedCredential = $null
    }
    catch {
        throw "Nao foi possivel carregar as credenciais protegidas de $CredentialPath. Execute .\configurar-credenciais.ps1 novamente. $($_.Exception.Message)"
    }
}

if ([string]::IsNullOrWhiteSpace($BotToken)) {
    throw 'Token ausente. Execute .\configurar-credenciais.ps1 ou defina DISCORD_BOT_TOKEN.'
}

if ([string]::IsNullOrWhiteSpace($GuildId)) {
    throw 'Guild ID ausente. Execute .\configurar-credenciais.ps1 ou defina DISCORD_GUILD_ID.'
}

if ($GuildId -notmatch '^\d{17,20}$') {
    throw 'DISCORD_GUILD_ID deve ser um ID numerico do Discord.'
}

$apiBaseUrl = 'https://discord.com/api/v10'
$requestHeaders = @{
    Authorization = "Bot $BotToken"
    'User-Agent' = 'DiscordPermissionReport/1.0'
}

# Fonte dos bits: https://docs.discord.com/developers/topics/permissions
$permissionFlags = @(
    [pscustomobject]@{ Name = 'CREATE_INSTANT_INVITE'; Bit = 0 }
    [pscustomobject]@{ Name = 'KICK_MEMBERS'; Bit = 1 }
    [pscustomobject]@{ Name = 'BAN_MEMBERS'; Bit = 2 }
    [pscustomobject]@{ Name = 'ADMINISTRATOR'; Bit = 3 }
    [pscustomobject]@{ Name = 'MANAGE_CHANNELS'; Bit = 4 }
    [pscustomobject]@{ Name = 'MANAGE_GUILD'; Bit = 5 }
    [pscustomobject]@{ Name = 'ADD_REACTIONS'; Bit = 6 }
    [pscustomobject]@{ Name = 'VIEW_AUDIT_LOG'; Bit = 7 }
    [pscustomobject]@{ Name = 'PRIORITY_SPEAKER'; Bit = 8 }
    [pscustomobject]@{ Name = 'STREAM'; Bit = 9 }
    [pscustomobject]@{ Name = 'VIEW_CHANNEL'; Bit = 10 }
    [pscustomobject]@{ Name = 'SEND_MESSAGES'; Bit = 11 }
    [pscustomobject]@{ Name = 'SEND_TTS_MESSAGES'; Bit = 12 }
    [pscustomobject]@{ Name = 'MANAGE_MESSAGES'; Bit = 13 }
    [pscustomobject]@{ Name = 'EMBED_LINKS'; Bit = 14 }
    [pscustomobject]@{ Name = 'ATTACH_FILES'; Bit = 15 }
    [pscustomobject]@{ Name = 'READ_MESSAGE_HISTORY'; Bit = 16 }
    [pscustomobject]@{ Name = 'MENTION_EVERYONE'; Bit = 17 }
    [pscustomobject]@{ Name = 'USE_EXTERNAL_EMOJIS'; Bit = 18 }
    [pscustomobject]@{ Name = 'VIEW_GUILD_INSIGHTS'; Bit = 19 }
    [pscustomobject]@{ Name = 'CONNECT'; Bit = 20 }
    [pscustomobject]@{ Name = 'SPEAK'; Bit = 21 }
    [pscustomobject]@{ Name = 'MUTE_MEMBERS'; Bit = 22 }
    [pscustomobject]@{ Name = 'DEAFEN_MEMBERS'; Bit = 23 }
    [pscustomobject]@{ Name = 'MOVE_MEMBERS'; Bit = 24 }
    [pscustomobject]@{ Name = 'USE_VAD'; Bit = 25 }
    [pscustomobject]@{ Name = 'CHANGE_NICKNAME'; Bit = 26 }
    [pscustomobject]@{ Name = 'MANAGE_NICKNAMES'; Bit = 27 }
    [pscustomobject]@{ Name = 'MANAGE_ROLES'; Bit = 28 }
    [pscustomobject]@{ Name = 'MANAGE_WEBHOOKS'; Bit = 29 }
    [pscustomobject]@{ Name = 'MANAGE_GUILD_EXPRESSIONS'; Bit = 30 }
    [pscustomobject]@{ Name = 'USE_APPLICATION_COMMANDS'; Bit = 31 }
    [pscustomobject]@{ Name = 'REQUEST_TO_SPEAK'; Bit = 32 }
    [pscustomobject]@{ Name = 'MANAGE_EVENTS'; Bit = 33 }
    [pscustomobject]@{ Name = 'MANAGE_THREADS'; Bit = 34 }
    [pscustomobject]@{ Name = 'CREATE_PUBLIC_THREADS'; Bit = 35 }
    [pscustomobject]@{ Name = 'CREATE_PRIVATE_THREADS'; Bit = 36 }
    [pscustomobject]@{ Name = 'USE_EXTERNAL_STICKERS'; Bit = 37 }
    [pscustomobject]@{ Name = 'SEND_MESSAGES_IN_THREADS'; Bit = 38 }
    [pscustomobject]@{ Name = 'USE_EMBEDDED_ACTIVITIES'; Bit = 39 }
    [pscustomobject]@{ Name = 'MODERATE_MEMBERS'; Bit = 40 }
    [pscustomobject]@{ Name = 'VIEW_CREATOR_MONETIZATION_ANALYTICS'; Bit = 41 }
    [pscustomobject]@{ Name = 'USE_SOUNDBOARD'; Bit = 42 }
    [pscustomobject]@{ Name = 'CREATE_GUILD_EXPRESSIONS'; Bit = 43 }
    [pscustomobject]@{ Name = 'CREATE_EVENTS'; Bit = 44 }
    [pscustomobject]@{ Name = 'USE_EXTERNAL_SOUNDS'; Bit = 45 }
    [pscustomobject]@{ Name = 'SEND_VOICE_MESSAGES'; Bit = 46 }
    [pscustomobject]@{ Name = 'SET_VOICE_CHANNEL_STATUS'; Bit = 48 }
    [pscustomobject]@{ Name = 'SEND_POLLS'; Bit = 49 }
    [pscustomobject]@{ Name = 'USE_EXTERNAL_APPS'; Bit = 50 }
    [pscustomobject]@{ Name = 'PIN_MESSAGES'; Bit = 51 }
    [pscustomobject]@{ Name = 'BYPASS_SLOWMODE'; Bit = 52 }
)

$channelTypeNames = @{
    0 = 'GUILD_TEXT'
    1 = 'DM'
    2 = 'GUILD_VOICE'
    3 = 'GROUP_DM'
    4 = 'GUILD_CATEGORY'
    5 = 'GUILD_ANNOUNCEMENT'
    10 = 'ANNOUNCEMENT_THREAD'
    11 = 'PUBLIC_THREAD'
    12 = 'PRIVATE_THREAD'
    13 = 'GUILD_STAGE_VOICE'
    14 = 'GUILD_DIRECTORY'
    15 = 'GUILD_FORUM'
    16 = 'GUILD_MEDIA'
}

function Invoke-DiscordGet {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    try {
        return Invoke-RestMethod `
            -Method Get `
            -Uri "$apiBaseUrl$Path" `
            -Headers $requestHeaders `
            -TimeoutSec 30
    }
    catch {
        $details = $_.ErrorDetails.Message
        if ([string]::IsNullOrWhiteSpace($details)) {
            $details = $_.Exception.Message
        }

        throw "Falha ao consultar Discord API em $Path. $details"
    }
}

function Convert-PermissionBitsToNames {
    param(
        [AllowNull()]
        [object]$Value
    )

    $serializedValue = if ($null -eq $Value) { '0' } else { [string]$Value }
    $permissions = [System.Numerics.BigInteger]::Parse($serializedValue)
    $recognizedPermissions = [System.Numerics.BigInteger]::Zero
    $names = foreach ($permissionFlag in $permissionFlags) {
        $flagValue = [System.Numerics.BigInteger]::Pow(
            [System.Numerics.BigInteger]::Parse('2'),
            $permissionFlag.Bit
        )
        $intersection = [System.Numerics.BigInteger]::op_BitwiseAnd(
            $permissions,
            $flagValue
        )

        if ($intersection -eq $flagValue) {
            $recognizedPermissions = [System.Numerics.BigInteger]::op_BitwiseOr(
                $recognizedPermissions,
                $flagValue
            )
            $permissionFlag.Name
        }
    }

    $unknownPermissions = $permissions - $recognizedPermissions
    if ($unknownPermissions -gt [System.Numerics.BigInteger]::Zero) {
        $names = @($names) + "UNKNOWN_BITS:$unknownPermissions"
    }

    return $names -join ' | '
}

function Get-PermissionOverwrites {
    param(
        [Parameter(Mandatory)]
        [object]$Channel
    )

    $property = $Channel.PSObject.Properties['permission_overwrites']
    if ($null -eq $property -or $null -eq $property.Value) {
        return @()
    }

    return @($property.Value)
}

function Get-OverwriteSignature {
    param(
        [AllowEmptyCollection()]
        [object[]]$Overwrites = @()
    )

    $parts = foreach ($overwrite in $Overwrites) {
        $allow = if ($null -eq $overwrite.allow) { '0' } else { [string]$overwrite.allow }
        $deny = if ($null -eq $overwrite.deny) { '0' } else { [string]$overwrite.deny }
        '{0}:{1}:{2}:{3}' -f $overwrite.type, $overwrite.id, $allow, $deny
    }

    return (@($parts | Sort-Object) -join '|')
}

function Protect-CsvValue {
    param(
        [AllowNull()]
        [object]$Value
    )

    $text = if ($null -eq $Value) { '' } else { [string]$Value }
    if ($text -match '^[=+\-@]') {
        return "'$text"
    }

    return $text
}

function Get-ChannelTypeName {
    param(
        [Parameter(Mandatory)]
        [int]$Type
    )

    if ($channelTypeNames.ContainsKey($Type)) {
        return $channelTypeNames[$Type]
    }

    return "UNKNOWN_$Type"
}

$resolvedOutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $resolvedOutputDirectory)) {
    New-Item -ItemType Directory -Path $resolvedOutputDirectory | Out-Null
}

Write-Host 'Consultando canais e cargos na Discord API...'
$channels = @(Invoke-DiscordGet -Path "/guilds/$GuildId/channels")
$roles = @(Invoke-DiscordGet -Path "/guilds/$GuildId/roles")

$rolesById = @{}
foreach ($role in $roles) {
    $rolesById[[string]$role.id] = $role
}

$channelsById = @{}
foreach ($channel in $channels) {
    $channelsById[[string]$channel.id] = $channel
}

$roleRows = foreach ($role in ($roles | Sort-Object position -Descending)) {
    [pscustomobject][ordered]@{
        role_id = [string]$role.id
        role_name = Protect-CsvValue $role.name
        position = $role.position
        managed = $role.managed
        permissions_bitfield = [string]$role.permissions
        permissions = Convert-PermissionBitsToNames $role.permissions
    }
}

$channelRows = foreach ($channel in ($channels | Sort-Object parent_id, position)) {
    $category = $null
    if ($null -ne $channel.parent_id) {
        $parentId = [string]$channel.parent_id
        if ($channelsById.ContainsKey($parentId)) {
            $category = $channelsById[$parentId]
        }
    }

    $overwrites = @(Get-PermissionOverwrites $channel)
    $syncedWithCategory = ''
    if ($null -ne $category) {
        $categoryOverwrites = @(Get-PermissionOverwrites $category)
        $syncedWithCategory = if (
            (Get-OverwriteSignature $overwrites) -eq
            (Get-OverwriteSignature $categoryOverwrites)
        ) { 'sim' } else { 'nao' }
    }

    $channelInfo = [ordered]@{
        channel_id = [string]$channel.id
        channel_name = Protect-CsvValue $channel.name
        channel_type = Get-ChannelTypeName $channel.type
        category_name = if ($null -eq $category) { '' } else { Protect-CsvValue $category.name }
        category_id = if ($null -eq $category) { '' } else { [string]$category.id }
        position = $channel.position
        synced_with_category = $syncedWithCategory
    }

    if ($overwrites.Count -eq 0) {
        [pscustomobject]([ordered]@{} + $channelInfo + [ordered]@{
            target_type = ''
            target_id = ''
            target_name = ''
            allow_bitfield = '0'
            allow_permissions = ''
            deny_bitfield = '0'
            deny_permissions = ''
        })
        continue
    }

    foreach ($overwrite in $overwrites) {
        $isRole = [int]$overwrite.type -eq 0
        $targetName = 'membro individual'
        if ($isRole) {
            $targetId = [string]$overwrite.id
            $targetName = if ($rolesById.ContainsKey($targetId)) {
                Protect-CsvValue $rolesById[$targetId].name
            }
            else {
                'cargo desconhecido'
            }
        }

        $allow = if ($null -eq $overwrite.allow) { '0' } else { [string]$overwrite.allow }
        $deny = if ($null -eq $overwrite.deny) { '0' } else { [string]$overwrite.deny }

        [pscustomobject]([ordered]@{} + $channelInfo + [ordered]@{
            target_type = if ($isRole) { 'role' } else { 'member' }
            target_id = [string]$overwrite.id
            target_name = $targetName
            allow_bitfield = $allow
            allow_permissions = Convert-PermissionBitsToNames $allow
            deny_bitfield = $deny
            deny_permissions = Convert-PermissionBitsToNames $deny
        })
    }
}

$rolesPath = Join-Path $resolvedOutputDirectory 'discord-roles.csv'
$channelsPath = Join-Path $resolvedOutputDirectory 'discord-channel-permissions.csv'
$rawPath = Join-Path $resolvedOutputDirectory 'discord-raw-report.json'
$generatedAt = [DateTimeOffset]::UtcNow.ToString('o')

$roleRows | Export-Csv -LiteralPath $rolesPath -NoTypeInformation -Encoding utf8BOM
$channelRows | Export-Csv -LiteralPath $channelsPath -NoTypeInformation -Encoding utf8BOM

[ordered]@{
    generated_at = $generatedAt
    guild_id = $GuildId
    roles = $roles
    channels = $channels
} | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $rawPath -Encoding utf8

Write-Host "Relatorio gerado em $generatedAt"
Write-Host "- $rolesPath ($($roleRows.Count) cargos)"
Write-Host "- $channelsPath ($($channels.Count) canais, $($channelRows.Count) linhas)"
Write-Host "- $rawPath"
