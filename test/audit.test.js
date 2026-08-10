import assert from "node:assert/strict";
import test from "node:test";

import { PermissionFlagsBits } from "discord.js";

import { buildReport } from "../src/audit/build-report.js";
import { renderMarkdown } from "../src/audit/render-markdown.js";

const SECRET_SENTINEL = "SENTINEL_TOKEN_MUST_NOT_LEAK";

function auditSnapshot() {
  const guildId = "900000000000000001";
  const participantId = "900000000000000002";
  const organizationId = "900000000000000003";
  const categoryId = "900000000000000010";
  const categoryOverwrites = [
    {
      id: guildId,
      type: 0,
      targetType: "role",
      targetName: "@everyone",
      allow: "1024",
      deny: "2048",
    },
    {
      id: participantId,
      type: 0,
      targetType: "role",
      targetName: "Participante",
      allow: "1024",
      deny: "0",
    },
  ];
  const unknownBit = 1n << 62n;

  return {
    token: SECRET_SENTINEL,
    authorization: `Bot ${SECRET_SENTINEL}`,
    raw: { token: SECRET_SENTINEL },
    guild: {
      id: guildId,
      name: "Sancathon | Auditoria",
      ownerId: "900000000000000099",
      publicUpdatesChannelId: "900000000000000020",
      features: ["NEWS", "COMMUNITY"],
      token: SECRET_SENTINEL,
    },
    botMember: {
      id: "900000000000000090",
      roleIds: [organizationId],
      highestRoleId: organizationId,
      highestRolePosition: 2,
      permissions: PermissionFlagsBits.ManageChannels.toString(),
      client: { token: SECRET_SENTINEL },
    },
    roles: [[
      {
        id: guildId,
        name: "@everyone",
        position: 0,
        colors: { primaryColor: 0 },
        permissions: "0",
      },
      {
        id: participantId,
        name: "Participante",
        position: 1,
        colors: { primaryColor: 0 },
        permissions: (
          PermissionFlagsBits.SendMessages | unknownBit
        ).toString(),
      },
      {
        id: organizationId,
        name: "Organização",
        position: 2,
        colors: { primaryColor: 0x245a9c },
        permissions: PermissionFlagsBits.ManageChannels.toString(),
        hoist: true,
      },
    ]],
    categories: [[{
      id: categoryId,
      name: "📌 COMECE AQUI",
      type: 4,
      typeName: "GuildCategory",
      position: 1,
      permissionOverwrites: categoryOverwrites,
    }]],
    channels: [[
      {
        id: "900000000000000011",
        name: "dúvidas | treinamentos",
        type: 15,
        typeName: "GuildForum",
        parentId: categoryId,
        position: 1,
        topic: "Perguntas\ne respostas",
        rateLimitPerUser: 5,
        defaultThreadRateLimitPerUser: 7,
        permissionsLocked: true,
        flags: "16",
        permissionOverwrites: [...categoryOverwrites].reverse(),
        availableTags: [
          {
            id: "900000000000000032",
            name: "Zeta",
            moderated: false,
            emoji: { id: null, name: "🔧" },
          },
          {
            id: "900000000000000031",
            name: "Alpha",
            moderated: true,
            emoji: { id: null, name: "🧭" },
          },
        ],
      },
      {
        id: "900000000000000012",
        name: "sala",
        type: 2,
        typeName: "GuildVoice",
        parentId: categoryId,
        position: 2,
        bitrate: 64000,
        userLimit: 10,
        rtcRegion: null,
        videoQualityMode: 1,
        permissionsLocked: false,
        permissionOverwrites: [],
      },
      {
        id: "900000000000000013",
        name: "sem-categoria",
        type: 0,
        typeName: "GuildText",
        parentId: null,
        position: 3,
        rateLimitPerUser: 0,
        permissionsLocked: null,
        permissionOverwrites: [],
      },
    ]],
  };
}

const reportOptions = Object.freeze({
  generatedAt: "2026-08-09T12:00:00Z",
  discordJsVersion: "14.27.0",
  generatorVersion: "test",
});

