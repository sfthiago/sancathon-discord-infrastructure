import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNextResourceState,
  buildPlan,
} from "../src/planner/build-plan.js";
import { formatPlan } from "../src/planner/format-plan.js";
import {
  colorToHex,
  colorToNumber,
  decodePermissionSet,
  encodePermissions,
} from "../src/utils/permissions.js";

const IDS = Object.freeze({
  guild: "100000000000000001",
  organization: "100000000000000002",
  participant: "100000000000000003",
  category: "100000000000000010",
  channel: "100000000000000011",
});

function desiredConfig() {
  return {
    server: { expectedGuildName: "Fixture Guild" },
    roles: {
      hierarchy: ["organization", "participant"],
      roles: [
        {
          key: "everyone",
          kind: "default",
          name: "@everyone",
          permissions: [],
        },
        {
          key: "organization",
          kind: "standard",
          name: "Organização",
          aliases: [],
          color: "#245A9C",
          hoist: false,
          mentionable: false,
          permissions: ["ManageChannels"],
        },
        {
          key: "participant",
          kind: "standard",
          name: "Participante",
          aliases: [],
          color: null,
          hoist: false,
          mentionable: false,
          permissions: ["SendMessages"],
        },
      ],
    },
    channels: {
      categories: [{
        key: "main",
        name: "CATEGORIA PRINCIPAL",
        aliases: [],
        type: "GuildCategory",
        order: 0,
        overwrites: [
          { target: "everyone", allow: [], deny: ["ViewChannel"] },
          { target: "participant", allow: ["ViewChannel"], deny: [] },
        ],
      }],
      channels: [{
        key: "general",
        name: "geral",
        aliases: [],
        type: "GuildText",
        categoryKey: "main",
        order: 0,
        slowmode: 5,
        overwrites: [],
      }],
    },
  };
}

function currentRole({
  id,
  name,
  position,
  color = null,
  permissions = [],
  managed = false,
  unknownPermissions = "0",
}) {
  const encoded = encodePermissions(permissions);
  const decoded = decodePermissionSet(encoded);
  const numericColor = colorToNumber(color);

  return {
    id,
    name,
    position,
    rawPosition: position,
    colors: { primaryColor: numericColor },
    hexColor: colorToHex(numericColor),
    hoist: false,
    mentionable: false,
    managed,
    permissions: decoded.bitfield,
    permissionNames: decoded.names,
    unknownPermissions,
  };
}

function currentOverwrite(id, allow = [], deny = [], targetType = "role") {
  const encodedAllow = decodePermissionSet(encodePermissions(allow));
  const encodedDeny = decodePermissionSet(encodePermissions(deny));

  return {
    id,
    type: targetType === "role" ? 0 : 1,
    targetType,
    targetName: null,
    allow: encodedAllow.bitfield,
    allowNames: encodedAllow.names,
    unknownAllow: encodedAllow.unknownBitfield,
    deny: encodedDeny.bitfield,
    denyNames: encodedDeny.names,
    unknownDeny: encodedDeny.unknownBitfield,
  };
}

function currentOverwrites({ participantCanView = true } = {}) {
  return [
    currentOverwrite(IDS.guild, [], ["ViewChannel"]),
    participantCanView
      ? currentOverwrite(IDS.participant, ["ViewChannel"], [])
      : currentOverwrite(IDS.participant, [], ["ViewChannel"]),
  ];
}

function currentSnapshot() {
  const overwrites = currentOverwrites();

  return {
    guild: {
      id: IDS.guild,
      name: "Fixture Guild",
      publicUpdatesChannelId: null,
    },
    botMember: {},
    roles: [
      currentRole({
        id: IDS.guild,
        name: "@everyone",
        position: 0,
      }),
      currentRole({
        id: IDS.organization,
        name: "Organização",
        position: 2,
        color: "#245A9C",
        permissions: ["ManageChannels"],
      }),
      currentRole({
        id: IDS.participant,
        name: "Participante",
        position: 1,
        permissions: ["SendMessages"],
      }),
    ],
    categories: [{
      id: IDS.category,
      name: "CATEGORIA PRINCIPAL",
      type: 4,
      typeName: "GuildCategory",
      position: 0,
      permissionOverwrites: structuredClone(overwrites),
    }],
    channels: [{
      id: IDS.channel,
      name: "geral",
      type: 0,
      typeName: "GuildText",
      parentId: IDS.category,
      position: 0,
      rateLimitPerUser: 5,
      permissionsLocked: true,
      availableTags: [],
      permissionOverwrites: structuredClone(overwrites),
    }],
  };
}

