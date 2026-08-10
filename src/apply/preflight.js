import { PermissionFlagsBits } from "discord.js";

import { permissionEntries } from "../utils/permissions.js";

const PHASES_BY_ACTION = new Map([
  ["CREATE_ROLE", new Set([1])],
  ["UPDATE_ROLE", new Set([1])],
  ["REORDER_ROLES", new Set([2])],
  ["CREATE_CATEGORY", new Set([3])],
  ["UPDATE_CATEGORY", new Set([3])],
  ["CREATE_CHANNEL", new Set([4])],
  ["UPDATE_CHANNEL", new Set([4])],
  ["MOVE_CHANNEL", new Set([5])],
  ["REORDER_CATEGORIES", new Set([5])],
  ["REORDER_CHANNELS", new Set([5])],
  ["EDIT_OVERWRITE", new Set([6, 7])],
  ["UPDATE_CHANNEL_SETTINGS", new Set([8])],
]);

const ROLE_ACTIONS = new Set([
  "CREATE_ROLE",
  "UPDATE_ROLE",
  "REORDER_ROLES",
  "EDIT_OVERWRITE",
]);

const CHANNEL_ACTIONS = new Set([
  "CREATE_CATEGORY",
  "UPDATE_CATEGORY",
  "CREATE_CHANNEL",
  "UPDATE_CHANNEL",
  "MOVE_CHANNEL",
  "REORDER_CATEGORIES",
  "REORDER_CHANNELS",
  "UPDATE_CHANNEL_SETTINGS",
]);

const COMMUNITY_CHANNEL_TYPES = new Set([
  "GuildForum",
  "GuildMedia",
  "GuildStageVoice",
]);

function resolutionGet(resolution, key) {
  if (resolution instanceof Map) return resolution.get(key) ?? null;
  return resolution?.[key] ?? null;
}

function permissionNamesForBits(bitfield) {
  const result = [];
  const seenBits = new Set();
  for (const [name, bit] of permissionEntries) {
    if ((bitfield & bit) !== bit || seenBits.has(bit)) continue;
    seenBits.add(bit);
    result.push(name);
  }
  return result;
}

function makeDiagnostic(severity, code, message, options = {}) {
  return {
    severity,
    code,
    message,
    operationId: options.operationId ?? null,
    path: options.path ?? null,
    resourceKey: options.resourceKey ?? null,
    resourceId: options.resourceId ?? null,
  };
}

function currentResource(snapshot, type, id) {
  if (!id) return null;
  const resources = type === "category" ? snapshot.categories : snapshot.channels;
  return resources.find((resource) => resource.id === id) ?? null;
}

function currentRole(snapshot, id) {
  if (!id) return null;
  return snapshot.roles.find((role) => role.id === id) ?? null;
}

function operationResourceId(plan, operation) {
  if (operation.targetType === "category") {
    return resolutionGet(plan.resolution?.categories, operation.targetKey);
  }
  if (operation.targetType === "channel") {
    return resolutionGet(plan.resolution?.channels, operation.targetKey);
  }
  return null;
}

function addPlanDiagnostics(plan, add) {
  for (const diagnostic of plan.diagnostics ?? []) {
    const severity = diagnostic.severity === "error" ? "error" : "warning";
    add(
      makeDiagnostic(
        severity,
        `PLAN_${diagnostic.code ?? "DIAGNOSTIC"}`,
        diagnostic.message ?? "O planner retornou um diagnostico sem mensagem.",
        diagnostic,
      ),
    );
  }

  if (plan.hasErrors && !(plan.diagnostics ?? []).some((item) => item.severity === "error")) {
    add(
      makeDiagnostic(
        "error",
        "PLAN_HAS_ERRORS",
        "O plano contem recursos em estado de erro e nao pode ser aplicado.",
      ),
    );
  }
}

/**
 * Validates a normalized snapshot and planner output before the first Discord
 * mutation. Administrator is honored for permission possession, but never as
 * a role-hierarchy bypass.
 */
