import {
  colorToHex,
  decodePermissionSet,
  encodePermissions,
  permissionEntries,
} from "../utils/permissions.js";

export const AUDIT_SCHEMA_VERSION = 1;

const DEPRECATED_PERMISSION_ALIASES = new Set([
  "ManageEmojisAndStickers",
]);

const canonicalPermissionFlags = permissionEntries
  .map(([name, value]) => [name, BigInt(value)])
  .filter(([name]) => !DEPRECATED_PERMISSION_ALIASES.has(name))
  .sort(([leftName, leftValue], [rightName, rightValue]) => {
    if (leftValue !== rightValue) {
      return leftValue < rightValue ? -1 : 1;
    }

    return compareText(leftName, rightName);
  })
  .filter(([, value], index, entries) => (
    index === 0 || entries[index - 1][1] !== value
  ));
const canonicalPermissionNames = new Set(
  canonicalPermissionFlags.map(([name]) => name),
);

const CHANNEL_TYPES_BY_CODE = new Map([
  [0, "text"],
  [2, "voice"],
  [4, "category"],
  [5, "announcement"],
  [10, "announcement-thread"],
  [11, "public-thread"],
  [12, "private-thread"],
  [13, "stage"],
  [15, "forum"],
  [16, "media"],
]);

const CHANNEL_CODES_BY_TYPE = new Map(
  [...CHANNEL_TYPES_BY_CODE.entries()].map(([code, type]) => [type, code]),
);

const CHANNEL_TYPE_ALIASES = new Map([
  ["guildtext", "text"],
  ["text", "text"],
  ["guildvoice", "voice"],
  ["voice", "voice"],
  ["guildcategory", "category"],
  ["category", "category"],
  ["guildannouncement", "announcement"],
  ["announcement", "announcement"],
  ["announcementthread", "announcement-thread"],
  ["publicthread", "public-thread"],
  ["privatethread", "private-thread"],
  ["guildstagevoice", "stage"],
  ["stage", "stage"],
  ["guildforum", "forum"],
  ["forum", "forum"],
  ["guildmedia", "media"],
  ["media", "media"],
]);

const FORUM_TYPES = new Set(["forum", "media"]);
const VOICE_TYPES = new Set(["voice", "stage"]);
const REQUIRE_TAG_FLAG = 1n << 4n;

function compareText(left, right) {
  const leftText = String(left ?? "");
  const rightText = String(right ?? "");

  if (leftText === rightText) {
    return 0;
  }

  return leftText < rightText ? -1 : 1;
}

function compareSnowflakes(left, right) {
  const leftText = String(left ?? "");
  const rightText = String(right ?? "");

  if (/^\d+$/.test(leftText) && /^\d+$/.test(rightText)) {
    const leftValue = BigInt(leftText);
    const rightValue = BigInt(rightText);

    if (leftValue !== rightValue) {
      return leftValue < rightValue ? -1 : 1;
    }

    return 0;
  }

  return compareText(leftText, rightText);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flatObjects(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flat(Infinity).filter(isRecord);
}

function flatValues(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flat(Infinity).filter((item) => item !== null && item !== undefined);
}

function nullableString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function snowflake(value, fieldName = "snowflake") {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new TypeError(`${fieldName} cannot be an unsafe JavaScript number.`);
  }

  return String(value);
}

function integer(value, fallback = 0) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function primitiveOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (["string", "number", "boolean"].includes(typeof value)) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString(10);
  }

  return null;
}

function bitfieldFromPermissionNames(names) {
  return encodePermissions(flatValues(names).map(String));
}