function resourceState() {
  return {
    schemaVersion: 1,
    guildId: IDS.guild,
    roles: {
      organization: IDS.organization,
      participant: IDS.participant,
    },
    categories: { main: IDS.category },
    channels: { general: IDS.channel },
    forumTags: {},
  };
}

function exactPlan() {
  return buildPlan({
    config: desiredConfig(),
    snapshot: currentSnapshot(),
    state: resourceState(),
  });
}

test("equivalent desired and current states produce an idempotent empty plan", () => {
  const plan = exactPlan();

  assert.deepEqual(plan.operations, []);
  assert.equal(plan.hasChanges, false);
  assert.equal(plan.hasErrors, false);
  assert.deepEqual(plan.summary, {
    create: 0,
    update: 0,
    ok: 4,
    unmanaged: 0,
    error: 0,
    delete: 0,
  });
  assert.ok(plan.entries.every((entry) => entry.status === "OK"));
});

test("text and voice positions are compared in independent Discord groups", () => {
  const config = desiredConfig();
  config.channels.channels.push(
    {
      key: "questions",
      name: "perguntas",
      aliases: [],
      type: "GuildForum",
      categoryKey: "main",
      order: 1,
      overwrites: [],
    },
    {
      key: "lounge",
      name: "convivencia",
      aliases: [],
      type: "GuildVoice",
      categoryKey: "main",
      order: 2,
      overwrites: [],
    },
  );
  const snapshot = currentSnapshot();
  const base = snapshot.channels[0];
  snapshot.channels.push(
    {
      ...structuredClone(base),
      id: "100000000000000012",
      name: "perguntas",
      type: 15,
      typeName: "GuildForum",
      position: 1,
    },
    {
      ...structuredClone(base),
      id: "100000000000000013",
      name: "convivencia",
      type: 2,
      typeName: "GuildVoice",
      position: 0,
      rateLimitPerUser: 0,
    },
  );
  const state = resourceState();
  state.channels.questions = "100000000000000012";
  state.channels.lounge = "100000000000000013";

  const plan = buildPlan({ config, snapshot, state });

  assert.equal(
    plan.operations.some((item) => item.action === "REORDER_CHANNELS"),
    false,
  );
});

test("input array and permission order do not create false updates", () => {
  const config = desiredConfig();
  const snapshot = currentSnapshot();

  config.roles.roles[1].permissions.reverse();
  config.channels.categories[0].overwrites.reverse();
  snapshot.roles.reverse();
  snapshot.categories[0].permissionOverwrites.reverse();
  snapshot.channels[0].permissionOverwrites.reverse();

  const plan = buildPlan({ config, snapshot, state: resourceState() });
  assert.deepEqual(plan.operations, []);
  assert.equal(plan.hasChanges, false);
});

test("extra server resources are UNMANAGED and never deleted or reordered", () => {
  const snapshot = currentSnapshot();
  snapshot.roles.find((role) => role.id === IDS.organization).position = 3;
  snapshot.roles.find((role) => role.id === IDS.participant).position = 1;
  snapshot.roles.push(currentRole({
    id: "100000000000000099",
    name: "Cargo externo",
    position: 2,
  }));
  snapshot.categories.push({
    id: "100000000000000098",
    name: "Categoria externa",
    type: 4,
    typeName: "GuildCategory",
    position: 1,
    permissionOverwrites: [],
  });
  snapshot.channels.push({
    id: "100000000000000097",
    name: "canal-externo",
    type: 0,
    typeName: "GuildText",
    parentId: IDS.category,
    position: 1,
    permissionOverwrites: [],
  });

  const plan = buildPlan({
    config: desiredConfig(),
    snapshot,
    state: resourceState(),
  });

  assert.equal(plan.summary.unmanaged, 3);
  assert.equal(plan.summary.delete, 0);
  assert.equal(plan.operations.length, 0);
  assert.equal(
    plan.operations.some((operation) => operation.action.includes("DELETE")),
    false,
  );
});

