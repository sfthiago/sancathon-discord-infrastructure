import { ChannelType } from "discord.js";
import {
  colorToNumber,
  permissionNames,
} from "../utils/permissions.js";
import { normalizeName } from "../utils/names.js";

const allowedChannelTypes = new Set([
  "GuildCategory",
  "GuildText",
  "GuildForum",
  "GuildVoice",
  "GuildStageVoice",
]);

function diagnostic(severity, code, path, message) {
  return { severity, code, path, message };
}

function duplicateValues(items, selector) {
  const grouped = new Map();
  for (const item of items) {
    const value = selector(item);
    grouped.set(value, [...(grouped.get(value) ?? []), item]);
  }
  return [...grouped].filter(([, matches]) => matches.length > 1);
}

function validateOverwriteList({ list = [], path, roleKeys, diagnostics }) {
  for (const [, duplicates] of duplicateValues(list, (item) => item.target)) {
    diagnostics.push(
      diagnostic(
        "error",
        "DUPLICATE_OVERWRITE_TARGET",
        path,
        `Target ${duplicates[0].target} aparece mais de uma vez.`,
      ),
    );
  }

  for (const overwrite of list) {
    if (!roleKeys.has(overwrite.target)) {
      diagnostics.push(
        diagnostic(
          "error",
          "UNKNOWN_OVERWRITE_ROLE",
          `${path}.${overwrite.target}`,
          `Overwrite referencia cargo inexistente: ${overwrite.target}.`,
        ),
      );
    }
    const allow = new Set(overwrite.allow ?? []);
    const deny = new Set(overwrite.deny ?? []);
    for (const permission of [...allow, ...deny]) {
      if (!permissionNames.has(permission)) {
        diagnostics.push(
          diagnostic(
            "error",
            "UNKNOWN_PERMISSION",
            `${path}.${overwrite.target}`,
            `Permissao desconhecida: ${permission}.`,
          ),
        );
      }
      if (allow.has(permission) && deny.has(permission)) {
        diagnostics.push(
          diagnostic(
            "error",
            "OVERWRITE_ALLOW_DENY_CONFLICT",
            `${path}.${overwrite.target}.${permission}`,
            `${permission} aparece em allow e deny.`,
          ),
        );
      }
    }
  }
}

