import assert from "node:assert/strict";
import test from "node:test";

import { PermissionFlagsBits } from "discord.js";

import {
  ApplyConvergenceError,
  ApplyPlanError,
  applyPlan,
} from "../src/apply/apply-plan.js";

const GUILD_ID = "700000000000000001";

function configFixture({ categoryUsesCreatedRole = false } = {}) {
  return {
    server: {
      stateFile: ".state/test-resources.json",
      features: {
        stageEnabled: false,
        eventCategoryVisibleToParticipants: false,
      },
      safety: {
        deleteRoles: false,
        deleteChannels: false,
        deleteCategories: false,
        deleteMembers: false,
      },
      teams: [],
    },
    roles: {
      hierarchy: ["newRole"],
      roles: [
        {
          key: "everyone",
          kind: "default",
          name: "@everyone",
          permissions: [],
        },
        {
          key: "newRole",
          kind: "standard",
          name: "Novo cargo",
          permissions: [],
        },
      ],
    },
    channels: {
      categories: [{
        key: "main",
        name: "CATEGORIA",
        aliases: [],
        type: "GuildCategory",
        order: 0,
        overwrites: categoryUsesCreatedRole
          ? [{
              target: "newRole",
              allow: ["ViewChannel"],
              deny: [],
            }]
          : [],
      }],
      channels: [],
    },
  };
}

function safeSnapshot() {
  return {
    guild: {
      id: GUILD_ID,
      name: "Apply Fixture Guild",
      communityEnabled: true,
      features: ["COMMUNITY"],
    },
    botMember: {
      id: "700000000000000099",
      permissions: PermissionFlagsBits.Administrator.toString(),
      highestRolePosition: 100,
    },
    roles: [{
      id: GUILD_ID,
      name: "@everyone",
      position: 0,
      permissions: "0",
      managed: false,
    }],
    categories: [],
    channels: [],
  };
}

function operation({
  id,
  phase,
  action,
  targetType,
  targetKey,
  payload = {},
  dependsOn = [],
}) {
  return {
    id,
    phase,
    action,
    targetType,
    targetKey,
    payload,
    dependsOn,
  };
}

function plannerOutput({
  entries = [],
  operations = [],
  diagnostics = [],
  hasErrors = false,
  roles = {},
  categories = {},
  channels = {},
} = {}) {
  return {
    entries,
    operations,
    diagnostics,
    hasChanges: operations.length > 0,
    hasErrors,
    summary: {
      create: 0,
      update: 0,
      ok: 0,
      unmanaged: 0,
      error: hasErrors ? 1 : 0,
      delete: 0,
    },
    resolution: {
      roles: new Map(Object.entries(roles)),
      categories: new Map(Object.entries(categories)),
      channels: new Map(Object.entries(channels)),
    },
  };
}

function createRoleOperation({
  key = "newRole",
  id = `role.${key}.create`,
  dependsOn = [],
} = {}) {
  return operation({
    id,
    phase: 1,
    action: "CREATE_ROLE",
    targetType: "role",
    targetKey: key,
    payload: {
      name: key,
      color: null,
      hoist: false,
      mentionable: false,
      permissions: "0",
    },
    dependsOn,
  });
}

function createCategoryOperation({ dependsOn = [] } = {}) {
  return operation({
    id: "category.main.create",
    phase: 3,
    action: "CREATE_CATEGORY",
    targetType: "category",
    targetKey: "main",
    payload: { name: "CATEGORIA" },
    dependsOn,
  });
}