test("empty server plan follows safe operation phases and dependencies", () => {
  const snapshot = currentSnapshot();
  snapshot.roles = snapshot.roles.filter((role) => role.id === IDS.guild);
  snapshot.categories = [];
  snapshot.channels = [];
  const plan = buildPlan({
    config: desiredConfig(),
    snapshot,
    state: {
      roles: {},
      categories: {},
      channels: {},
      forumTags: {},
    },
  });
  const phases = plan.operations.map((operation) => operation.phase);

  assert.deepEqual(phases, [...phases].sort((left, right) => left - right));
  assert.ok(plan.operations.some((operation) => operation.action === "CREATE_ROLE"));
  assert.ok(plan.operations.some((operation) => operation.action === "REORDER_ROLES"));
  assert.ok(plan.operations.some((operation) => operation.action === "CREATE_CATEGORY"));
  assert.ok(plan.operations.some((operation) => operation.action === "CREATE_CHANNEL"));
  assert.ok(plan.operations.some((operation) => operation.action === "EDIT_OVERWRITE"));
  assert.ok(
    plan.operations.some((operation) => operation.action === "UPDATE_CHANNEL_SETTINGS"),
  );
  const channelCreate = plan.operations.find(
    (operation) => operation.id === "channel.general.create",
  );
  assert.deepEqual(channelCreate.dependsOn, ["category.main.create"]);
  assert.equal(plan.summary.delete, 0);
});

test("category visibility toggle plans only its managed permission change", () => {
  const config = desiredConfig();
  const snapshot = currentSnapshot();
  snapshot.categories[0].permissionOverwrites = currentOverwrites({
    participantCanView: false,
  });
  snapshot.channels[0].permissionOverwrites = currentOverwrites({
    participantCanView: false,
  });
  const plan = buildPlan({ config, snapshot, state: resourceState() });
  const permissionOperations = plan.operations.filter(
    (operation) => operation.action === "EDIT_OVERWRITE",
  );

  assert.equal(permissionOperations.length, 1);
  assert.equal(permissionOperations[0].id, "category.main.overwrite.participant");
  assert.deepEqual(permissionOperations[0].payload.permissions, {
    ViewChannel: true,
  });
});

test("unknown current role permission bits block replacement", () => {
  const snapshot = currentSnapshot();
  const organization = snapshot.roles.find(
    (role) => role.id === IDS.organization,
  );
  const unknownBit = 1n << 62n;
  organization.permissions = unknownBit.toString();
  organization.permissionNames = [];
  organization.unknownPermissions = unknownBit.toString();
  const plan = buildPlan({
    config: desiredConfig(),
    snapshot,
    state: resourceState(),
  });

  assert.equal(plan.hasErrors, true);
  assert.ok(
    plan.diagnostics.some((item) => item.code === "UNKNOWN_ROLE_PERMISSION_BITS"),
  );
  assert.equal(
    plan.operations.some((operation) => (
      operation.action === "UPDATE_ROLE"
      && operation.targetKey === "organization"
    )),
    false,
  );
});

test("incompatible existing channel is one error and is not duplicated", () => {
  const snapshot = currentSnapshot();
  snapshot.channels[0].type = 2;
  snapshot.channels[0].typeName = "GuildVoice";
  const plan = buildPlan({
    config: desiredConfig(),
    snapshot,
    state: {
      ...resourceState(),
      channels: {},
    },
  });

  assert.equal(plan.hasErrors, true);
  assert.equal(plan.summary.error, 1);
  assert.equal(
    plan.operations.some((operation) => operation.action === "CREATE_CHANNEL"),
    false,
  );
  assert.ok(
    plan.diagnostics.some((item) => item.code === "RESOURCE_TYPE_MISMATCH"),
  );
});