export function validateConfig(config) {
  const diagnostics = [];
  const roles = config.roles.roles;
  const categories = config.channels.categories;
  const channels = config.channels.channels.filter(
    (channel) => channel.enabled !== false,
  );
  const roleKeys = new Set(roles.map((role) => role.key));
  const categoryKeys = new Set(categories.map((category) => category.key));

  for (const setting of ["stageEnabled", "eventCategoryVisibleToParticipants"]) {
    if (typeof config.server.features?.[setting] !== "boolean") {
      diagnostics.push(
        diagnostic(
          "error",
          "INVALID_FEATURE_FLAG",
          `server.features.${setting}`,
          `${setting} deve ser booleano.`,
        ),
      );
    }
  }

  for (const setting of [
    "deleteRoles",
    "deleteChannels",
    "deleteCategories",
    "deleteMembers",
  ]) {
    if (config.server.safety?.[setting] === true) {
      diagnostics.push(
        diagnostic(
          "error",
          "DESTRUCTIVE_MODE_UNSUPPORTED",
          `server.safety.${setting}`,
          `${setting} nao e suportado nesta versao nao destrutiva.`,
        ),
      );
    }
  }

  for (const [type, items] of [
    ["role", roles],
    ["category", categories],
    ["channel", channels],
  ]) {
    for (const [key, duplicates] of duplicateValues(items, (item) => item.key)) {
      diagnostics.push(
        diagnostic(
          "error",
          "DUPLICATE_KEY",
          `${type}.${key}`,
          `Key duplicada em ${type}: ${duplicates[0].key}.`,
        ),
      );
    }
  }

  for (const role of roles) {
    if (!role.name || role.name.length > 100) {
      diagnostics.push(
        diagnostic(
          "error",
          "INVALID_ROLE_NAME",
          `roles.${role.key}.name`,
          `Nome de cargo deve conter entre 1 e 100 caracteres.`,
        ),
      );
    }
    try {
      colorToNumber(role.color);
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "error",
          "INVALID_ROLE_COLOR",
          `roles.${role.key}.color`,
          error.message,
        ),
      );
    }
    for (const permission of role.permissions ?? []) {
      if (!permissionNames.has(permission)) {
        diagnostics.push(
          diagnostic(
            "error",
            "UNKNOWN_PERMISSION",
            `roles.${role.key}.permissions`,
            `Permissao desconhecida: ${permission}.`,
          ),
        );
      }
    }
  }

  const hierarchy = config.roles.hierarchy ?? [];
  const standardRoleKeys = roles
    .filter((role) => role.kind !== "default")
    .map((role) => role.key);
  for (const key of hierarchy) {
    if (!roleKeys.has(key)) {
      diagnostics.push(
        diagnostic(
          "error",
          "UNKNOWN_HIERARCHY_ROLE",
          "roles.hierarchy",
          `Hierarquia referencia cargo inexistente: ${key}.`,
        ),
      );
    }
  }
  for (const [key] of duplicateValues(hierarchy, (item) => item)) {
    diagnostics.push(
      diagnostic(
        "error",
        "DUPLICATE_HIERARCHY_ROLE",
        "roles.hierarchy",
        `Cargo repetido na hierarquia: ${key}.`,
      ),
    );
  }

  const defaultRoles = roles.filter((role) => role.kind === "default");
  if (
    defaultRoles.length !== 1 ||
    defaultRoles[0]?.key !== "everyone" ||
    defaultRoles[0]?.name !== "@everyone"
  ) {
    diagnostics.push(
      diagnostic(
        "error",
        "INVALID_EVERYONE_ROLE",
        "roles.everyone",
        "Defina exatamente um cargo default com key everyone e nome @everyone.",
      ),
    );
  }

  for (const [name] of duplicateValues(
    roles,
    (role) => normalizeName(role.name),
  )) {
    diagnostics.push(
      diagnostic(
        "error",
        "DUPLICATE_ROLE_NAME",
        "roles",
        `Nome canonico de cargo duplicado: ${name}.`,
      ),
    );
  }
  for (const key of standardRoleKeys) {
    if (!hierarchy.includes(key)) {
      diagnostics.push(
        diagnostic(
          "error",
          "ROLE_MISSING_FROM_HIERARCHY",
          `roles.${key}`,
          `Cargo ${key} nao aparece na hierarquia.`,
        ),
      );
    }
  }

  const prohibited = {
    organization: ["Administrator", "ManageGuild", "BanMembers", "ManageWebhooks"],
    moderation: [
      "Administrator",
      "ManageGuild",
      "ManageChannels",
      "ManageRoles",
      "MentionEveryone",
      "ManageWebhooks",
    ],
  };
  for (const [roleKey, forbiddenPermissions] of Object.entries(prohibited)) {
    const role = roles.find((candidate) => candidate.key === roleKey);
    for (const permission of forbiddenPermissions) {
      if (role?.permissions.includes(permission)) {
        diagnostics.push(
          diagnostic(
            "error",
            "FORBIDDEN_ROLE_PERMISSION",
            `roles.${roleKey}.permissions`,
            `${role.name} nao deve possuir ${permission}.`,
          ),
        );
      }
    }
  }

  for (const roleKey of ["mentor", "speaker", "judge", "teamLead", "participant"]) {
    const role = roles.find((candidate) => candidate.key === roleKey);
    for (const permission of ["Administrator", "ViewChannel"]) {
      if (role?.permissions.includes(permission)) {
        diagnostics.push(
          diagnostic(
            "error",
            "UNSAFE_COMMON_ROLE_PERMISSION",
            `roles.${roleKey}.permissions`,
            `${role.name} nao deve possuir ${permission} globalmente.`,
          ),
        );
      }
    }
  }

  for (const category of categories) {
    if (!category.name || category.name.length > 100) {
      diagnostics.push(
        diagnostic(
          "error",
          "INVALID_CATEGORY_NAME",
          `categories.${category.key}.name`,
          `Nome de categoria deve conter entre 1 e 100 caracteres.`,
        ),
      );
    }
    if (category.type !== "GuildCategory") {
      diagnostics.push(
        diagnostic(
          "error",
          "INVALID_CATEGORY_TYPE",
          `categories.${category.key}.type`,
          `${category.name} deve usar GuildCategory.`,
        ),
      );
    }
    validateOverwriteList({
      list: category.overwrites,
      path: `categories.${category.key}.overwrites`,
      roleKeys,
      diagnostics,
    });
  }

  for (const [name] of duplicateValues(
    categories,
    (category) => normalizeName(category.name),
  )) {
    diagnostics.push(
      diagnostic(
        "error",
        "DUPLICATE_CATEGORY_NAME",
        "categories",
        `Nome canonico de categoria duplicado: ${name}.`,
      ),
    );
  }

  for (const channel of channels) {
    if (!channel.name || channel.name.length > 100) {
      diagnostics.push(
        diagnostic(
          "error",
          "INVALID_CHANNEL_NAME",
          `channels.${channel.key}.name`,
          `Nome de canal deve conter entre 1 e 100 caracteres.`,
        ),
      );
    }
    if (!allowedChannelTypes.has(channel.type) || ChannelType[channel.type] === undefined) {
      diagnostics.push(
        diagnostic(
          "error",
          "INVALID_CHANNEL_TYPE",
          `channels.${channel.key}.type`,
          `Tipo de canal invalido: ${channel.type}.`,
        ),
      );
    }
    if (!categoryKeys.has(channel.categoryKey)) {
      diagnostics.push(
        diagnostic(
          "error",
          "UNKNOWN_CHANNEL_CATEGORY",
          `channels.${channel.key}.categoryKey`,
          `${channel.name} referencia categoria inexistente: ${channel.categoryKey}.`,
        ),
      );
    }
    if (channel.teamKey && !roleKeys.has(channel.teamKey)) {
      diagnostics.push(
        diagnostic(
          "error",
          "UNKNOWN_TEAM_ROLE",
          `channels.${channel.key}.teamKey`,
          `${channel.name} referencia cargo de equipe inexistente.`,
        ),
      );
    }
    if (
      channel.slowmode !== undefined &&
      !["GuildText", "GuildForum"].includes(channel.type)
    ) {
      diagnostics.push(
        diagnostic(
          "error",
          "SLOWMODE_UNSUPPORTED",
          `channels.${channel.key}.slowmode`,
          `Slowmode nao e suportado pelo tipo ${channel.type} nesta configuracao.`,
        ),
      );
    }
    if (
      channel.slowmode !== undefined &&
      (!Number.isInteger(channel.slowmode) ||
        channel.slowmode < 0 ||
        channel.slowmode > 21_600)
    ) {
      diagnostics.push(
        diagnostic(
          "error",
          "INVALID_SLOWMODE",
          `channels.${channel.key}.slowmode`,
          `Slowmode deve ser um inteiro entre 0 e 21600 segundos.`,
        ),
      );
    }
    if (channel.availableTags && channel.type !== "GuildForum") {
      diagnostics.push(
        diagnostic(
          "error",
          "TAGS_OUTSIDE_FORUM",
          `channels.${channel.key}.availableTags`,
          `Tags so podem ser configuradas em forum.`,
        ),
      );
    }
    if ((channel.availableTags?.length ?? 0) > 20) {
      diagnostics.push(
        diagnostic(
          "error",
          "TOO_MANY_FORUM_TAGS",
          `channels.${channel.key}.availableTags`,
          `Forum excede o limite de 20 tags.`,
        ),
      );
    }
    for (const [tagName] of duplicateValues(
      channel.availableTags ?? [],
      (tag) => normalizeName(tag.name),
    )) {
      diagnostics.push(
        diagnostic(
          "error",
          "DUPLICATE_FORUM_TAG",
          `channels.${channel.key}.availableTags`,
          `Tag de forum duplicada: ${tagName}.`,
        ),
      );
    }
    for (const [tagKey] of duplicateValues(
      channel.availableTags ?? [],
      (tag) => tag.key,
    )) {
      diagnostics.push(
        diagnostic(
          "error",
          "DUPLICATE_FORUM_TAG_KEY",
          `channels.${channel.key}.availableTags`,
          `Key de tag de forum duplicada: ${tagKey}.`,
        ),
      );
    }
    for (const tag of channel.availableTags ?? []) {
      if (!tag.name || tag.name.length > 20) {
        diagnostics.push(
          diagnostic(
            "error",
            "INVALID_FORUM_TAG_NAME",
            `channels.${channel.key}.availableTags.${tag.key}`,
            `Nome de tag deve conter entre 1 e 20 caracteres.`,
          ),
        );
      }
    }
    validateOverwriteList({
      list: channel.overwrites,
      path: `channels.${channel.key}.overwrites`,
      roleKeys,
      diagnostics,
    });
  }

  for (const category of categories) {
    const childCount = channels.filter(
      (channel) => channel.categoryKey === category.key,
    ).length;
    if (childCount > 50) {
      diagnostics.push(
        diagnostic(
          "error",
          "TOO_MANY_CATEGORY_CHANNELS",
          `categories.${category.key}`,
          `${category.name} possui ${childCount} canais; o limite e 50.`,
        ),
      );
    }
  }

  const teams = config.server.teams ?? [];
  for (const [number] of duplicateValues(teams, (team) => team.number)) {
    diagnostics.push(
      diagnostic(
        "error",
        "DUPLICATE_TEAM_NUMBER",
        "server.teams",
        `Numero de equipe duplicado: ${number}.`,
      ),
    );
  }
  for (const [key] of duplicateValues(teams, (team) => team.key)) {
    diagnostics.push(
      diagnostic(
        "error",
        "DUPLICATE_TEAM_KEY",
        "server.teams",
        `Key de equipe duplicada: ${key}.`,
      ),
    );
  }
  for (const team of teams) {
    if (!Number.isInteger(team.number) || team.number < 1 || team.number > 99) {
      diagnostics.push(
        diagnostic(
          "error",
          "INVALID_TEAM_NUMBER",
          `server.teams.${team.key}.number`,
          `Numero de equipe deve ser um inteiro entre 1 e 99.`,
        ),
      );
    }
    if (!roleKeys.has(team.roleKey)) {
      diagnostics.push(
        diagnostic(
          "error",
          "UNKNOWN_TEAM_ROLE",
          `server.teams.${team.key}.roleKey`,
          `Equipe ${team.number} referencia cargo inexistente: ${team.roleKey}.`,
        ),
      );
    }
  }

  for (const [signature, duplicates] of duplicateValues(
    channels,
    (channel) =>
      `${channel.categoryKey}:${channel.type}:${normalizeName(channel.name)}`,
  )) {
    diagnostics.push(
      diagnostic(
        "error",
        "DUPLICATE_CHANNEL",
        "channels",
        `Canal duplicado na configuracao: ${signature} (${duplicates.length}).`,
      ),
    );
  }

  const start = categories.find((category) => category.key === "start");
  const everyoneStart = start?.overwrites.find(
    (overwrite) => overwrite.target === "everyone",
  );
  if (everyoneStart?.allow.includes("SendMessages")) {
    diagnostics.push(
      diagnostic(
        "warning",
        "PUBLIC_START_CAN_SEND",
        "categories.start.overwrites.everyone",
        "@everyone pode enviar mensagens em COMECE AQUI.",
      ),
    );
  }

  const teamsCategory = categories.find((category) => category.key === "teams");
  const judgeTeams = teamsCategory?.overwrites.find(
    (overwrite) => overwrite.target === "judge",
  );
  if (judgeTeams?.allow.includes("ViewChannel")) {
    diagnostics.push(
      diagnostic(
        "warning",
        "JUDGE_CAN_VIEW_TEAMS",
        "categories.teams.overwrites.judge",
        "Jurado consegue visualizar a categoria EQUIPES.",
      ),
    );
  }

  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    diagnostics,
  };
}
