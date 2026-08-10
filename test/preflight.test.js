import assert from "node:assert/strict";
import test from "node:test";

import { PermissionFlagsBits } from "discord.js";

import { preflightPlan } from "../src/apply/preflight.js";

const IDS = Object.freeze({
  guild: "800000000000000001",
  role: "800000000000000002",
  category: "800000000000000010",
  channel: "800000000000000011",
});

function snapshot({
  permissions = 0n,
  highestRolePosition = 10,
  targetRolePosition = 2,
  targetRolePermissions = 0n,
  channelManageable = true,
  community = true,
} = {}) {
  return {
    guild: {
      id: IDS.guild,
      name: "Preflight Guild",
      communityEnabled: community,
      features: community ? ["COMMUNITY"] : [],
    },
    botMember: {
      id: "800000000000000099",
      permissions: permissions.toString(),
      highestRolePosition,
    },
    roles: [
      {
        id: IDS.guild,
        name: "@everyone",
        position: 0,
        permissions: "0",
        managed: false,
      },
      {
        id: IDS.role,
        name: "Cargo alvo",
        position: targetRolePosition,
        permissions: targetRolePermissions.toString(),
        managed: false,
      },
    ],
    categories: [{
      id: IDS.category,
      name: "Categoria",
      typeName: "GuildCategory",
      manageable: channelManageable,
      availableTags: [],
    }],
    channels: [{
      id: IDS.channel,
      name: "canal",
      typeName: "GuildText",
      manageable: channelManageable,
      availableTags: [],
    }],
  };
}

function operation({
  id = "operation.test",
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

function plan(operations, overrides = {}) {
  return {
    operations,
    diagnostics: [],
    hasErrors: false,
    resolution: {
      roles: { target: IDS.role },
      categories: { category: IDS.category },
      channels: { channel: IDS.channel },
    },
    ...overrides,
  };
}

function codes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("role operations require ManageRoles", () => {
  const result = preflightPlan({
    plan: plan([operation({
      phase: 1,
      action: "UPDATE_ROLE",
      targetType: "role",
      targetKey: "target",
      payload: { name: "Novo nome" },
    })]),
    snapshot: snapshot(),
  });

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("MISSING_MANAGEROLES"));
  assert.deepEqual(result.requiredPermissions, ["ManageRoles"]);
});

test("channel operations require ManageChannels", () => {
  const result = preflightPlan({
    plan: plan([operation({
      phase: 4,
      action: "UPDATE_CHANNEL",
      targetType: "channel",
      targetKey: "channel",
      payload: { name: "novo-nome" },
    })]),
    snapshot: snapshot(),
  });

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("MISSING_MANAGECHANNELS"));
  assert.deepEqual(result.requiredPermissions, ["ManageChannels"]);
});

test("overwrite edit requires ManageRoles and the affected flag", () => {
  const overwriteOperation = operation({
    phase: 7,
    action: "EDIT_OVERWRITE",
    targetType: "channel",
    targetKey: "channel",
    payload: {
      roleKey: "target",
      permissions: { ViewChannel: false },
    },
  });
  const managementPermissions = PermissionFlagsBits.ManageRoles;
  const missingFlag = preflightPlan({
    plan: plan([overwriteOperation]),
    snapshot: snapshot({ permissions: managementPermissions }),
  });

  assert.equal(missingFlag.ok, false);
  assert.deepEqual(missingFlag.requiredPermissions, ["ManageRoles"]);
  assert.ok(codes(missingFlag).includes("CANNOT_SET_OVERWRITE_PERMISSIONS"));

  const complete = preflightPlan({
    plan: plan([overwriteOperation]),
    snapshot: snapshot({
      permissions: managementPermissions | PermissionFlagsBits.ViewChannel,
    }),
  });
  assert.equal(complete.ok, true);
});

test("creating a role cannot grant flags the bot does not possess", () => {
  const create = operation({
    phase: 1,
    action: "CREATE_ROLE",
    targetType: "role",
    targetKey: "newRole",
    payload: { permissions: PermissionFlagsBits.KickMembers.toString() },
  });
  const result = preflightPlan({
    plan: plan([create]),
    snapshot: snapshot({ permissions: PermissionFlagsBits.ManageRoles }),
  });

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("CANNOT_GRANT_ROLE_PERMISSIONS"));
  assert.match(
    result.errors.find((item) => item.code === "CANNOT_GRANT_ROLE_PERMISSIONS").message,
    /KickMembers/u,
  );
});