function createHarness({
  plans,
  snapshot = safeSnapshot(),
  fetchedGuildId = GUILD_ID,
  roleCreate,
  channelCreate,
  saveState,
} = {}) {
  const stats = {
    timeline: [],
    fetches: 0,
    snapshots: 0,
    planBuilds: 0,
    roleCreateAttempts: 0,
    channelCreateAttempts: 0,
    stateBuilds: 0,
    stateSaves: 0,
    roleCreateOptions: [],
    channelCreateOptions: [],
    channelPositionCalls: [],
    savedPath: null,
    savedState: null,
  };
  const roleCache = new Map();
  const channelCache = new Map();
  const guild = {
    id: fetchedGuildId,
    roles: {
      cache: roleCache,
      async create(options) {
        stats.timeline.push("mutation:role:create");
        stats.roleCreateAttempts += 1;
        stats.roleCreateOptions.push(options);
        if (roleCreate) {
          return roleCreate(options, stats.roleCreateAttempts, stats);
        }
        const role = {
          id: `7000000000000001${stats.roleCreateAttempts}`,
          name: options.name,
          position: stats.roleCreateAttempts,
        };
        roleCache.set(role.id, role);
        return role;
      },
    },
    channels: {
      cache: channelCache,
      async fetch() {
        return channelCache;
      },
      async setPositions(assignments) {
        stats.timeline.push("mutation:channel:positions");
        stats.channelPositionCalls.push(assignments);
        return channelCache;
      },
      async create(options) {
        stats.timeline.push("mutation:channel:create");
        stats.channelCreateAttempts += 1;
        stats.channelCreateOptions.push(options);
        if (channelCreate) {
          return channelCreate(options, stats.channelCreateAttempts, stats);
        }
        const channel = {
          id: `7000000000000002${stats.channelCreateAttempts}`,
          name: options.name,
          type: options.type,
          position: stats.channelCreateAttempts,
        };
        channelCache.set(channel.id, channel);
        return channel;
      },
    },
  };
  let planIndex = 0;
  const services = {
    async fetchGuildResources() {
      stats.timeline.push("fetch");
      stats.fetches += 1;
      return { guild };
    },
    createDiscordSnapshot() {
      stats.timeline.push("snapshot");
      stats.snapshots += 1;
      return structuredClone(snapshot);
    },
    buildPlan() {
      stats.timeline.push("plan");
      stats.planBuilds += 1;
      const selected = plans[Math.min(planIndex, plans.length - 1)];
      planIndex += 1;
      return selected;
    },
    buildNextResourceState(finalPlan, guildId) {
      stats.timeline.push("state:build");
      stats.stateBuilds += 1;
      return {
        schemaVersion: 1,
        guildId,
        roles: Object.fromEntries(
          [...finalPlan.resolution.roles].filter(([, id]) => id),
        ),
        categories: Object.fromEntries(
          [...finalPlan.resolution.categories].filter(([, id]) => id),
        ),
        channels: Object.fromEntries(
          [...finalPlan.resolution.channels].filter(([, id]) => id),
        ),
        forumTags: {},
      };
    },
    async saveResourceState(path, state) {
      stats.timeline.push("state:save");
      stats.stateSaves += 1;
      stats.savedPath = path;
      stats.savedState = state;
      if (saveState) await saveState(path, state, stats);
    },
  };

  return { guild, services, stats };
}

function applyOptions(harness, overrides = {}) {
  return {
    client: {},
    guildId: GUILD_ID,
    config: configFixture(),
    statePath: ".state/test-resources.json",
    services: harness.services,
    ...overrides,
  };
}

test("preflight failure aborts before the first mutation and state write", async () => {
  const unsafePlan = plannerOutput({
    operations: [createRoleOperation()],
    diagnostics: [{
      severity: "error",
      code: "TEST_PLAN_ERROR",
      message: "Unsafe plan fixture.",
    }],
    hasErrors: true,
    roles: { newRole: null },
  });
  const harness = createHarness({ plans: [unsafePlan] });

  await assert.rejects(
    () => applyPlan(applyOptions(harness)),
    (error) => {
      assert.ok(error instanceof ApplyPlanError);
      assert.equal(error.code, "PREFLIGHT_FAILED");
      return true;
    },
  );
  assert.equal(harness.stats.roleCreateAttempts, 0);
  assert.equal(harness.stats.channelCreateAttempts, 0);
  assert.equal(harness.stats.stateSaves, 0);
});

test("unmet dependency aborts before its operation mutates Discord", async () => {
  const dependent = createRoleOperation({
    key: "aDependent",
    id: "role.a-dependent.create",
    dependsOn: ["role.z-prerequisite.create"],
  });
  const prerequisite = createRoleOperation({
    key: "zPrerequisite",
    id: "role.z-prerequisite.create",
  });
  const unsafeOrder = plannerOutput({
    operations: [dependent, prerequisite],
    roles: { aDependent: null, zPrerequisite: null },
  });
  const harness = createHarness({ plans: [unsafeOrder] });

  await assert.rejects(
    () => applyPlan(applyOptions(harness)),
    (error) => {
      assert.equal(error.code, "UNMET_DEPENDENCY");
      assert.equal(error.operationId, dependent.id);
      return true;
    },
  );
  assert.equal(harness.stats.roleCreateAttempts, 0);
  assert.equal(harness.stats.stateSaves, 0);
});

