import {
  permissionNames,
  permissionState,
} from "../utils/permissions.js";

export function materializeOverwrites(category = {}, channel = {}) {
  const categoryMap = overwriteListToMap(category);
  const channelMap = overwriteListToMap(channel);
  const result = new Map();
  for (const [targetKey, patch] of Object.entries(categoryMap)) {
    result.set(targetKey, { ...patch });
  }
  for (const [targetKey, patch] of Object.entries(channelMap)) {
    result.set(targetKey, {
      ...(result.get(targetKey) ?? {}),
      ...patch,
    });
  }
  return Object.fromEntries(result);
}

export function overwriteListToMap(overwrites = []) {
  if (!Array.isArray(overwrites)) return { ...(overwrites ?? {}) };
  const result = {};
  for (const overwrite of overwrites) {
    if (!overwrite?.target) {
      throw new Error("Overwrite sem target.");
    }
    if (Object.hasOwn(result, overwrite.target)) {
      throw new Error(`Overwrite duplicado para ${overwrite.target}.`);
    }
    const patch = {};
    for (const permission of overwrite.allow ?? []) patch[permission] = true;
    for (const permission of overwrite.deny ?? []) {
      if (patch[permission] === true) {
        throw new Error(
          `${overwrite.target}.${permission} aparece em allow e deny.`,
        );
      }
      patch[permission] = false;
    }
    result[overwrite.target] = patch;
  }
  return result;
}

export function overwriteChanges({ desiredPatch, currentOverwrite }) {
  const changes = [];
  const options = {};

  for (const [permission, desiredState] of Object.entries(desiredPatch)) {
    if (!permissionNames.has(permission)) {
      throw new Error(`Permissao desconhecida em overwrite: ${permission}`);
    }
    const currentState = permissionState(currentOverwrite, permission);
    if (currentState !== desiredState) {
      changes.push({
        path: permission,
        from: currentState,
        to: desiredState,
      });
      options[permission] = desiredState;
    }
  }

  return { changes, options };
}

export function canonicalizeOverwrites(overwrites = []) {
  return [...overwrites]
    .map((overwrite) => ({
      targetType: String(overwrite.targetType ?? overwrite.type ?? "unknown"),
      targetId: String(overwrite.targetId ?? overwrite.id ?? ""),
      allow: BigInt(overwrite.allow ?? 0).toString(),
      deny: BigInt(overwrite.deny ?? 0).toString(),
    }))
    .sort(
      (left, right) =>
        left.targetType.localeCompare(right.targetType) ||
        left.targetId.localeCompare(right.targetId),
    );
}