export function preflightPlan({ plan, snapshot }) {
  if (!plan || !Array.isArray(plan.operations)) {
    throw new TypeError("Plano invalido para preflight.");
  }
  if (!snapshot?.guild || !snapshot?.botMember) {
    throw new TypeError("Snapshot invalido para preflight.");
  }

  const diagnostics = [];
  const diagnosticKeys = new Set();
  const add = (diagnostic) => {
    const key = [
      diagnostic.severity,
      diagnostic.code,
      diagnostic.operationId,
      diagnostic.resourceKey,
      diagnostic.resourceId,
      diagnostic.message,
    ].join("|");
    if (diagnosticKeys.has(key)) return;
    diagnosticKeys.add(key);
    diagnostics.push(diagnostic);
  };

  addPlanDiagnostics(plan, add);

  let botPermissions = 0n;
  try {
    botPermissions = BigInt(snapshot.botMember.permissions ?? 0);
  } catch {
    add(
      makeDiagnostic(
        "error",
        "INVALID_BOT_PERMISSION_BITFIELD",
        "O bitfield de permissoes do bot no snapshot e invalido.",
      ),
    );
  }

  const administrator =
    (botPermissions & PermissionFlagsBits.Administrator) ===
    PermissionFlagsBits.Administrator;
  const botHas = (permission) =>
    administrator ||
    (botPermissions & PermissionFlagsBits[permission]) ===
      PermissionFlagsBits[permission];

  const requiredByPermission = new Map();
  const requirePermission = (permission, operation) => {
    if (!requiredByPermission.has(permission)) {
      requiredByPermission.set(permission, new Set());
    }
    requiredByPermission.get(permission).add(operation.id);
  };

  const operationIds = new Set(plan.operations.map((operation) => operation.id));
  const createRoleKeys = new Set(
    plan.operations
      .filter((operation) => operation.action === "CREATE_ROLE")
      .map((operation) => operation.targetKey),
  );
  const createCategoryKeys = new Set(
    plan.operations
      .filter((operation) => operation.action === "CREATE_CATEGORY")
      .map((operation) => operation.targetKey),
  );
  const createChannelKeys = new Set(
    plan.operations
      .filter((operation) => operation.action === "CREATE_CHANNEL")
      .map((operation) => operation.targetKey),
  );

  const botHighestPosition = Number(snapshot.botMember.highestRolePosition);
  const hierarchyChecked = new Set();
  const checkRoleHierarchy = (roleKey, operation) => {
    if (!roleKey || roleKey === "everyone") return;
    const roleId = resolutionGet(plan.resolution?.roles, roleKey);
    if (!roleId) {
      if (!createRoleKeys.has(roleKey)) {
        add(
          makeDiagnostic(
            "error",
            "UNRESOLVED_ROLE",
            `O cargo ${roleKey} nao existe e nao sera criado por este plano.`,
            { operationId: operation.id, resourceKey: roleKey },
          ),
        );
      }
      return;
    }

    const checkKey = `${roleKey}:${roleId}`;
    if (hierarchyChecked.has(checkKey)) return;
    hierarchyChecked.add(checkKey);
    const role = currentRole(snapshot, roleId);
    if (!role) {
      add(
        makeDiagnostic(
          "error",
          "ROLE_MISSING_FROM_SNAPSHOT",
          `O cargo ${roleKey} (${roleId}) nao esta no snapshot atual.`,
          { operationId: operation.id, resourceKey: roleKey, resourceId: roleId },
        ),
      );
      return;
    }
    if (role.managed) {
      add(
        makeDiagnostic(
          "error",
          "MANAGED_ROLE_NOT_EDITABLE",
          `O cargo ${role.name} e gerenciado por uma integracao.`,
          { operationId: operation.id, resourceKey: roleKey, resourceId: roleId },
        ),
      );
    }
    if (role.editable === false) {
      add(
        makeDiagnostic(
          "error",
          "ROLE_NOT_EDITABLE",
          `O Discord informa que o cargo ${role.name} nao e editavel pelo bot.`,
          { operationId: operation.id, resourceKey: roleKey, resourceId: roleId },
        ),
      );
    }
    if (
      !Number.isFinite(botHighestPosition) ||
      Number(role.position) >= botHighestPosition
    ) {
      add(
        makeDiagnostic(
          "error",
          "ROLE_ABOVE_BOT",
          `O cargo ${role.name} precisa ficar estritamente abaixo do cargo mais alto do bot; Administrator nao ignora a hierarquia.`,
          { operationId: operation.id, resourceKey: roleKey, resourceId: roleId },
        ),
      );
    }
  };

  const checkManageableResource = (
    type,
    key,
    operation,
    requireManageChannels = true,
  ) => {
    const resolution =
      type === "category"
        ? plan.resolution?.categories
        : plan.resolution?.channels;
    const resourceId = resolutionGet(resolution, key);
    const isCreate =
      (type === "category" && createCategoryKeys.has(key)) ||
      (type === "channel" && createChannelKeys.has(key));
    if (!resourceId) {
      if (!isCreate) {
        add(
          makeDiagnostic(
            "error",
            "UNRESOLVED_CHANNEL_RESOURCE",
            `${type === "category" ? "A categoria" : "O canal"} ${key} nao foi resolvido e nao sera criado.`,
            { operationId: operation.id, resourceKey: key },
          ),
        );
      }
      return;
    }
    const resource = currentResource(snapshot, type, resourceId);
    if (!resource) {
      add(
        makeDiagnostic(
          "error",
          "CHANNEL_RESOURCE_MISSING_FROM_SNAPSHOT",
          `${type === "category" ? "A categoria" : "O canal"} ${key} (${resourceId}) nao esta no snapshot atual.`,
          { operationId: operation.id, resourceKey: key, resourceId },
        ),
      );
    } else if (requireManageChannels && resource.manageable === false) {
      add(
        makeDiagnostic(
          "error",
          "CHANNEL_RESOURCE_NOT_MANAGEABLE",
          `${resource.name} nao e gerenciavel pelo bot no estado atual.`,
          { operationId: operation.id, resourceKey: key, resourceId },
        ),
      );
    }
  };

  for (const operation of plan.operations) {
    if (/DELETE|REMOVE/u.test(operation.action)) {
      add(
        makeDiagnostic(
          "error",
          "DESTRUCTIVE_OPERATION_BLOCKED",
          `Operacao destrutiva bloqueada: ${operation.action}.`,
          { operationId: operation.id, resourceKey: operation.targetKey },
        ),
      );
    }
    const expectedPhases = PHASES_BY_ACTION.get(operation.action);
    if (!expectedPhases) {
      add(
        makeDiagnostic(
          "error",
          "UNSUPPORTED_OPERATION",
          `Operacao nao suportada: ${operation.action}.`,
          { operationId: operation.id, resourceKey: operation.targetKey },
        ),
      );
      continue;
    }
    if (!expectedPhases.has(Number(operation.phase))) {
      add(
        makeDiagnostic(
          "error",
          "INVALID_OPERATION_PHASE",
          `${operation.action} apareceu na fase ${operation.phase}; fases validas: ${[...expectedPhases].join(", ")}.`,
          { operationId: operation.id, resourceKey: operation.targetKey },
        ),
      );
    }
    for (const dependency of operation.dependsOn ?? []) {
      if (operationIds.has(dependency)) continue;
      // Planner dependencies are conditional: a create dependency legitimately
      // does not exist when the resource was matched instead of created.
      if (!dependency.endsWith(".create")) {
        add(
          makeDiagnostic(
            "error",
            "UNKNOWN_OPERATION_DEPENDENCY",
            `${operation.id} depende de uma operacao inexistente: ${dependency}.`,
            { operationId: operation.id, resourceKey: operation.targetKey },
          ),
        );
      }
    }

    if (ROLE_ACTIONS.has(operation.action)) {
      requirePermission("ManageRoles", operation);
    }
    if (CHANNEL_ACTIONS.has(operation.action)) {
      requirePermission("ManageChannels", operation);
    }

    if (operation.action === "CREATE_ROLE") {
      const desired = BigInt(operation.payload?.permissions ?? 0);
      const missing = administrator ? 0n : desired & ~botPermissions;
      if (missing !== 0n) {
        add(
          makeDiagnostic(
            "error",
            "CANNOT_GRANT_ROLE_PERMISSIONS",
            `O bot nao possui as permissoes que o novo cargo receberia: ${permissionNamesForBits(missing).join(", ")}.`,
            { operationId: operation.id, resourceKey: operation.targetKey },
          ),
        );
      }
    }

    if (operation.action === "UPDATE_ROLE") {
      checkRoleHierarchy(operation.targetKey, operation);
      if (operation.payload?.permissions !== undefined) {
        const roleId = resolutionGet(plan.resolution?.roles, operation.targetKey);
        const role = currentRole(snapshot, roleId);
        if (role) {
          const desired = BigInt(operation.payload.permissions);
          const added = desired & ~BigInt(role.permissions ?? 0);
          const missing = administrator ? 0n : added & ~botPermissions;
          if (missing !== 0n) {
            add(
              makeDiagnostic(
                "error",
                "CANNOT_GRANT_ROLE_PERMISSIONS",
                `O bot nao possui as novas permissoes que seriam concedidas a ${role.name}: ${permissionNamesForBits(missing).join(", ")}.`,
                {
                  operationId: operation.id,
                  resourceKey: operation.targetKey,
                  resourceId: roleId,
                },
              ),
            );
          }
        }
      }
    }

    if (operation.action === "REORDER_ROLES") {
      for (const roleKey of operation.payload?.keys ?? []) {
        checkRoleHierarchy(roleKey, operation);
      }
    }

    if (operation.action === "EDIT_OVERWRITE") {
      checkRoleHierarchy(operation.payload?.roleKey, operation);
      // Discord gates overwrite edits with ManageRoles. Channel#manageable is
      // based on ManageChannels, so it must not reject this operation.
      checkManageableResource(
        operation.targetType,
        operation.targetKey,
        operation,
        false,
      );
      const unavailable = [];
      for (const [permission, value] of Object.entries(
        operation.payload?.permissions ?? {},
      )) {
        if (!(permission in PermissionFlagsBits)) {
          add(
            makeDiagnostic(
              "error",
              "UNKNOWN_OVERWRITE_PERMISSION",
              `Permissao desconhecida no overwrite: ${permission}.`,
              { operationId: operation.id, resourceKey: operation.targetKey },
            ),
          );
        } else if (value !== null && !botHas(permission)) {
          unavailable.push(permission);
        }
      }
      if (unavailable.length > 0) {
        add(
          makeDiagnostic(
            "error",
            "CANNOT_SET_OVERWRITE_PERMISSIONS",
            `O bot nao pode conceder ou negar permissoes que nao possui: ${unavailable.join(", ")}.`,
            { operationId: operation.id, resourceKey: operation.targetKey },
          ),
        );
      }
    }

    if (["UPDATE_CATEGORY", "UPDATE_CHANNEL", "MOVE_CHANNEL", "UPDATE_CHANNEL_SETTINGS"].includes(operation.action)) {
      checkManageableResource(operation.targetType, operation.targetKey, operation);
    }

    if (operation.action === "REORDER_CATEGORIES") {
      for (const categoryKey of operation.payload?.keys ?? []) {
        checkManageableResource("category", categoryKey, operation);
      }
    }

    if (operation.action === "REORDER_CHANNELS") {
      for (const channelKey of operation.payload?.keys ?? []) {
        checkManageableResource("channel", channelKey, operation);
      }
    }

    if (
      operation.action === "CREATE_CHANNEL" &&
      COMMUNITY_CHANNEL_TYPES.has(operation.payload?.type) &&
      snapshot.guild.communityEnabled !== true &&
      !(snapshot.guild.features ?? []).includes("COMMUNITY")
    ) {
      add(
        makeDiagnostic(
          "error",
          "COMMUNITY_FEATURE_REQUIRED",
          `${operation.payload.type} exige que o recurso Community esteja habilitado na guild.`,
          { operationId: operation.id, resourceKey: operation.targetKey },
        ),
      );
    }

    if (
      operation.action === "UPDATE_CHANNEL_SETTINGS" &&
      Array.isArray(operation.payload?.availableTags)
    ) {
      const resourceId = operationResourceId(plan, operation);
      // The planner resolves managed and preserved unmanaged tags into one
      // complete payload. Counting snapshot extras again would double-count.
      const resultingCount = operation.payload.availableTags.length;
      if (resultingCount > 20) {
        add(
          makeDiagnostic(
            "error",
            "FORUM_TAG_LIMIT_EXCEEDED",
            `A atualizacao preservaria tags extras e resultaria em ${resultingCount} tags; o limite e 20.`,
            { operationId: operation.id, resourceKey: operation.targetKey, resourceId },
          ),
        );
      }
    }
  }

  for (const [permission, operationSet] of requiredByPermission) {
    if (botHas(permission)) continue;
    add(
      makeDiagnostic(
        "error",
        `MISSING_${permission.toUpperCase()}`,
        `O bot precisa de ${permission} para: ${[...operationSet].join(", ")}.`,
      ),
    );
  }

  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    diagnostics,
    requiredPermissions: [...requiredByPermission.keys()].sort(),
  };
}

export const runPreflight = preflightPlan;