test("operation failure stops dependents and exposes only completed partial results", async () => {
  const first = createRoleOperation({ key: "aFirst" });
  const failing = createRoleOperation({ key: "bFailing" });
  const dependentCategory = createCategoryOperation({
    dependsOn: [failing.id],
  });
  const mutationPlan = plannerOutput({
    operations: [first, failing, dependentCategory],
    roles: { aFirst: null, bFailing: null },
    categories: { main: null },
  });
  const harness = createHarness({
    plans: [mutationPlan],
    roleCreate(_options, attempt) {
      if (attempt === 2) throw new Error("simulated Discord failure");
      return { id: "700000000000000111", position: 1 };
    },
  });
  let failure;

  try {
    await applyPlan(applyOptions(harness));
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof ApplyPlanError);
  assert.equal(failure.code, "OPERATION_FAILED");
  assert.equal(failure.operationId, failing.id);
  assert.equal(failure.partialResults.length, 1);
  assert.equal(failure.partialResults[0].operationId, first.id);
  assert.equal(harness.stats.roleCreateAttempts, 2);
  assert.equal(harness.stats.channelCreateAttempts, 0);
  assert.equal(harness.stats.stateSaves, 0);
});

test("successful apply respects dependencies and writes state only after convergence", async () => {
  const roleCreate = createRoleOperation();
  const categoryCreate = createCategoryOperation({
    dependsOn: [roleCreate.id],
  });
  const firstPlan = plannerOutput({
    operations: [categoryCreate, roleCreate],
    roles: { newRole: null },
    categories: { main: null },
  });
  const finalPlan = plannerOutput({
    roles: { newRole: "70000000000000011" },
    categories: { main: "70000000000000021" },
  });
  const harness = createHarness({ plans: [firstPlan, finalPlan] });
  const result = await applyPlan(applyOptions(harness, {
    config: configFixture({ categoryUsesCreatedRole: true }),
  }));

  assert.equal(result.applied, true);
  assert.equal(result.passes, 2);
  assert.equal(result.results.length, 2);
  assert.deepEqual(
    result.results.map((item) => item.action),
    ["CREATE_ROLE", "CREATE_CATEGORY"],
  );
  assert.equal(harness.stats.roleCreateAttempts, 1);
  assert.equal(harness.stats.channelCreateAttempts, 1);
  assert.equal(
    harness.stats.channelCreateOptions[0].permissionOverwrites[0].id,
    "70000000000000011",
  );
  assert.equal(
    harness.stats.channelCreateOptions[0].permissionOverwrites[0].allow,
    PermissionFlagsBits.ViewChannel,
  );
  assert.equal(harness.stats.stateBuilds, 1);
  assert.equal(harness.stats.stateSaves, 1);
  assert.ok(
    harness.stats.timeline.lastIndexOf("plan")
      < harness.stats.timeline.indexOf("state:build"),
  );
  assert.ok(
    harness.stats.timeline.indexOf("state:build")
      < harness.stats.timeline.indexOf("state:save"),
  );
  assert.deepEqual(harness.stats.savedState, result.state);
  assert.equal(result.plan, finalPlan);
  assert.equal(result.planAfter, result.plan);
  assert.deepEqual(result.snapshot, safeSnapshot());
  assert.deepEqual(result.snapshotAfter, result.snapshot);
});