function unsignedBitfield(value, fieldName = "bitfield") {
  let bitfield;

  if (value === null || value === undefined || value === "") {
    bitfield = 0n;
  } else if (Array.isArray(value)) {
    bitfield = bitfieldFromPermissionNames(value);
  } else if (isRecord(value) && value.bitfield !== undefined) {
    bitfield = unsignedBitfield(value.bitfield, fieldName);
  } else if (isRecord(value) && Array.isArray(value.names)) {
    bitfield = bitfieldFromPermissionNames(value.names);
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${fieldName} cannot be an unsafe JavaScript number.`);
    }

    bitfield = BigInt(value);
  } else {
    try {
      bitfield = BigInt(value);
    } catch {
      throw new TypeError(`${fieldName} must be an unsigned integer bitfield.`);
    }
  }

  if (bitfield < 0n) {
    throw new TypeError(`${fieldName} must be an unsigned integer bitfield.`);
  }

  return bitfield;
}

function reportPermissionSet(value, diagnostics, resource, path) {
  const bitfield = unsignedBitfield(value, path);
  const decoded = decodePermissionSet(bitfield);
  const names = decoded.names.filter((name) => canonicalPermissionNames.has(name));
  const unknownBitfield = BigInt(decoded.unknownBitfield);

  if (unknownBitfield !== 0n) {
    diagnostics.push({
      severity: "warning",
      code: "UNKNOWN_PERMISSION_BITS",
      path,
      message: `Permission bitfield contains unknown bits: ${unknownBitfield}.`,
      resource,
    });
  }

  return {
    bitfield: decoded.bitfield,
    names,
    unknownBitfield: unknownBitfield.toString(10),
  };
}

function reportColor(value) {
  let numericColor = 0;

  if (isRecord(value)) {
    if (value.value !== undefined && value.value !== null) {
      numericColor = integer(value.value, 0);
    } else if (typeof value.hex === "string" && /^#[0-9a-f]{6}$/i.test(value.hex)) {
      numericColor = Number.parseInt(value.hex.slice(1), 16);
    }
  } else if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
    numericColor = Number.parseInt(value.slice(1), 16);
  } else {
    numericColor = integer(value, 0);
  }

  if (numericColor < 0 || numericColor > 0xffffff) {
    throw new TypeError("Role color must be between 0 and 0xFFFFFF.");
  }

  return {
    value: numericColor,
    hex: colorToHex(numericColor),
  };
}

function canonicalChannelType(source) {
  const providedCode = nullableInteger(source?.typeCode);
  const numericType = typeof source?.type === "number"
    ? nullableInteger(source.type)
    : null;
  const typeCode = providedCode ?? numericType;

  if (typeCode !== null && CHANNEL_TYPES_BY_CODE.has(typeCode)) {
    return {
      type: CHANNEL_TYPES_BY_CODE.get(typeCode),
      typeCode,
    };
  }

  const normalizedType = String(source?.type ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const type = CHANNEL_TYPE_ALIASES.get(normalizedType) ?? "unknown";

  return {
    type,
    typeCode: typeCode ?? CHANNEL_CODES_BY_TYPE.get(type) ?? null,
  };
}

function reportEmoji(value) {
  if (!isRecord(value)) {
    return null;
  }

  const id = snowflake(
    value.id ?? value.emojiId ?? value.emoji_id,
    "emoji.id",
  );
  const name = nullableString(value.name ?? value.emojiName ?? value.emoji_name);

  return id === null && name === null ? null : { id, name };
}

function resourceReference(type, source) {
  return {
    type,
    id: snowflake(source?.id, `${type}.id`),
    name: nullableString(source?.name),
  };
}

function normalizeOverwrites(
  source,
  diagnostics,
  resource,
  roleNamesById,
) {
  const seenTargets = new Set();

  return flatObjects(source)
    .map((overwrite, index) => {
      const numericType = overwrite.targetType ?? overwrite.type;
      const targetType = numericType === 0 || numericType === "0"
        ? "role"
        : numericType === 1 || numericType === "1"
          ? "member"
          : numericType === "member"
            ? "member"
            : "role";
      const targetId = snowflake(
        overwrite.targetId ?? overwrite.id ?? overwrite.target?.id,
        `${resource.type}.permissionOverwrites[${index}].targetId`,
      );
      const targetName = nullableString(
        overwrite.targetName
          ?? overwrite.target?.name
          ?? (targetType === "role" ? roleNamesById.get(targetId) : null),
      );
      const overwriteResource = {
        ...resource,
        targetType,
        targetId,
      };
      const allow = reportPermissionSet(
        overwrite.allow,
        diagnostics,
        overwriteResource,
        `${resource.type}.permissionOverwrites.allow`,
      );
      const deny = reportPermissionSet(
        overwrite.deny,
        diagnostics,
        overwriteResource,
        `${resource.type}.permissionOverwrites.deny`,
      );
      const conflict = BigInt(allow.bitfield) & BigInt(deny.bitfield);
      const signature = `${targetType}:${targetId ?? ""}`;

      if (seenTargets.has(signature)) {
        diagnostics.push({
          severity: "warning",
          code: "DUPLICATE_OVERWRITE_TARGET",
          path: `${resource.type}.permissionOverwrites`,
          message: `Duplicate permission overwrite target: ${signature}.`,
          resource,
        });
      }
      seenTargets.add(signature);

      if (targetId === null) {
        diagnostics.push({
          severity: "warning",
          code: "MISSING_OVERWRITE_TARGET_ID",
          path: `${resource.type}.permissionOverwrites[${index}]`,
          message: "Permission overwrite does not have a target ID.",
          resource,
        });
      } else if (targetType === "role" && targetName === null) {
        diagnostics.push({
          severity: "warning",
          code: "UNKNOWN_OVERWRITE_TARGET",
          path: `${resource.type}.permissionOverwrites[${index}]`,
          message: `Role overwrite target ${targetId} could not be resolved.`,
          resource,
        });
      }

      if (conflict !== 0n) {
        diagnostics.push({
          severity: "warning",
          code: "OVERWRITE_ALLOW_DENY_CONFLICT",
          path: `${resource.type}.permissionOverwrites[${index}]`,
          message: `Overwrite allows and denies the same bits: ${conflict}.`,
          resource,
        });
      }

      return {
        target: {
          type: targetType,
          id: targetId,
          name: targetName,
          resolved: targetName !== null,
        },
        allow,
        deny,
      };
    })
    .sort((left, right) => {
      if (left.target.type !== right.target.type) {
        return left.target.type === "role" ? -1 : 1;
      }

      return compareSnowflakes(left.target.id, right.target.id);
    });
}

function uniqueResources(items, resourceType, diagnostics) {
  const seenIds = new Set();

  return items.filter((item) => {
    const id = snowflake(item.id, `${resourceType}.id`);

    if (id === null || !seenIds.has(id)) {
      if (id !== null) {
        seenIds.add(id);
      }
      return true;
    }

    diagnostics.push({
      severity: "warning",
      code: "DUPLICATE_SNAPSHOT_RESOURCE",
      path: `${resourceType}s`,
      message: `Duplicate ${resourceType} ID in normalized snapshot: ${id}.`,
      resource: {
        type: resourceType,
        id,
        name: nullableString(item.name),
      },
    });
    return false;
  });
}

function normalizeRoles(source, diagnostics) {
  return uniqueResources(flatObjects(source), "role", diagnostics)
    .map((role) => {
      const resource = resourceReference("role", role);

      return {
        id: resource.id,
        name: resource.name,
        position: integer(role.position, 0),
        color: reportColor(
          role.color ?? role.colors?.primaryColor ?? role.hexColor,
        ),
        hoist: Boolean(role.hoist),
        mentionable: Boolean(role.mentionable),
        managed: Boolean(role.managed),
        permissions: reportPermissionSet(
          role.permissions,
          diagnostics,
          resource,
          "role.permissions",
        ),
      };
    })
    .sort((left, right) => (
      right.position - left.position
      || compareSnowflakes(left.id, right.id)
    ));
}

function normalizeCategory(source, diagnostics, roleNamesById) {
  const resource = resourceReference("category", source);
  const providedType = canonicalChannelType(source);

  if (providedType.type !== "category" && providedType.type !== "unknown") {
    diagnostics.push({
      severity: "warning",
      code: "INVALID_CATEGORY_TYPE",
      path: "categories.type",
      message: `Category ${resource.name ?? resource.id ?? "unknown"} has type ${providedType.type}.`,
      resource,
    });
  }

  return {
    id: resource.id,
    name: resource.name,
    type: "category",
    typeCode: 4,
    position: integer(source.position, 0),
    nsfw: Boolean(source.nsfw),
    permissionOverwrites: normalizeOverwrites(
      source.permissionOverwrites ?? source.permission_overwrites,
      diagnostics,
      resource,
      roleNamesById,
    ),
  };
}

function overwriteSignature(overwrites) {
  return overwrites
    .map((overwrite) => [
      overwrite.target.type,
      overwrite.target.id ?? "",
      overwrite.allow.bitfield,
      overwrite.deny.bitfield,
    ].join(":"))
    .sort(compareText)
    .join("|");
}

function normalizeForum(source) {
  const flags = unsignedBitfield(source.flags, "channel.flags");
  const availableTags = flatObjects(source.availableTags ?? source.available_tags)
    .map((tag) => ({
      id: snowflake(tag.id, "forum.availableTags.id"),
      name: nullableString(tag.name),
      moderated: Boolean(tag.moderated),
      emoji: reportEmoji(tag.emoji ?? {
        id: tag.emojiId ?? tag.emoji_id,
        name: tag.emojiName ?? tag.emoji_name,
      }),
    }))
    .sort((left, right) => (
      compareText(left.name, right.name)
      || compareSnowflakes(left.id, right.id)
    ));

  return {
    availableTags,
    defaultReactionEmoji: reportEmoji(
      source.defaultReactionEmoji ?? source.default_reaction_emoji,
    ),
    defaultSortOrder: primitiveOrNull(
      source.defaultSortOrder ?? source.default_sort_order,
    ),
    defaultLayout: primitiveOrNull(
      source.defaultForumLayout ?? source.default_forum_layout,
    ),
    defaultThreadSlowmodeSeconds: integer(
      source.defaultThreadSlowmodeSeconds
        ?? source.defaultThreadRateLimitPerUser
        ?? source.default_thread_rate_limit_per_user,
      0,
    ),
    requireTag: typeof source.requireTag === "boolean"
      ? source.requireTag
      : (flags & REQUIRE_TAG_FLAG) === REQUIRE_TAG_FLAG,
  };
}

function normalizeVoice(source) {
  return {
    bitrate: nullableInteger(source.bitrate),
    userLimit: integer(source.userLimit ?? source.user_limit, 0),
    rtcRegion: nullableString(source.rtcRegion ?? source.rtc_region),
    videoQualityMode: primitiveOrNull(
      source.videoQualityMode ?? source.video_quality_mode,
    ),
  };
}

function normalizeChannel(
  source,
  diagnostics,
  roleNamesById,
  categoriesById,
) {
  const resource = resourceReference("channel", source);
  const { type, typeCode } = canonicalChannelType(source);
  const parentId = snowflake(
    source.parentId ?? source.parent_id ?? source.parent?.id,
    "channel.parentId",
  );
  const parentCategory = parentId === null ? null : categoriesById.get(parentId);
  const permissionOverwrites = normalizeOverwrites(
    source.permissionOverwrites ?? source.permission_overwrites,
    diagnostics,
    resource,
    roleNamesById,
  );
  let permissionsSyncedWithParent = null;

  if (type === "unknown") {
    diagnostics.push({
      severity: "warning",
      code: "UNKNOWN_CHANNEL_TYPE",
      path: "channels.type",
      message: `Channel ${resource.name ?? resource.id ?? "unknown"} has an unknown type.`,
      resource,
    });
  }

  if (parentId !== null) {
    if (typeof source.permissionsLocked === "boolean") {
      permissionsSyncedWithParent = source.permissionsLocked;
    } else if (parentCategory !== undefined) {
      permissionsSyncedWithParent = (
        overwriteSignature(permissionOverwrites)
        === overwriteSignature(parentCategory.permissionOverwrites)
      );
    }

    if (parentCategory === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "UNKNOWN_PARENT_CATEGORY",
        path: "channels.parentId",
        message: `Parent category ${parentId} could not be resolved.`,
        resource,
      });
    }
  }

  return {
    id: resource.id,
    name: resource.name,
    type,
    typeCode,
    position: integer(source.position, 0),
    parent: parentId === null
      ? null
      : {
          id: parentId,
          name: parentCategory?.name ?? nullableString(source.parent?.name),
        },
    topic: nullableString(source.topic),
    nsfw: Boolean(source.nsfw),
    slowmodeSeconds: integer(
      source.slowmodeSeconds ?? source.rateLimitPerUser ?? source.rate_limit_per_user,
      0,
    ),
    flags: unsignedBitfield(source.flags, "channel.flags").toString(10),
    permissionsSyncedWithParent,
    permissionOverwrites,
    forum: FORUM_TYPES.has(type) ? normalizeForum(source) : null,
    voice: VOICE_TYPES.has(type) ? normalizeVoice(source) : null,
  };
}

function normalizeBot(botMember, diagnostics) {
  if (!isRecord(botMember)) {
    return null;
  }

  const resource = {
    type: "bot",
    id: snowflake(botMember.id, "botMember.id"),
    name: nullableString(botMember.name ?? botMember.username),
  };

  return {
    id: resource.id,
    roleIds: [...new Set(
      flatValues(botMember.roleIds).map((id) => snowflake(id, "botMember.roleIds")),
    )]
      .filter((id) => id !== null)
      .sort(compareSnowflakes),
    highestRoleId: snowflake(botMember.highestRoleId, "botMember.highestRoleId"),
    highestRolePosition: nullableInteger(botMember.highestRolePosition),
    permissions: reportPermissionSet(
      botMember.permissions,
      diagnostics,
      resource,
      "bot.permissions",
    ),
  };
}

function normalizedGeneratedAt(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new TypeError("generatedAt must be a valid date.");
  }

  return date.toISOString();
}

function sortDiagnostics(diagnostics) {
  const severityOrder = new Map([
    ["error", 0],
    ["warning", 1],
    ["info", 2],
  ]);

  return diagnostics
    .map((diagnostic) => ({
      severity: diagnostic.severity ?? "warning",
      code: diagnostic.code ?? "AUDIT_DIAGNOSTIC",
      path: diagnostic.path ?? null,
      message: String(diagnostic.message ?? ""),
      resource: diagnostic.resource
        ? {
            type: diagnostic.resource.type ?? null,
            id: snowflake(diagnostic.resource.id, "diagnostic.resource.id"),
            name: nullableString(diagnostic.resource.name),
            ...(diagnostic.resource.targetType
              ? { targetType: diagnostic.resource.targetType }
              : {}),
            ...(diagnostic.resource.targetId
              ? { targetId: snowflake(diagnostic.resource.targetId) }
              : {}),
          }
        : null,
    }))
    .sort((left, right) => (
      (severityOrder.get(left.severity) ?? 99)
        - (severityOrder.get(right.severity) ?? 99)
      || compareText(left.code, right.code)
      || compareText(left.resource?.type, right.resource?.type)
      || compareSnowflakes(left.resource?.id, right.resource?.id)
      || compareText(left.message, right.message)
    ));
}

/**
 * Builds a stable, machine-readable report from a normalized plain snapshot.
 * Only explicitly selected fields are copied, so API payloads and credentials
 * cannot leak through accidental object spreading.
 */
export function buildReport(snapshot = {}, options = {}) {
  if (!isRecord(snapshot)) {
    throw new TypeError("snapshot must be a plain object.");
  }

  const diagnostics = [];
  const roles = normalizeRoles(snapshot.roles, diagnostics);
  const roleNamesById = new Map(roles.map((role) => [role.id, role.name]));
  const rawChannels = flatObjects(snapshot.channels);
  const explicitCategories = flatObjects(snapshot.categories);
  const categoriesFoundInChannels = rawChannels.filter(
    (channel) => canonicalChannelType(channel).type === "category",
  );
  const rawCategories = uniqueResources(
    [...explicitCategories, ...categoriesFoundInChannels],
    "category",
    diagnostics,
  );
  const categories = rawCategories
    .map((category) => normalizeCategory(category, diagnostics, roleNamesById))
    .sort((left, right) => (
      left.position - right.position
      || compareSnowflakes(left.id, right.id)
    ));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const categoryIds = new Set(categories.map((category) => category.id));
  const nonCategoryChannels = rawChannels.filter((channel) => (
    canonicalChannelType(channel).type !== "category"
    && !categoryIds.has(snowflake(channel.id, "channel.id"))
  ));
  const channels = uniqueResources(nonCategoryChannels, "channel", diagnostics)
    .map((channel) => normalizeChannel(
      channel,
      diagnostics,
      roleNamesById,
      categoriesById,
    ))
    .sort((left, right) => {
      const leftParentPosition = left.parent === null
        ? Number.MAX_SAFE_INTEGER
        : categoriesById.get(left.parent.id)?.position ?? Number.MAX_SAFE_INTEGER - 1;
      const rightParentPosition = right.parent === null
        ? Number.MAX_SAFE_INTEGER
        : categoriesById.get(right.parent.id)?.position ?? Number.MAX_SAFE_INTEGER - 1;

      return leftParentPosition - rightParentPosition
        || left.position - right.position
        || compareSnowflakes(left.id, right.id);
    });
  const channelCounts = new Map();

  for (const channel of channels) {
    channelCounts.set(channel.type, (channelCounts.get(channel.type) ?? 0) + 1);
  }

  const overwriteCount = [...categories, ...channels].reduce(
    (total, resource) => total + resource.permissionOverwrites.length,
    0,
  );
  const forumTagCount = channels.reduce(
    (total, channel) => total + (channel.forum?.availableTags.length ?? 0),
    0,
  );
  const guild = isRecord(snapshot.guild) ? snapshot.guild : {};
  const generatedAt = options.generatedAt
    ?? snapshot.generatedAt
    ?? new Date();

  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    metadata: {
      generatedAt: normalizedGeneratedAt(generatedAt),
      generator: {
        name: String(options.generatorName ?? "sancathon-discord-infrastructure"),
        version: String(options.generatorVersion ?? "1.0.0"),
      },
      discordJsVersion: nullableString(
        options.discordJsVersion ?? snapshot.discordJsVersion,
      ),
    },
    guild: {
      id: snowflake(guild.id, "guild.id"),
      name: nullableString(guild.name),
      ownerId: snowflake(guild.ownerId, "guild.ownerId"),
      everyoneRoleId: snowflake(
        guild.everyoneRoleId ?? guild.id,
        "guild.everyoneRoleId",
      ),
      publicUpdatesChannelId: snowflake(
        guild.publicUpdatesChannelId,
        "guild.publicUpdatesChannelId",
      ),
      features: [...new Set(flatValues(guild.features).map(String))].sort(compareText),
    },
    bot: normalizeBot(snapshot.botMember, diagnostics),
    summary: {
      roleCount: roles.length,
      categoryCount: categories.length,
      channelCount: channels.length,
      overwriteCount,
      unsyncedChannelCount: channels.filter(
        (channel) => channel.permissionsSyncedWithParent === false,
      ).length,
      forumTagCount,
      channelCountsByType: Object.fromEntries(
        [...channelCounts.entries()].sort(([left], [right]) => compareText(left, right)),
      ),
    },
    roles,
    categories,
    channels,
    diagnostics: sortDiagnostics(diagnostics),
  };
}

export const buildAuditReport = buildReport;

export default buildReport;