test("audit report is flat, JSON-safe and allowlists snapshot fields", () => {
  const report = buildReport(auditSnapshot(), reportOptions);
  const serialized = JSON.stringify(report);

  assert.equal(report.roles.length, 3);
  assert.equal(report.categories.length, 1);
  assert.equal(report.channels.length, 3);
  assert.equal(Array.isArray(report.roles[0]), false);
  assert.equal(Array.isArray(report.channels[0]), false);
  assert.equal(report.guild.id, "900000000000000001");
  assert.equal(typeof report.roles[0].permissions.bitfield, "string");
  assert.equal(serialized.includes(SECRET_SENTINEL), false);
  assert.equal(serialized.includes("authorization"), false);
  assert.equal(serialized.includes("lastMessageId"), false);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test("audit report ordering is deterministic for shuffled resource input", () => {
  const leftSnapshot = auditSnapshot();
  const rightSnapshot = auditSnapshot();
  rightSnapshot.roles[0].reverse();
  rightSnapshot.categories[0].reverse();
  rightSnapshot.channels[0].reverse();
  rightSnapshot.guild.features.reverse();

  assert.deepEqual(
    buildReport(leftSnapshot, reportOptions),
    buildReport(rightSnapshot, reportOptions),
  );
});

test("audit reports hierarchy, colors, permission names and unknown bits", () => {
  const report = buildReport(auditSnapshot(), reportOptions);
  const [organization, participant, everyone] = report.roles;

  assert.equal(organization.name, "Organização");
  assert.equal(organization.position, 2);
  assert.deepEqual(organization.color, {
    value: 0x245a9c,
    hex: "#245A9C",
  });
  assert.ok(organization.permissions.names.includes("ManageChannels"));
  assert.equal(participant.permissions.unknownBitfield, (1n << 62n).toString());
  assert.equal(everyone.name, "@everyone");
  assert.ok(
    report.diagnostics.some((item) => item.code === "UNKNOWN_PERMISSION_BITS"),
  );
});

test("audit includes parent, slowmode, synchronization, forum tags and voice settings", () => {
  const report = buildReport(auditSnapshot(), reportOptions);
  const forum = report.channels.find((channel) => channel.type === "forum");
  const voice = report.channels.find((channel) => channel.type === "voice");
  const unparented = report.channels.find((channel) => channel.parent === null);

  assert.deepEqual(forum.parent, {
    id: "900000000000000010",
    name: "📌 COMECE AQUI",
  });
  assert.equal(forum.slowmodeSeconds, 5);
  assert.equal(forum.permissionsSyncedWithParent, true);
  assert.equal(forum.forum.defaultThreadSlowmodeSeconds, 7);
  assert.equal(forum.forum.requireTag, true);
  assert.deepEqual(
    forum.forum.availableTags.map((tag) => tag.name),
    ["Alpha", "Zeta"],
  );
  assert.deepEqual(voice.voice, {
    bitrate: 64000,
    userLimit: 10,
    rtcRegion: null,
    videoQualityMode: 1,
  });
  assert.equal(unparented.permissionsSyncedWithParent, null);
  assert.equal(report.summary.unsyncedChannelCount, 1);
  assert.equal(report.summary.forumTagCount, 2);
});

test("audit overwrite order is deterministic and resolves role targets", () => {
  const report = buildReport(auditSnapshot(), reportOptions);
  const category = report.categories[0];

  assert.deepEqual(
    category.permissionOverwrites.map((overwrite) => overwrite.target.name),
    ["@everyone", "Participante"],
  );
  assert.deepEqual(
    category.permissionOverwrites[0].allow.names,
    ["ViewChannel"],
  );
  assert.deepEqual(
    category.permissionOverwrites[0].deny.names,
    ["SendMessages"],
  );
});

test("Markdown is reviewable, escaped and contains no secret fields", () => {
  const markdown = renderMarkdown(buildReport(auditSnapshot(), reportOptions));

  assert.match(markdown, /^# Auditoria do Discord/u);
  assert.match(markdown, /Sancathon \\| Auditoria/u);
  assert.match(markdown, /dúvidas \\| treinamentos/u);
  assert.match(markdown, /UNKNOWN_BITS:/u);
  assert.match(markdown, /Configuração do fórum/u);
  assert.match(markdown, /Configuração de voz/u);
  assert.match(markdown, /Canais sem categoria/u);
  assert.equal(markdown.includes(SECRET_SENTINEL), false);
});

test("audit metadata clock is injectable and stable", () => {
  const report = buildReport(auditSnapshot(), reportOptions);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.metadata.generatedAt, "2026-08-09T12:00:00.000Z");
  assert.equal(report.metadata.discordJsVersion, "14.27.0");
  assert.equal(report.metadata.generator.version, "test");
});