test("apply converges around an explicit existing role deferral", async () => {
  const administrationId = "700000000000000055";
  const deferredConfig = configFixture();
  deferredConfig.roles.hierarchy = ["administration"];
  deferredConfig.roles.roles[1] = {
    key: "administration",
    kind: "standard",
    name: "Administração",
    aliases: ["Organização"],
    color: "#A61B1B",
    hoist: false,
    mentionable: false,
    permissions: [],
  };
  deferredConfig.channels.categories[0].overwrites = [{
    target: "administration",
    allow: ["ViewChannel"],
    deny: [],
  }];

  const administrationEntry = {
    id: "role.administration",
    status: "UPDATE",
    resourceType: "role",
    resourceKey: "administration",
    resourceId: administrationId,
    name: "Administração",
    changes: [{ path: "name", from: "Organização", to: "Administração" }],
  };
  const deferredUpdate = operation({
    id: "role.administration.update",
    phase: 1,
    action: "UPDATE_ROLE",
    targetType: "role",
    targetKey: "administration",
    payload: { name: "Administração" },
  });
  const firstPlan = plannerOutput({
    entries: [
      administrationEntry,
      {
        id: "category.main",
        status: "CREATE",
        resourceType: "category",
        resourceKey: "main",
        resourceId: null,
        name: "CATEGORIA",
        changes: [{ path: "resource", from: null, to: "CATEGORIA" }],
      },
    ],
    operations: [deferredUpdate, createCategoryOperation()],
    roles: { everyone: GUILD_ID, administration: administrationId },
    categories: { main: null },
  });
  const finalPlan = plannerOutput({
    entries: [
      administrationEntry,
      {
        id: "category.main",
        status: "OK",
        resourceType: "category",
        resourceKey: "main",
        resourceId: "70000000000000021",
        name: "CATEGORIA",
        changes: [],
      },
    ],
    operations: [deferredUpdate],
    roles: { everyone: GUILD_ID, administration: administrationId },
    categories: { main: "70000000000000021" },
  });
  const snapshot = safeSnapshot();
  snapshot.roles.push({
    id: administrationId,
    name: "Organização",
    position: 200,
    permissions: "0",
    managed: false,
    editable: false,
  });
  const harness = createHarness({ plans: [firstPlan, finalPlan], snapshot });

  const result = await applyPlan(applyOptions(harness, {
    config: deferredConfig,
    deferRoleKeys: ["administration"],
  }));

  assert.equal(result.applied, true);
  assert.equal(harness.stats.roleCreateAttempts, 0);
  assert.equal(harness.stats.channelCreateAttempts, 1);
  assert.deepEqual(
    harness.stats.channelCreateOptions[0].permissionOverwrites,
    [],
  );
  assert.equal(result.plan.operations.length, 0);
  assert.equal(result.plan.hasDeferred, true);
  assert.equal(result.plan.entries[0].status, "DEFERRED");
  assert.equal(harness.stats.stateSaves, 1);
});

test("channel reorder assigns positions independently for text and voice", async () => {
  const textA = { id: "700000000000000301", type: 0, position: 1 };
  const textB = { id: "700000000000000302", type: 15, position: 0 };
  const voice = { id: "700000000000000303", type: 2, position: 0 };
  const reorder = operation({
    id: "channel.order.main",
    phase: 5,
    action: "REORDER_CHANNELS",
    targetType: "channelHierarchy",
    targetKey: "main",
    payload: { keys: ["textA", "textB", "voice"] },
  });
  const firstPlan = plannerOutput({
    operations: [reorder],
    roles: { everyone: GUILD_ID },
    channels: {
      textA: textA.id,
      textB: textB.id,
      voice: voice.id,
    },
  });
  const finalPlan = plannerOutput({
    roles: { everyone: GUILD_ID },
    channels: {
      textA: textA.id,
      textB: textB.id,
      voice: voice.id,
    },
  });
  const snapshot = safeSnapshot();
  snapshot.channels = [
    { ...textA, name: "a", manageable: true },
    { ...textB, name: "b", manageable: true },
    { ...voice, name: "voice", manageable: true },
  ];
  const harness = createHarness({ plans: [firstPlan, finalPlan], snapshot });
  harness.guild.channels.cache.set(textA.id, textA);
  harness.guild.channels.cache.set(textB.id, textB);
  harness.guild.channels.cache.set(voice.id, voice);

  await applyPlan(applyOptions(harness));

  assert.deepEqual(harness.stats.channelPositionCalls, [[
    { channel: textA.id, position: 0 },
    { channel: textB.id, position: 1 },
  ]]);
});

