const CHANNEL_TYPE_LABELS = new Map([
  ["text", "TEXT"],
  ["voice", "VOICE"],
  ["category", "CATEGORY"],
  ["announcement", "ANNOUNCEMENT"],
  ["announcement-thread", "ANNOUNCEMENT THREAD"],
  ["public-thread", "PUBLIC THREAD"],
  ["private-thread", "PRIVATE THREAD"],
  ["stage", "STAGE"],
  ["forum", "FORUM"],
  ["media", "MEDIA"],
  ["unknown", "UNKNOWN"],
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flatObjects(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flat(Infinity).filter(isRecord);
}

function escapeMarkdown(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("`", "\\`")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replace(/\r?\n/g, "<br>");
}

function code(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return `\`${String(value).replaceAll("`", "\\`")}\``;
}

function yesNo(value) {
  if (value === null || value === undefined) {
    return "—";
  }

  return value ? "sim" : "não";
}

function displayInteger(value) {
  return Number.isInteger(value) ? String(value) : "—";
}

function displayType(channel) {
  const label = CHANNEL_TYPE_LABELS.get(channel?.type)
    ?? String(channel?.type ?? "UNKNOWN").toUpperCase();

  return channel?.typeCode === null || channel?.typeCode === undefined
    ? label
    : `${label} (${channel.typeCode})`;
}

function displayPermissionSet(permissionSet) {
  if (!isRecord(permissionSet)) {
    return "nenhuma";
  }

  const names = Array.isArray(permissionSet.names)
    ? permissionSet.names.flat(Infinity).map(escapeMarkdown)
    : [];
  const unknownBitfield = String(permissionSet.unknownBitfield ?? "0");

  if (unknownBitfield !== "0") {
    names.push(`UNKNOWN_BITS:${escapeMarkdown(unknownBitfield)}`);
  }

  return names.length > 0 ? names.join(", ") : "nenhuma";
}

function displayEmoji(emoji) {
  if (!isRecord(emoji)) {
    return "—";
  }

  const name = emoji.name === null || emoji.name === undefined
    ? null
    : escapeMarkdown(emoji.name);
  const id = emoji.id === null || emoji.id === undefined
    ? null
    : code(emoji.id);

  return [name, id].filter(Boolean).join(" ") || "—";
}

function displayTarget(overwrite) {
  const target = isRecord(overwrite?.target) ? overwrite.target : {};
  const name = target.name === null || target.name === undefined
    ? "alvo não resolvido"
    : escapeMarkdown(target.name);
  const id = target.id === null || target.id === undefined
    ? ""
    : ` (${code(target.id)})`;

  return `${name}${id}`;
}

function pushOverwriteSection(lines, title, overwrites, headingLevel) {
  lines.push(`${"#".repeat(headingLevel)} ${title}`, "");

  const normalizedOverwrites = flatObjects(overwrites);
  if (normalizedOverwrites.length === 0) {
    lines.push("Nenhum overwrite explícito.", "");
    return;
  }

  lines.push(
    "| Alvo | Tipo | Allow | Deny |",
    "| --- | --- | --- | --- |",
  );

  for (const overwrite of normalizedOverwrites) {
    lines.push([
      `| ${displayTarget(overwrite)}`,
      escapeMarkdown(overwrite.target?.type ?? "unknown"),
      displayPermissionSet(overwrite.allow),
      `${displayPermissionSet(overwrite.deny)} |`,
    ].join(" | "));
  }

  lines.push("");
}

function pushForumSection(lines, forum, headingLevel) {
  if (!isRecord(forum)) {
    return;
  }

  lines.push(`${"#".repeat(headingLevel)} Configuração do fórum`, "");
  lines.push(
    "| Campo | Valor |",
    "| --- | --- |",
    `| Exigir tag | ${yesNo(forum.requireTag)} |`,
    `| Slowmode das threads | ${displayInteger(forum.defaultThreadSlowmodeSeconds)} s |`,
    `| Ordenação padrão | ${escapeMarkdown(forum.defaultSortOrder)} |`,
    `| Layout padrão | ${escapeMarkdown(forum.defaultLayout)} |`,
    `| Reação padrão | ${displayEmoji(forum.defaultReactionEmoji)} |`,
    "",
    `${"#".repeat(headingLevel)} Tags disponíveis`,
    "",
  );

  const tags = flatObjects(forum.availableTags);
  if (tags.length === 0) {
    lines.push("Nenhuma tag configurada.", "");
    return;
  }

  lines.push(
    "| Tag | ID | Moderada | Emoji |",
    "| --- | --- | --- | --- |",
  );

  for (const tag of tags) {
    lines.push(
      `| ${escapeMarkdown(tag.name)} | ${code(tag.id)} | ${yesNo(tag.moderated)} | ${displayEmoji(tag.emoji)} |`,
    );
  }

  lines.push("");
}

function pushVoiceSection(lines, voice, headingLevel) {
  if (!isRecord(voice)) {
    return;
  }

  lines.push(
    `${"#".repeat(headingLevel)} Configuração de voz`,
    "",
    "| Campo | Valor |",
    "| --- | --- |",
    `| Bitrate | ${voice.bitrate === null ? "—" : `${displayInteger(voice.bitrate)} bps`} |`,
    `| Limite de usuários | ${displayInteger(voice.userLimit)} |`,
    `| Região RTC | ${escapeMarkdown(voice.rtcRegion)} |`,
    `| Qualidade de vídeo | ${escapeMarkdown(voice.videoQualityMode)} |`,
    "",
  );
}

function pushChannel(lines, channel, headingLevel = 4) {
  const prefix = ["voice", "stage"].includes(channel.type) ? "🔊 " : "#";
  lines.push(
    `${"#".repeat(headingLevel)} ${prefix}${escapeMarkdown(channel.name)}`,
    "",
    "| Campo | Valor |",
    "| --- | --- |",
    `| ID | ${code(channel.id)} |`,
    `| Tipo | ${escapeMarkdown(displayType(channel))} |`,
    `| Posição | ${displayInteger(channel.position)} |`,
    `| Categoria | ${channel.parent === null ? "—" : `${escapeMarkdown(channel.parent?.name)} (${code(channel.parent?.id)})`} |`,
    `| Slowmode | ${displayInteger(channel.slowmodeSeconds)} s |`,
    `| NSFW | ${yesNo(channel.nsfw)} |`,
    `| Sincronizado com categoria | ${yesNo(channel.permissionsSyncedWithParent)} |`,
    `| Tópico | ${escapeMarkdown(channel.topic)} |`,
    "",
  );

  pushOverwriteSection(
    lines,
    "Permission overwrites",
    channel.permissionOverwrites,
    Math.min(headingLevel + 1, 6),
  );
  pushForumSection(lines, channel.forum, Math.min(headingLevel + 1, 6));
  pushVoiceSection(lines, channel.voice, Math.min(headingLevel + 1, 6));
}

function pushCategory(lines, category, channels) {
  lines.push(
    `### ${escapeMarkdown(category.name)}`,
    "",
    "| Campo | Valor |",
    "| --- | --- |",
    `| ID | ${code(category.id)} |`,
    `| Posição | ${displayInteger(category.position)} |`,
    `| NSFW | ${yesNo(category.nsfw)} |`,
    "",
  );

  pushOverwriteSection(
    lines,
    "Permission overwrites da categoria",
    category.permissionOverwrites,
    4,
  );

  const childChannels = channels.filter(
    (channel) => channel.parent?.id === category.id,
  );

  if (childChannels.length === 0) {
    lines.push("_Nenhum canal nesta categoria._", "");
    return;
  }

  for (const channel of childChannels) {
    pushChannel(lines, channel, 4);
  }
}

function pushRoles(lines, roles) {
  lines.push("## Cargos", "");

  if (roles.length === 0) {
    lines.push("Nenhum cargo encontrado.", "");
    return;
  }

  lines.push(
    "| Posição | Cargo | ID | Cor | Hoist | Mencionável | Gerenciado | Permissões |",
    "| ---: | --- | --- | --- | --- | --- | --- | ---: |",
  );

  for (const role of roles) {
    lines.push([
      `| ${displayInteger(role.position)}`,
      escapeMarkdown(role.name),
      code(role.id),
      escapeMarkdown(role.color?.hex),
      yesNo(role.hoist),
      yesNo(role.mentionable),
      yesNo(role.managed),
      `${Array.isArray(role.permissions?.names) ? role.permissions.names.length : 0} |`,
    ].join(" | "));
  }

  lines.push("", "### Permissões detalhadas", "");

  for (const role of roles) {
    lines.push(
      `- **${escapeMarkdown(role.name)}** — bitfield ${code(role.permissions?.bitfield ?? "0")}: ${displayPermissionSet(role.permissions)}`,
    );
  }

  lines.push("");
}

function pushBot(lines, bot) {
  if (!isRecord(bot)) {
    return;
  }

  lines.push(
    "## Bot executor",
    "",
    "| Campo | Valor |",
    "| --- | --- |",
    `| ID | ${code(bot.id)} |`,
    `| Maior cargo | ${code(bot.highestRoleId)} |`,
    `| Posição do maior cargo | ${displayInteger(bot.highestRolePosition)} |`,
    `| Cargos atribuídos | ${Array.isArray(bot.roleIds) ? bot.roleIds.map(code).join(", ") || "—" : "—"} |`,
    `| Permissões | ${displayPermissionSet(bot.permissions)} |`,
    "",
  );
}

function pushDiagnostics(lines, diagnostics) {
  lines.push("## Diagnósticos", "");

  if (diagnostics.length === 0) {
    lines.push("Nenhum diagnóstico de auditoria.", "");
    return;
  }

  for (const diagnostic of diagnostics) {
    const resource = diagnostic.resource
      ? ` — ${escapeMarkdown(diagnostic.resource.type)} ${escapeMarkdown(diagnostic.resource.name)} (${code(diagnostic.resource.id)})`
      : "";

    lines.push(
      `- **${escapeMarkdown(String(diagnostic.severity ?? "warning").toUpperCase())} ${escapeMarkdown(diagnostic.code)}**${resource}: ${escapeMarkdown(diagnostic.message)}`,
    );
  }

  lines.push("");
}

/**
 * Renders the allowlisted audit report fields as human-reviewable Markdown.
 */
export function renderMarkdown(report) {
  if (!isRecord(report)) {
    throw new TypeError("report must be an object produced by buildReport().");
  }

  const guild = isRecord(report.guild) ? report.guild : {};
  const metadata = isRecord(report.metadata) ? report.metadata : {};
  const summary = isRecord(report.summary) ? report.summary : {};
  const roles = flatObjects(report.roles);
  const categories = flatObjects(report.categories);
  const channels = flatObjects(report.channels);
  const diagnostics = flatObjects(report.diagnostics);
  const lines = [
    `# Auditoria do Discord — ${escapeMarkdown(guild.name ?? "Servidor sem nome")}`,
    "",
    `Gerado em ${code(metadata.generatedAt)}. Schema ${code(report.schemaVersion ?? "desconhecido")}.`,
    "",
    "## Resumo",
    "",
    "| Recurso | Quantidade |",
    "| --- | ---: |",
    `| Cargos | ${displayInteger(summary.roleCount)} |`,
    `| Categorias | ${displayInteger(summary.categoryCount)} |`,
    `| Canais | ${displayInteger(summary.channelCount)} |`,
    `| Permission overwrites | ${displayInteger(summary.overwriteCount)} |`,
    `| Canais não sincronizados | ${displayInteger(summary.unsyncedChannelCount)} |`,
    `| Tags de fórum | ${displayInteger(summary.forumTagCount)} |`,
    "",
  ];

  const countsByType = isRecord(summary.channelCountsByType)
    ? Object.entries(summary.channelCountsByType)
    : [];

  if (countsByType.length > 0) {
    lines.push(
      "### Canais por tipo",
      "",
      "| Tipo | Quantidade |",
      "| --- | ---: |",
    );

    for (const [type, count] of countsByType) {
      lines.push(`| ${escapeMarkdown(type)} | ${displayInteger(count)} |`);
    }

    lines.push("");
  }

  lines.push(
    "## Servidor",
    "",
    "| Campo | Valor |",
    "| --- | --- |",
    `| ID | ${code(guild.id)} |`,
    `| Proprietário | ${code(guild.ownerId)} |`,
    `| Cargo @everyone | ${code(guild.everyoneRoleId)} |`,
    `| Canal de atualizações da comunidade | ${code(guild.publicUpdatesChannelId)} |`,
    `| Features | ${Array.isArray(guild.features) ? guild.features.map(escapeMarkdown).join(", ") || "—" : "—"} |`,
    "",
  );

  pushBot(lines, report.bot);
  pushRoles(lines, roles);

  lines.push("## Categorias e canais", "");
  if (categories.length === 0) {
    lines.push("Nenhuma categoria encontrada.", "");
  } else {
    for (const category of categories) {
      pushCategory(lines, category, channels);
    }
  }

  const knownCategoryIds = new Set(categories.map((category) => category.id));
  const ungroupedChannels = channels.filter((channel) => (
    channel.parent === null || !knownCategoryIds.has(channel.parent?.id)
  ));

  lines.push("## Canais sem categoria ou com parent não resolvido", "");
  if (ungroupedChannels.length === 0) {
    lines.push("Nenhum.", "");
  } else {
    for (const channel of ungroupedChannels) {
      pushChannel(lines, channel, 3);
    }
  }

  pushDiagnostics(lines, diagnostics);

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export const renderAuditMarkdown = renderMarkdown;

export default renderMarkdown;