test("a same-name non-category blocks duplicate category creation", () => {
  const snapshot = currentSnapshot();
  snapshot.categories = [];
  snapshot.channels.push({
    id: "100000000000000088",
    name: "CATEGORIA PRINCIPAL",
    type: 0,
    typeName: "GuildText",
    parentId: null,
    position: 2,
    rateLimitPerUser: 0,
    permissionsLocked: null,
    availableTags: [],
    permissionOverwrites: [],
  });
  const state = resourceState();
  state.categories = {};
  const plan = buildPlan({ config: desiredConfig(), snapshot, state });

  assert.equal(plan.hasErrors, true);
  assert.ok(
    plan.diagnostics.some((item) => (
      item.code === "RESOURCE_TYPE_MISMATCH" && item.resourceKey === "main"
    )),
  );
  assert.equal(
    plan.operations.some((operation) => operation.action === "CREATE_CATEGORY"),
    false,
  );
});

test("managed integration role is never edited", () => {
  const snapshot = currentSnapshot();
  snapshot.roles.find((role) => role.id === IDS.organization).managed = true;
  const plan = buildPlan({
    config: desiredConfig(),
    snapshot,
    state: resourceState(),
  });

  assert.equal(plan.hasErrors, true);
  assert.ok(
    plan.diagnostics.some((item) => item.code === "MANAGED_ROLE_NOT_EDITABLE"),
  );
  assert.equal(
    plan.operations.some((operation) => operation.targetKey === "organization"),
    false,
  );
});

test("moving an existing channel is UPDATE, not CREATE", () => {
  const snapshot = currentSnapshot();
  snapshot.channels[0].parentId = null;
  const plan = buildPlan({
    config: desiredConfig(),
    snapshot,
    state: resourceState(),
  });
  const entry = plan.entries.find((item) => item.id === "channel.general");

  assert.equal(entry.status, "UPDATE");
  assert.ok(entry.changes.some((change) => change.path === "parent"));
  assert.ok(plan.operations.some((operation) => operation.action === "MOVE_CHANNEL"));
  assert.equal(
    plan.operations.some((operation) => operation.action === "CREATE_CHANNEL"),
    false,
  );
});

test("unmanaged forum tags are reported and preserved", () => {
  const config = desiredConfig();
  config.channels.channels[0].type = "GuildForum";
  config.channels.channels[0].availableTags = [{
    key: "question",
    name: "Pergunta",
    aliases: [],
  }];
  const snapshot = currentSnapshot();
  snapshot.channels[0].type = 15;
  snapshot.channels[0].typeName = "GuildForum";
  snapshot.channels[0].availableTags = [
    { id: "701", name: "Pergunta" },
    { id: "702", name: "Tag externa" },
  ];
  const plan = buildPlan({ config, snapshot, state: resourceState() });

  assert.ok(
    plan.diagnostics.some((item) => item.code === "UNMANAGED_FORUM_TAG"),
  );
  assert.equal(
    plan.operations.some((operation) => (
      operation.action === "UPDATE_CHANNEL_SETTINGS"
      && Object.hasOwn(operation.payload, "availableTags")
    )),
    false,
  );
});

test("next resource state contains only resolved managed IDs", () => {
  const state = buildNextResourceState(exactPlan(), IDS.guild);

  assert.deepEqual(state, {
    schemaVersion: 1,
    guildId: IDS.guild,
    roles: {
      organization: IDS.organization,
      participant: IDS.participant,
    },
    categories: { main: IDS.category },
    channels: { general: IDS.channel },
    forumTags: {},
  });
  assert.equal(Object.hasOwn(state.roles, "everyone"), false);
});

test("terminal formatter reports idempotency and a zero delete count", () => {
  const output = formatPlan(exactPlan(), {
    guildName: "Fixture Guild",
    mode: "DRY RUN",
  });

  assert.match(output, /No changes required\./u);
  assert.match(output, /DELETE\s+0/u);
  assert.match(output, /ERROR\s+0/u);
});