test("state is not written when post-apply verification does not converge", async () => {
  const pendingPlan = plannerOutput({
    operations: [createRoleOperation()],
    roles: { newRole: null },
  });
  const harness = createHarness({ plans: [pendingPlan, pendingPlan] });

  await assert.rejects(
    () => applyPlan(applyOptions(harness, { maxPasses: 1 })),
    (error) => {
      assert.ok(error instanceof ApplyConvergenceError);
      assert.equal(error.code, "CONVERGENCE_FAILED");
      assert.equal(error.verificationPlan, pendingPlan);
      return true;
    },
  );
  assert.equal(harness.stats.roleCreateAttempts, 1);
  assert.equal(harness.stats.stateBuilds, 0);
  assert.equal(harness.stats.stateSaves, 0);
});

test("state save failure is explicit and occurs only after confirmed convergence", async () => {
  const converged = plannerOutput();
  const harness = createHarness({
    plans: [converged],
    saveState() {
      throw new Error("simulated disk failure");
    },
  });

  await assert.rejects(
    () => applyPlan(applyOptions(harness)),
    (error) => {
      assert.ok(error instanceof ApplyPlanError);
      assert.equal(error.code, "STATE_SAVE_FAILED");
      assert.equal(error.plan, converged);
      return true;
    },
  );
  assert.equal(harness.stats.roleCreateAttempts, 0);
  assert.equal(harness.stats.stateBuilds, 1);
  assert.equal(harness.stats.stateSaves, 1);
});

test("guild mismatch aborts before snapshot, plan, mutation and state", async () => {
  const harness = createHarness({
    plans: [plannerOutput()],
    fetchedGuildId: "799999999999999999",
  });

  await assert.rejects(
    () => applyPlan(applyOptions(harness)),
    (error) => {
      assert.equal(error.code, "GUILD_MISMATCH");
      return true;
    },
  );
  assert.equal(harness.stats.snapshots, 0);
  assert.equal(harness.stats.planBuilds, 0);
  assert.equal(harness.stats.roleCreateAttempts, 0);
  assert.equal(harness.stats.stateSaves, 0);
});

test("state from another guild aborts before fetch, mutation and state write", async () => {
  const harness = createHarness({ plans: [plannerOutput()] });

  await assert.rejects(
    () => applyPlan(applyOptions(harness, {
      state: {
        schemaVersion: 1,
        guildId: "799999999999999999",
        roles: {},
        categories: {},
        channels: {},
        forumTags: {},
      },
    })),
    (error) => {
      assert.ok(error instanceof ApplyPlanError);
      assert.equal(error.code, "STATE_GUILD_MISMATCH");
      return true;
    },
  );
  assert.equal(harness.stats.fetches, 0);
  assert.equal(harness.stats.snapshots, 0);
  assert.equal(harness.stats.planBuilds, 0);
  assert.equal(harness.stats.roleCreateAttempts, 0);
  assert.equal(harness.stats.channelCreateAttempts, 0);
  assert.equal(harness.stats.stateSaves, 0);
});

test("CREATE repeated by a later pass fails convergence before duplication", async () => {
  const repeatedCreate = createRoleOperation();
  const firstPlan = plannerOutput({
    operations: [repeatedCreate],
    roles: { newRole: null },
  });
  const secondPlan = plannerOutput({
    operations: [structuredClone(repeatedCreate)],
    roles: { newRole: null },
  });
  const harness = createHarness({ plans: [firstPlan, secondPlan] });

  await assert.rejects(
    () => applyPlan(applyOptions(harness)),
    (error) => {
      assert.ok(error instanceof ApplyConvergenceError);
      assert.equal(error.code, "CONVERGENCE_FAILED");
      assert.equal(error.operationId, repeatedCreate.id);
      assert.equal(error.verificationPlan, secondPlan);
      assert.equal(error.partialResults.length, 1);
      return true;
    },
  );
  assert.equal(harness.stats.fetches, 2);
  assert.equal(harness.stats.planBuilds, 2);
  assert.equal(harness.stats.roleCreateAttempts, 1);
  assert.equal(harness.stats.stateBuilds, 0);
  assert.equal(harness.stats.stateSaves, 0);
});