test("updating a role checks only newly granted flags, not removed flags", () => {
  const removeKick = operation({
    phase: 1,
    action: "UPDATE_ROLE",
    targetType: "role",
    targetKey: "target",
    payload: { permissions: "0" },
  });
  const result = preflightPlan({
    plan: plan([removeKick]),
    snapshot: snapshot({
      permissions: PermissionFlagsBits.ManageRoles,
      targetRolePermissions: PermissionFlagsBits.KickMembers,
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(codes(result).includes("CANNOT_GRANT_ROLE_PERMISSIONS"), false);
});

test("Administrator satisfies permission possession but never bypasses hierarchy", () => {
  const result = preflightPlan({
    plan: plan([operation({
      phase: 1,
      action: "UPDATE_ROLE",
      targetType: "role",
      targetKey: "target",
      payload: {
        permissions: PermissionFlagsBits.BanMembers.toString(),
      },
    })]),
    snapshot: snapshot({
      permissions: PermissionFlagsBits.Administrator,
      highestRolePosition: 5,
      targetRolePosition: 5,
    }),
  });

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("ROLE_ABOVE_BOT"));
  assert.equal(codes(result).includes("MISSING_MANAGEROLES"), false);
  assert.equal(codes(result).includes("CANNOT_GRANT_ROLE_PERMISSIONS"), false);
});

test("managed or unmanageable existing resources block apply", () => {
  const managedRoleSnapshot = snapshot({
    permissions: PermissionFlagsBits.ManageRoles,
  });
  managedRoleSnapshot.roles.find((role) => role.id === IDS.role).managed = true;
  const roleResult = preflightPlan({
    plan: plan([operation({
      phase: 1,
      action: "UPDATE_ROLE",
      targetType: "role",
      targetKey: "target",
    })]),
    snapshot: managedRoleSnapshot,
  });
  assert.ok(codes(roleResult).includes("MANAGED_ROLE_NOT_EDITABLE"));

  const channelResult = preflightPlan({
    plan: plan([operation({
      phase: 4,
      action: "UPDATE_CHANNEL",
      targetType: "channel",
      targetKey: "channel",
    })]),
    snapshot: snapshot({
      permissions: PermissionFlagsBits.ManageChannels,
      channelManageable: false,
    }),
  });
  assert.ok(codes(channelResult).includes("CHANNEL_RESOURCE_NOT_MANAGEABLE"));
});

test("phase and non-conditional dependency errors are detected", () => {
  const result = preflightPlan({
    plan: plan([operation({
      phase: 8,
      action: "UPDATE_CHANNEL",
      targetType: "channel",
      targetKey: "channel",
      dependsOn: ["operation.that-does-not-exist"],
    })]),
    snapshot: snapshot({ permissions: PermissionFlagsBits.ManageChannels }),
  });

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("INVALID_OPERATION_PHASE"));
  assert.ok(codes(result).includes("UNKNOWN_OPERATION_DEPENDENCY"));
});

test("destructive actions receive an explicit destructive-operation error", () => {
  const result = preflightPlan({
    plan: plan([operation({
      phase: 9,
      action: "DELETE_CHANNEL",
      targetType: "channel",
      targetKey: "channel",
    })]),
    snapshot: snapshot({ permissions: PermissionFlagsBits.Administrator }),
  });

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("DESTRUCTIVE_OPERATION_BLOCKED"));
});

test("community-only channel types are blocked when Community is disabled", () => {
  const result = preflightPlan({
    plan: plan([operation({
      phase: 4,
      action: "CREATE_CHANNEL",
      targetType: "channel",
      targetKey: "forum",
      payload: { type: "GuildForum" },
    })], {
      resolution: {
        roles: { target: IDS.role },
        categories: { category: IDS.category },
        channels: { forum: null },
      },
    }),
    snapshot: snapshot({
      permissions: PermissionFlagsBits.ManageChannels,
      community: false,
    }),
  });

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("COMMUNITY_FEATURE_REQUIRED"));
});

test("planner errors are propagated into preflight", () => {
  const result = preflightPlan({
    plan: plan([], {
      hasErrors: true,
      diagnostics: [{
        severity: "error",
        code: "AMBIGUOUS_RESOURCE_MATCH",
        message: "Ambiguous resource.",
      }],
    }),
    snapshot: snapshot({ permissions: PermissionFlagsBits.Administrator }),
  });

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("PLAN_AMBIGUOUS_RESOURCE_MATCH"));
});

test("invalid preflight inputs fail synchronously before any apply code", () => {
  assert.throws(
    () => preflightPlan({ plan: null, snapshot: snapshot() }),
    /Plano invalido/u,
  );
  assert.throws(
    () => preflightPlan({ plan: plan([]), snapshot: null }),
    /Snapshot invalido/u,
  );
});
