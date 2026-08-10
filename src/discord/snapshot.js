import { ChannelType, OverwriteType } from "discord.js";

import { decodePermissionSet, colorToHex } from "../utils/permissions.js";

const channelTypeNames = new Map([
  [ChannelType.GuildText, "GuildText"],
  [ChannelType.GuildVoice, "GuildVoice"],
  [ChannelType.GuildCategory, "GuildCategory"],
  [ChannelType.GuildAnnouncement, "GuildAnnouncement"],
  [ChannelType.GuildStageVoice, "GuildStageVoice"],
  [ChannelType.GuildForum, "GuildForum"],
  [ChannelType.GuildMedia, "GuildMedia"],
]);

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection.filter(Boolean);
  if (typeof collection.values === "function") {
    return [...collection.values()].filter(Boolean);
  }
  return [...collection].filter(Boolean);
}

function bitfieldValue(value) {
  if (value && typeof value === "object" && "bitfield" in value) {
    return BigInt(value.bitfield ?? 0);
  }
  return BigInt(value ?? 0);
}

function normalizePermissions(value) {
  return decodePermissionSet(bitfieldValue(value));
}

function normalizeFlags(value) {
  const bitfield = bitfieldValue(value);
  const names =
    typeof value?.toArray === "function" ? [...value.toArray()].sort() : [];

  return { bitfield: bitfield.toString(), names };
}

function compareSnowflakes(left, right) {
  const leftId = String(left);
  const rightId = String(right);
  if (leftId.length !== rightId.length) return leftId.length - rightId.length;
  return leftId.localeCompare(rightId);
}

function normalizeRoleTags(tags) {
  if (!tags) return null;
  return {
    botId: tags.botId ?? null,
    integrationId: tags.integrationId ?? null,
    premiumSubscriberRole: tags.premiumSubscriberRole === true,
    subscriptionListingId: tags.subscriptionListingId ?? null,
    availableForPurchase: tags.availableForPurchase === true,
    guildConnections: tags.guildConnections === true,
  };
}

function normalizeRole(role) {
  const permissions = normalizePermissions(role.permissions);
  const flags = normalizeFlags(role.flags);
  const primaryColor = role.colors?.primaryColor ?? role.color ?? 0;

  return {
    id: String(role.id),
    name: String(role.name),
    position: Number(role.position ?? role.rawPosition ?? 0),
    rawPosition: Number(role.rawPosition ?? role.position ?? 0),
    colors: {
      primaryColor: Number(primaryColor),
      secondaryColor: role.colors?.secondaryColor ?? null,
      tertiaryColor: role.colors?.tertiaryColor ?? null,
    },
    hexColor: colorToHex(primaryColor),
    hoist: role.hoist === true,
    mentionable: role.mentionable === true,
    managed: role.managed === true,
    editable: role.editable === true,
    permissions: permissions.bitfield,
    permissionNames: permissions.names,
    unknownPermissions: permissions.unknownBitfield,
    flags: flags.bitfield,
    flagNames: flags.names,
    tags: normalizeRoleTags(role.tags),
  };
}

function normalizeForumEmoji(emoji) {
  if (!emoji) return null;
  return { id: emoji.id ?? null, name: emoji.name ?? null };
}

function normalizeForumTag(tag, index) {
  return {
    id: String(tag.id),
    name: String(tag.name),
    moderated: tag.moderated === true,
    emoji: normalizeForumEmoji(tag.emoji),
    position: index,
  };
}

function normalizeOverwrite(overwrite, roleNames, botMember) {
  const allow = normalizePermissions(overwrite.allow);
  const deny = normalizePermissions(overwrite.deny);
  const id = String(overwrite.id);
  const targetType =
    overwrite.type === OverwriteType.Role
      ? "role"
      : overwrite.type === OverwriteType.Member
        ? "member"
        : "unknown";

  let targetName = null;
  if (targetType === "role") targetName = roleNames.get(id) ?? null;
  if (targetType === "member" && id === String(botMember.id)) {
    targetName = botMember.displayName ?? botMember.user?.username ?? null;
  }

  return {
    id,
    type: Number(overwrite.type),
    targetType,
    targetName,
    allow: allow.bitfield,
    allowNames: allow.names,
    unknownAllow: allow.unknownBitfield,
    deny: deny.bitfield,
    denyNames: deny.names,
    unknownDeny: deny.unknownBitfield,
  };
}

function normalizeDefaultReaction(emoji) {
  if (!emoji) return null;
  return { id: emoji.id ?? null, name: emoji.name ?? null };
}