test("private unsynced MOVE denies @everyone before setParent and preserves extras", async () => {
  const privateCategoryId = "700000000000000210";
  const existingChannelId = "700000000000000211";
  const moveConfig = configFixture();
  moveConfig.channels.categories[0] = {
    key: "private",
    name: "PRIVADA",
    aliases: [],
    type: "GuildCategory",
    order: 0,
    overwrites: [{
      target: "everyone",
      allow: [],
      deny: ["ViewChannel"],
    }],
  };
  moveConfig.channels.channels = [{
    key: "general",
    name: "geral",
    aliases: [],
    type: "GuildText",
    categoryKey: "private",
    order: 0,
    overwrites: [],
  }];
  const moveSnapshot = safeSnapshot();
  moveSnapshot.categories = [{
    id: privateCategoryId,
    name: "PRIVADA",
    typeName: "GuildCategory",
    manageable: true,
  }];
  moveSnapshot.channels = [{
    id: existingChannelId,
    name: "geral",
    typeName: "GuildText",
    parentId: null,
    manageable: true,
    permissionOverwrites: [],
  }];
  const moveOperation = operation({
    id: "channel.general.parent",
    phase: 5,
    action: "MOVE_CHANNEL",
    targetType: "channel",
    targetKey: "general",
    payload: {
      categoryKey: "private",
      lockPermissions: false,
    },
  });
  const movePlan = plannerOutput({
    operations: [moveOperation],
    roles: { everyone: GUILD_ID },
    categories: { private: privateCategoryId },
    channels: { general: existingChannelId },
  });
  const convergedPlan = plannerOutput({
    roles: { everyone: GUILD_ID },
    categories: { private: privateCategoryId },
    channels: { general: existingChannelId },
  });
  const harness = createHarness({
    plans: [movePlan, convergedPlan],
    snapshot: moveSnapshot,
  });
  const extraOverwriteId = "700000000000000299";
  const overwriteCache = new Map([
    [
      GUILD_ID,
      {
        id: GUILD_ID,
        deny: { has: () => false },
      },
    ],
    [
      extraOverwriteId,
      {
        id: extraOverwriteId,
        deny: { has: () => false },
      },
    ],
  ]);
  let editArguments = null;
  let parentArguments = null;
  const existingChannel = {
    id: existingChannelId,
    permissionOverwrites: {
      cache: overwriteCache,
      async edit(role, permissions, options) {
        harness.stats.timeline.push("guard:deny-everyone");
        editArguments = { role, permissions, options };
      },
    },
    async setParent(parentId, options) {
      harness.stats.timeline.push("move:set-parent");
      parentArguments = { parentId, options };
      assert.equal(overwriteCache.has(extraOverwriteId), true);
      return this;
    },
  };
  const everyoneRole = { id: GUILD_ID, name: "@everyone" };
  harness.guild.roles.cache.set(GUILD_ID, everyoneRole);
  harness.guild.channels.fetch = async (id) => {
    assert.equal(id, existingChannelId);
    return existingChannel;
  };

  const result = await applyPlan(applyOptions(harness, {
    config: moveConfig,
  }));

  assert.ok(editArguments);
  assert.equal(editArguments.role, everyoneRole);
  assert.deepEqual(editArguments.permissions, { ViewChannel: false });
  assert.equal(parentArguments.parentId, privateCategoryId);
  assert.equal(parentArguments.options.lockPermissions, false);
  assert.ok(
    harness.stats.timeline.indexOf("guard:deny-everyone")
      < harness.stats.timeline.indexOf("move:set-parent"),
  );
  assert.equal(overwriteCache.has(extraOverwriteId), true);
  assert.equal(result.results[0].details.visibilityGuardApplied, true);
  assert.equal(harness.stats.stateSaves, 1);
});

test("invalid apply arguments fail before services or mutations", async () => {
  const harness = createHarness({ plans: [plannerOutput()] });

  await assert.rejects(
    () => applyPlan(applyOptions(harness, { client: null })),
    /client e obrigatorio/u,
  );
  await assert.rejects(
    () => applyPlan(applyOptions(harness, { maxPasses: 0 })),
    /maxPasses/u,
  );
  assert.equal(harness.stats.fetches, 0);
  assert.equal(harness.stats.stateSaves, 0);
});
