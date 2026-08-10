import assert from "node:assert/strict";
import test from "node:test";

import config from "../config/index.js";
import { validateConfig } from "../src/config/validate.js";

function cloneConfig() {
  return structuredClone(config);
}

function codes(result, severity = null) {
  return result.diagnostics
    .filter((item) => severity === null || item.severity === severity)
    .map((item) => item.code);
}

test("repository configuration passes all critical validation", () => {
  const result = validateConfig(config);

  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("same team channel name is valid for distinct text and voice types", () => {
  const result = validateConfig(config);

  assert.equal(
    result.diagnostics.some((item) => (
      item.code === "DUPLICATE_CHANNEL"
      && item.message.includes("equipe-01")
    )),
    false,
  );
});

test("each configured team generates one text and one voice channel", () => {
  for (const [index, team] of config.server.teams.entries()) {
    const number = String(team.number).padStart(2, "0");
    const generated = config.channels.channels.filter(
      (channel) => channel.teamKey === team.roleKey,
    );

    assert.deepEqual(
      generated.map((channel) => ({
        key: channel.key,
        name: channel.name,
        type: channel.type,
        order: channel.order,
      })),
      [
        {
          key: `team${number}Text`,
          name: `equipe-${number}`,
          type: "GuildText",
          order: index * 2,
        },
        {
          key: `team${number}Voice`,
          name: `equipe-${number}`,
          type: "GuildVoice",
          order: index * 2 + 1,
        },
      ],
    );
  }
});

test("duplicate internal keys and duplicate channel identities are rejected", () => {
  const candidate = cloneConfig();
  candidate.roles.roles.push(structuredClone(candidate.roles.roles[1]));
  const general = candidate.channels.channels.find(
    (channel) => channel.key === "general",
  );
  candidate.channels.channels.push({
    ...structuredClone(general),
    key: "anotherGeneral",
  });
  const result = validateConfig(candidate);

  assert.equal(result.isValid, false);
  assert.ok(codes(result, "error").includes("DUPLICATE_KEY"));
  assert.ok(codes(result, "error").includes("DUPLICATE_CHANNEL"));
});

test("unknown category, team role and overwrite target are rejected", () => {
  const candidate = cloneConfig();
  const channel = candidate.channels.channels.find(
    (item) => item.key === "general",
  );
  channel.categoryKey = "missingCategory";
  channel.teamKey = "missingTeamRole";
  candidate.channels.categories[0].overwrites.push({
    target: "missingOverwriteRole",
    allow: ["ViewChannel"],
    deny: [],
  });
  const result = validateConfig(candidate);
  const errorCodes = codes(result, "error");

  assert.ok(errorCodes.includes("UNKNOWN_CHANNEL_CATEGORY"));
  assert.ok(errorCodes.includes("UNKNOWN_TEAM_ROLE"));
  assert.ok(errorCodes.includes("UNKNOWN_OVERWRITE_ROLE"));
});

test("unknown permissions and allow/deny conflicts abort configuration", () => {
  const candidate = cloneConfig();
  const start = candidate.channels.categories.find(
    (category) => category.key === "start",
  );
  start.overwrites.push({
    target: "participant",
    allow: ["FuturePermission", "ViewChannel"],
    deny: ["ViewChannel"],
  });
  const result = validateConfig(candidate);
  const errorCodes = codes(result, "error");

  assert.ok(errorCodes.includes("UNKNOWN_PERMISSION"));
  assert.ok(errorCodes.includes("OVERWRITE_ALLOW_DENY_CONFLICT"));
  assert.equal(result.isValid, false);
});

test("unsafe global permission profiles are rejected", () => {
  const candidate = cloneConfig();
  candidate.roles.roles
    .find((role) => role.key === "organization")
    .permissions.push("BanMembers");
  candidate.roles.roles
    .find((role) => role.key === "mentor")
    .permissions.push("Administrator");
  const result = validateConfig(candidate);
  const unsafe = result.errors.filter((item) => [
    "FORBIDDEN_ROLE_PERMISSION",
    "UNSAFE_COMMON_ROLE_PERMISSION",
  ].includes(item.code));

  assert.equal(unsafe.length, 2);
  assert.equal(result.isValid, false);
});

test("forum tag constraints validate type, count and normalized duplicates", () => {
  const candidate = cloneConfig();
  candidate.channels.channels
    .find((channel) => channel.key === "general")
    .availableTags = [{ key: "wrong", name: "Fora do fórum" }];
  const forum = candidate.channels.channels.find(
    (channel) => channel.key === "teamFormation",
  );
  forum.availableTags = Array.from({ length: 21 }, (_, index) => ({
    key: `tag${index}`,
    name: index < 2 ? "  DUPLICADA  " : `Tag ${index}`,
  }));
  const result = validateConfig(candidate);
  const errorCodes = codes(result, "error");

  assert.ok(errorCodes.includes("TAGS_OUTSIDE_FORUM"));
  assert.ok(errorCodes.includes("TOO_MANY_FORUM_TAGS"));
  assert.ok(errorCodes.includes("DUPLICATE_FORUM_TAG"));
});

test("known access policy mistakes are warnings", () => {
  const candidate = cloneConfig();
  const everyoneStart = candidate.channels.categories
    .find((category) => category.key === "start")
    .overwrites
    .find((overwrite) => overwrite.target === "everyone");
  everyoneStart.deny = everyoneStart.deny.filter(
    (permission) => permission !== "SendMessages",
  );
  everyoneStart.allow.push("SendMessages");
  candidate.channels.categories
    .find((category) => category.key === "teams")
    .overwrites.push({
      target: "judge",
      allow: ["ViewChannel"],
      deny: [],
    });
  const result = validateConfig(candidate);
  const warningCodes = codes(result, "warning");

  assert.ok(warningCodes.includes("PUBLIC_START_CAN_SEND"));
  assert.ok(warningCodes.includes("JUDGE_CAN_VIEW_TEAMS"));
});

test("disabled optional channels do not fail active configuration validation", () => {
  const candidate = cloneConfig();
  candidate.channels.channels.push({
    key: "disabledInvalidChannel",
    name: "invalid",
    type: "NotAChannelType",
    categoryKey: "missing",
    enabled: false,
  });

  assert.equal(validateConfig(candidate).isValid, true);
});