function normalizeChannel(channel, roleNames, botMember) {
  const flags = normalizeFlags(channel.flags);
  const permissionOverwrites = collectionValues(
    channel.permissionOverwrites?.cache,
  )
    .map((overwrite) =>
      normalizeOverwrite(overwrite, roleNames, botMember),
    )
    .sort(
      (left, right) =>
        left.type - right.type || compareSnowflakes(left.id, right.id),
    );

  const availableTags = Array.isArray(channel.availableTags)
    ? channel.availableTags.map(normalizeForumTag)
    : [];

  return {
    id: String(channel.id),
    name: String(channel.name),
    type: Number(channel.type),
    typeName: channelTypeNames.get(channel.type) ?? `Unknown(${channel.type})`,
    parentId: channel.parentId ? String(channel.parentId) : null,
    position: Number(channel.position ?? channel.rawPosition ?? 0),
    rawPosition: Number(channel.rawPosition ?? channel.position ?? 0),
    topic: typeof channel.topic === "string" ? channel.topic : null,
    nsfw: typeof channel.nsfw === "boolean" ? channel.nsfw : null,
    rateLimitPerUser:
      typeof channel.rateLimitPerUser === "number"
        ? channel.rateLimitPerUser
        : null,
    bitrate: typeof channel.bitrate === "number" ? channel.bitrate : null,
    userLimit:
      typeof channel.userLimit === "number" ? channel.userLimit : null,
    rtcRegion: channel.rtcRegion ?? null,
    videoQualityMode: channel.videoQualityMode ?? null,
    defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration ?? null,
    defaultThreadRateLimitPerUser:
      channel.defaultThreadRateLimitPerUser ?? null,
    defaultForumLayout: channel.defaultForumLayout ?? null,
    defaultSortOrder: channel.defaultSortOrder ?? null,
    defaultReactionEmoji: normalizeDefaultReaction(
      channel.defaultReactionEmoji,
    ),
    availableTags,
    permissionsLocked:
      typeof channel.permissionsLocked === "boolean"
        ? channel.permissionsLocked
        : null,
    manageable: channel.manageable === true,
    viewable: channel.viewable === true,
    flags: flags.bitfield,
    flagNames: flags.names,
    permissionOverwrites,
  };
}

function sortRoles(roles) {
  return [...roles].sort(
    (left, right) =>
      right.rawPosition - left.rawPosition ||
      compareSnowflakes(right.id, left.id),
  );
}

function sortChannels(channels) {
  return [...channels].sort(
    (left, right) =>
      left.rawPosition - right.rawPosition ||
      left.type - right.type ||
      compareSnowflakes(left.id, right.id),
  );
}

function normalizeBotMember(botMember) {
  const permissions = normalizePermissions(botMember.permissions);
  const roleIds = collectionValues(botMember.roles?.cache)
    .sort(
      (left, right) =>
        Number(right.rawPosition ?? right.position ?? 0) -
          Number(left.rawPosition ?? left.position ?? 0) ||
        compareSnowflakes(right.id, left.id),
    )
    .map((role) => String(role.id));
  const highestRole = botMember.roles?.highest ?? null;

  return {
    id: String(botMember.id),
    username: botMember.user?.username ?? null,
    globalName: botMember.user?.globalName ?? null,
    displayName: botMember.displayName ?? null,
    tag: botMember.user?.tag ?? null,
    roleIds,
    highestRoleId: highestRole ? String(highestRole.id) : null,
    highestRoleName: highestRole?.name ?? null,
    highestRolePosition: highestRole
      ? Number(highestRole.position ?? highestRole.rawPosition ?? 0)
      : null,
    permissions: permissions.bitfield,
    permissionNames: permissions.names,
    unknownPermissions: permissions.unknownBitfield,
  };
}

/**
 * Converts discord.js structures to a deterministic, JSON-safe snapshot.
 * Only explicitly selected fields are copied, so client and token references
 * can never be included in reports or state files.
 */
export function createDiscordSnapshot({ guild, botMember, roles, channels }) {
  if (!guild || !botMember) {
    throw new TypeError("Guild e botMember sao obrigatorios para o snapshot.");
  }

  const normalizedRoles = sortRoles(
    collectionValues(roles).map(normalizeRole),
  );
  const roleNames = new Map(
    normalizedRoles.map((role) => [role.id, role.name]),
  );
  const normalizedBotMember = normalizeBotMember(botMember);
  const normalizedChannels = sortChannels(
    collectionValues(channels).map((channel) =>
      normalizeChannel(channel, roleNames, botMember),
    ),
  );
  const categories = normalizedChannels
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .map((category) => ({
      ...category,
      childChannelIds: normalizedChannels
        .filter((channel) => channel.parentId === category.id)
        .map((channel) => channel.id),
    }));
  const childChannels = normalizedChannels.filter(
    (channel) => channel.type !== ChannelType.GuildCategory,
  );

  return {
    schemaVersion: 1,
    guild: {
      id: String(guild.id),
      name: String(guild.name),
      ownerId: guild.ownerId ? String(guild.ownerId) : null,
      memberCount:
        typeof guild.memberCount === "number" ? guild.memberCount : null,
      preferredLocale: guild.preferredLocale ?? null,
      premiumTier: guild.premiumTier ?? null,
      features: [...(guild.features ?? [])].map(String).sort(),
      communityEnabled: guild.features?.includes?.("COMMUNITY") === true,
      systemChannelId: guild.systemChannelId ?? null,
      rulesChannelId: guild.rulesChannelId ?? null,
      publicUpdatesChannelId: guild.publicUpdatesChannelId ?? null,
      safetyAlertsChannelId: guild.safetyAlertsChannelId ?? null,
      roleCount: normalizedRoles.length,
      categoryCount: categories.length,
      channelCount: childChannels.length,
    },
    botMember: normalizedBotMember,
    roles: normalizedRoles,
    categories,
    channels: childChannels,
  };
}
