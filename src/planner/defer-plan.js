function resolutionGet(resolution, key) {
  if (resolution instanceof Map) return resolution.get(key) ?? null;
  return resolution?.[key] ?? null;
}

function normalizeRoleKeys(roleKeys) {
  if (roleKeys === undefined || roleKeys === null) return [];
  if (!Array.isArray(roleKeys) && !(roleKeys instanceof Set)) {
    throw new TypeError("deferRoleKeys deve ser um array ou Set.");
  }
  const normalized = [...new Set([...roleKeys].map((key) => String(key).trim()))]
    .filter(Boolean);
  if (normalized.includes("everyone")) {
    throw deferralError("O cargo especial everyone nao pode ser adiado.");
  }
  return normalized;
}

function deferralError(message) {
  const error = new Error(message);
  error.name = "PlanDeferralError";
  error.code = "INVALID_ROLE_DEFERRAL";
  return error;
}

function deferredOverwritePath(path, roleKeys) {
  for (const key of roleKeys) {
    if (path.startsWith(`overwrites.${key}.`)) return true;
  }
  return false;
}

function filterHierarchyValue(value, roleKeys) {
  if (!Array.isArray(value)) return value;
  return value.filter((key) => !roleKeys.has(key));
}

function recomputeSummary(entries, diagnostics) {
  const count = (status) => entries.filter((entry) => entry.status === status).length;
  const entryErrorKeys = new Set(
    entries
      .filter((entry) => entry.status === "ERROR" && entry.resourceKey)
      .map((entry) => entry.resourceKey),
  );
  const unrepresentedErrors = diagnostics.filter(
    (item) =>
      item.severity === "error" &&
      (!item.resourceKey || !entryErrorKeys.has(item.resourceKey)),
  ).length;
  return {
    create: count("CREATE"),
    update: count("UPDATE"),
    deferred: count("DEFERRED"),
    ok: count("OK"),
    unmanaged: count("UNMANAGED"),
    error: count("ERROR") + unrepresentedErrors,
    delete: 0,
  };
}

/**
 * Produces an effective plan that temporarily leaves explicitly named,
 * already-existing roles untouched. It never suppresses planner errors and
 * never permits deferring a missing role/create operation.
 */
export function deferPlanRoles(plan, { roleKeys = [] } = {}) {
  if (!plan || !Array.isArray(plan.entries) || !Array.isArray(plan.operations)) {
    throw new TypeError("Plano invalido para adiamento de cargos.");
  }
  const normalizedKeys = normalizeRoleKeys(roleKeys);
  if (normalizedKeys.length === 0) return plan;

  const deferred = new Set(normalizedKeys);
  for (const key of deferred) {
    const entry = plan.entries.find(
      (item) => item.resourceType === "role" && item.resourceKey === key,
    );
    if (!entry) {
      throw deferralError(`Cargo desconhecido para --defer-role: ${key}.`);
    }
    if (entry.status === "ERROR") {
      throw deferralError(
        `O cargo ${key} possui erro de planejamento e nao pode ser adiado.`,
      );
    }
    if (!resolutionGet(plan.resolution?.roles, key)) {
      throw deferralError(
        `O cargo ${key} ainda nao existe; --defer-role aceita apenas cargos existentes.`,
      );
    }
  }

  const removedOperationIds = new Set();
  const operations = [];
  for (const operation of plan.operations) {
    if (
      (operation.action === "UPDATE_ROLE" && deferred.has(operation.targetKey)) ||
      (operation.action === "EDIT_OVERWRITE" &&
        deferred.has(operation.payload?.roleKey))
    ) {
      removedOperationIds.add(operation.id);
      continue;
    }
    if (operation.action === "REORDER_ROLES") {
      const keys = (operation.payload?.keys ?? []).filter(
        (key) => !deferred.has(key),
      );
      if (keys.length < 2) {
        removedOperationIds.add(operation.id);
        continue;
      }
      operations.push({
        ...operation,
        payload: { ...operation.payload, keys },
      });
      continue;
    }
    operations.push({ ...operation });
  }

  const effectiveOperations = operations.map((operation) => ({
    ...operation,
    dependsOn: (operation.dependsOn ?? []).filter(
      (dependency) => !removedOperationIds.has(dependency),
    ),
  }));
  const hasRoleReorder = effectiveOperations.some(
    (operation) => operation.action === "REORDER_ROLES",
  );

  const entries = plan.entries.map((original) => {
    const entry = {
      ...original,
      changes: (original.changes ?? [])
        .filter((change) => !deferredOverwritePath(change.path, deferred))
        .map((change) => {
          if (original.resourceType !== "roleHierarchy") return { ...change };
          return {
            ...change,
            from: filterHierarchyValue(change.from, deferred),
            to: filterHierarchyValue(change.to, deferred),
          };
        }),
    };
    if (original.resourceType === "role" && deferred.has(original.resourceKey)) {
      entry.status = "DEFERRED";
      return entry;
    }
    if (original.resourceType === "roleHierarchy" && !hasRoleReorder) {
      entry.changes = [];
    }
    if (entry.status === "UPDATE" && entry.changes.length === 0) {
      entry.status = "OK";
    }
    return entry;
  });

  const diagnostics = [
    ...(plan.diagnostics ?? []),
    ...normalizedKeys.map((key) => {
      const entry = entries.find(
        (item) => item.resourceType === "role" && item.resourceKey === key,
      );
      return {
        severity: "warning",
        code: "ROLE_DEFERRED_BY_OPTION",
        path: null,
        resourceKey: key,
        resourceId: entry?.resourceId ?? null,
        message:
          `Cargo ${entry?.name ?? key} adiado por --defer-role; edicao, ` +
          "reordenacao e overwrites desse cargo nao serao aplicados nesta execucao.",
      };
    }),
  ];
  const summary = recomputeSummary(entries, diagnostics);

  return {
    ...plan,
    entries,
    operations: effectiveOperations,
    diagnostics,
    summary,
    hasChanges: effectiveOperations.length > 0,
    hasErrors:
      summary.error > 0 || diagnostics.some((item) => item.severity === "error"),
    hasDeferred: true,
    deferredRoleKeys: normalizedKeys,
  };
}

export default deferPlanRoles;
