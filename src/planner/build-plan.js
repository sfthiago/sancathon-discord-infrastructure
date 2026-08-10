import {
  colorToNumber,
  encodePermissions,
  permissionEntries,
} from "../utils/permissions.js";
import { isCandidateName } from "../utils/names.js";
import { matchResources } from "./match-resources.js";
import {
  materializeOverwrites,
  overwriteChanges,
} from "./overwrites.js";

const STATUS_PRIORITY = {
  OK: 0,
  UNMANAGED: 1,
  UPDATE: 2,
  CREATE: 3,
  ERROR: 4,
};

function planEntry({
  id,
  status = "OK",
  resourceType,
  resourceKey = null,
  resourceId = null,
  name,
  changes = [],
}) {
  return {
    id,
    status,
    resourceType,
    resourceKey,
    resourceId,
    name,
    changes,
  };
}

function promoteEntry(entry, status) {
  if (STATUS_PRIORITY[status] > STATUS_PRIORITY[entry.status]) {
    entry.status = status;
  }
}

function addChange(entry, path, from, to) {
  entry.changes.push({ path, from, to });
  if (entry.status === "OK") promoteEntry(entry, "UPDATE");
}

function operation({ id, phase, action, targetType, targetKey, payload = {}, dependsOn = [] }) {
  return { id, phase, action, targetType, targetKey, payload, dependsOn };
}

function sameSequence(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mergeDiagnostic(target, diagnostic) {
  target.push({ path: null, ...diagnostic });
}

function matchDiagnosticsToEntries({ diagnostics, entries, desiredByKey, resourceType }) {
  for (const diagnostic of diagnostics) {
    mergeDiagnostic(entries.diagnostics, diagnostic);
    if (diagnostic.severity !== "error" || !diagnostic.resourceKey) continue;
    if (entries.byKey.has(`${resourceType}:${diagnostic.resourceKey}`)) continue;
    const desired = desiredByKey.get(diagnostic.resourceKey);
    entries.add(
      planEntry({
        id: `${resourceType}.${diagnostic.resourceKey}`,
        status: "ERROR",
        resourceType,
        resourceKey: diagnostic.resourceKey,
        resourceId: diagnostic.resourceId ?? null,
        name: desired?.name ?? diagnostic.resourceKey,
        changes: [{ path: "matching", from: null, to: diagnostic.message }],
      }),
    );
  }
}

function makeEntryStore() {
  const list = [];
  const byKey = new Map();
  return {
    list,
    byKey,
    diagnostics: [],
    add(entry) {
      list.push(entry);
      if (entry.resourceKey) byKey.set(`${entry.resourceType}:${entry.resourceKey}`, entry);
      return entry;
    },
    get(type, key) {
      return byKey.get(`${type}:${key}`);
    },
  };
}

function roleDesiredItems(config) {
  return config.roles.roles.filter((role) => role.kind !== "default");
}

function enabledChannels(config) {
  return config.channels.channels.filter((channel) => channel.enabled !== false);
}

function hasOverwritePatch(overwrites) {
  if (Array.isArray(overwrites)) return overwrites.length > 0;
  return Object.keys(overwrites ?? {}).length > 0;
}

function buildRolePlan({ config, snapshot, state, entries, operations }) {
  const desired = roleDesiredItems(config);
  const current = snapshot.roles.filter((role) => role.id !== snapshot.guild.id);
  const result = matchResources({
    desired,
    current,
    stateIds: state.roles,
  });
  const desiredByKey = new Map(desired.map((item) => [item.key, item]));

  matchDiagnosticsToEntries({
    diagnostics: result.diagnostics,
    entries,
    desiredByKey,
    resourceType: "role",
  });

  const erroredKeys = new Set(
    result.diagnostics
      .filter((item) => item.severity === "error")
      .map((item) => item.resourceKey),
  );

  for (const role of desired) {
    if (erroredKeys.has(role.key)) continue;
    const match = result.matches.get(role.key);
    const desiredPermissions = encodePermissions(role.permissions).toString();
    if (!match) {
      entries.add(
        planEntry({
          id: `role.${role.key}`,
          status: "CREATE",
          resourceType: "role",
          resourceKey: role.key,
          name: role.name,
          changes: [{ path: "resource", from: null, to: role.name }],
        }),
      );
      operations.push(
        operation({
          id: `role.${role.key}.create`,
          phase: 1,
          action: "CREATE_ROLE",
          targetType: "role",
          targetKey: role.key,
          payload: { ...role, permissions: desiredPermissions },
        }),
      );
      continue;
    }

    const currentRole = match.current;
    const entry = entries.add(
      planEntry({
        id: `role.${role.key}`,
        resourceType: "role",
        resourceKey: role.key,
        resourceId: currentRole.id,
        name: role.name,
      }),
    );

    if (currentRole.managed) {
      promoteEntry(entry, "ERROR");
      addChange(entry, "managed", true, false);
      mergeDiagnostic(entries.diagnostics, {
        severity: "error",
        code: "MANAGED_ROLE_NOT_EDITABLE",
        resourceKey: role.key,
        resourceId: currentRole.id,
        message: `${currentRole.name} e gerenciado por integracao e nao pode ser editado.`,
      });
      continue;
    }

    const payload = {};
    if (currentRole.name !== role.name) {
      addChange(entry, "name", currentRole.name, role.name);
      payload.name = role.name;
    }
    const desiredColor = colorToNumber(role.color);
    const currentColor = Number(currentRole.colors?.primaryColor ?? 0);
    if (currentColor !== desiredColor) {
      addChange(entry, "color", currentRole.hexColor, role.color ?? null);
      payload.color = desiredColor;
    }
    for (const property of ["hoist", "mentionable"]) {
      if (Boolean(currentRole[property]) !== Boolean(role[property])) {
        addChange(entry, property, currentRole[property], role[property]);
        payload[property] = Boolean(role[property]);
      }
    }
    if (BigInt(currentRole.permissions) !== BigInt(desiredPermissions)) {
      if (BigInt(currentRole.unknownPermissions ?? 0) !== 0n) {
        promoteEntry(entry, "ERROR");
        mergeDiagnostic(entries.diagnostics, {
          severity: "error",
          code: "UNKNOWN_ROLE_PERMISSION_BITS",
          resourceKey: role.key,
          resourceId: currentRole.id,
          message: `${currentRole.name} possui bits de permissao desconhecidos; update bloqueado.`,
        });
      } else {
        addChange(
          entry,
          "permissions",
          currentRole.permissionNames,
          role.permissions,
        );
        payload.permissions = desiredPermissions;
      }
    }

    if (entry.status === "UPDATE") {
      operations.push(
        operation({
          id: `role.${role.key}.update`,
          phase: 1,
          action: "UPDATE_ROLE",
          targetType: "role",
          targetKey: role.key,
          payload,
        }),
      );
    }
  }

  for (const unmanaged of result.unmatchedCurrent) {
    entries.add(
      planEntry({
        id: `role.unmanaged.${unmanaged.id}`,
        status: "UNMANAGED",
        resourceType: "role",
        resourceId: unmanaged.id,
        name: unmanaged.name,
      }),
    );
  }

  const matchedKeysByCurrentOrder = [...result.matches.values()]
    .filter((match) => match.current)
    .sort((left, right) => right.current.position - left.current.position)
    .map((match) => match.desired.key);
  const desiredExistingOrder = config.roles.hierarchy.filter((key) =>
    result.matches.has(key),
  );
  const needsHierarchy =
    result.unmatchedDesired.length > 0 ||
    !sameSequence(matchedKeysByCurrentOrder, desiredExistingOrder);
  if (needsHierarchy) {
    entries.add(
      planEntry({
        id: "role.hierarchy",
        status: "UPDATE",
        resourceType: "roleHierarchy",
        name: "Hierarquia dos cargos",
        changes: [
          {
            path: "relativeOrder",
            from: matchedKeysByCurrentOrder,
            to: config.roles.hierarchy,
          },
        ],
      }),
    );
    operations.push(
      operation({
        id: "role.hierarchy.update",
        phase: 2,
        action: "REORDER_ROLES",
        targetType: "roleHierarchy",
        targetKey: "hierarchy",
        payload: { keys: config.roles.hierarchy },
      }),
    );
  }

  const roleResolution = new Map();
  roleResolution.set("everyone", snapshot.guild.id);
  for (const role of desired) {
    roleResolution.set(role.key, result.matches.get(role.key)?.current.id ?? null);
  }
  return { result, roleResolution };
}

function buildCategoryPlan({ config, snapshot, state, entries, operations }) {
  const desired = config.channels.categories;
  const result = matchResources({
    desired,
    // Categories are channels in Discord. Include other channel types during
    // matching so a same-name resource with an incompatible type blocks a
    // duplicate CREATE instead of being silently ignored.
    current: [...snapshot.categories, ...snapshot.channels],
    stateIds: state.categories,
    isCompatible: (wanted, actual) => wanted.type === actual.typeName,
  });
  const desiredByKey = new Map(desired.map((item) => [item.key, item]));
  matchDiagnosticsToEntries({
    diagnostics: result.diagnostics,
    entries,
    desiredByKey,
    resourceType: "category",
  });
  const erroredKeys = new Set(
    result.diagnostics
      .filter((item) => item.severity === "error")
      .map((item) => item.resourceKey),
  );

  for (const category of desired) {
    if (erroredKeys.has(category.key)) continue;
    const match = result.matches.get(category.key);
    if (!match) {
      entries.add(
        planEntry({
          id: `category.${category.key}`,
          status: "CREATE",
          resourceType: "category",
          resourceKey: category.key,
          name: category.name,
          changes: [{ path: "resource", from: null, to: category.name }],
        }),
      );
      operations.push(
        operation({
          id: `category.${category.key}.create`,
          phase: 3,
          action: "CREATE_CATEGORY",
          targetType: "category",
          targetKey: category.key,
          payload: { name: category.name },
        }),
      );
      continue;
    }
    const entry = entries.add(
      planEntry({
        id: `category.${category.key}`,
        resourceType: "category",
        resourceKey: category.key,
        resourceId: match.current.id,
        name: category.name,
      }),
    );
    if (match.current.name !== category.name) {
      addChange(entry, "name", match.current.name, category.name);
      operations.push(
        operation({
          id: `category.${category.key}.update`,
          phase: 3,
          action: "UPDATE_CATEGORY",
          targetType: "category",
          targetKey: category.key,
          payload: { name: category.name },
        }),
      );
    }
  }
  for (const unmanaged of result.unmatchedCurrent.filter(
    (resource) => resource.typeName === "GuildCategory",
  )) {
    entries.add(
      planEntry({
        id: `category.unmanaged.${unmanaged.id}`,
        status: "UNMANAGED",
        resourceType: "category",
        resourceId: unmanaged.id,
        name: unmanaged.name,
      }),
    );
  }

  const currentOrder = [...result.matches.values()]
    .filter((match) => match.current)
    .sort((left, right) => left.current.position - right.current.position)
    .map((match) => match.desired.key);
  const desiredExistingOrder = [...desired]
    .sort((left, right) => left.order - right.order)
    .filter((category) => result.matches.has(category.key))
    .map((category) => category.key);
  if (
    result.unmatchedDesired.length > 0 ||
    !sameSequence(currentOrder, desiredExistingOrder)
  ) {
    const entry = entries.get("category", "start");
    if (entry && entry.status === "OK") {
      addChange(entry, "categoryOrder", currentOrder, desiredExistingOrder);
    }
    operations.push(
      operation({
        id: "category.order.update",
        phase: 5,
        action: "REORDER_CATEGORIES",
        targetType: "categoryHierarchy",
        targetKey: "categories",
        payload: {
          keys: [...desired]
            .sort((left, right) => left.order - right.order)
            .map((category) => category.key),
        },
      }),
    );
  }

  const categoryResolution = new Map();
  for (const category of desired) {
    categoryResolution.set(
      category.key,
      result.matches.get(category.key)?.current.id ?? null,
    );
  }
  return { result, categoryResolution };
}

function forumTagChanges(desiredTags = [], currentTags = []) {
  const changes = [];
  const ambiguous = [];
  const claimedCurrentIds = new Set();
  const resolvedManaged = [];
  for (const desiredTag of desiredTags) {
    const candidates = currentTags.filter(
      (tag) =>
        !claimedCurrentIds.has(tag.id) &&
        isCandidateName(desiredTag, tag.name),
    );
    if (candidates.length > 1) {
      ambiguous.push({ desiredTag, candidates });
      continue;
    }
    const [currentTag] = candidates;
    if (!currentTag) {
      changes.push({ path: `availableTags.${desiredTag.key}`, from: null, to: desiredTag.name });
      resolvedManaged.push({
        name: desiredTag.name,
        aliases: desiredTag.aliases ?? [],
        moderated: desiredTag.moderated ?? false,
        emoji: desiredTag.emoji ?? null,
      });
      continue;
    }

    claimedCurrentIds.add(currentTag.id);
    if (currentTag.name !== desiredTag.name) {
      changes.push({
        path: `availableTags.${desiredTag.key}.name`,
        from: currentTag.name,
        to: desiredTag.name,
      });
    }
    resolvedManaged.push({
      id: currentTag.id,
      name: desiredTag.name,
      aliases: desiredTag.aliases ?? [],
      moderated: desiredTag.moderated ?? currentTag.moderated ?? false,
      emoji: desiredTag.emoji ?? currentTag.emoji ?? null,
    });
  }
  const unmanaged = currentTags.filter((tag) => !claimedCurrentIds.has(tag.id));
  const resolvedUnmanaged = unmanaged.map((tag) => ({
    id: tag.id,
    name: tag.name,
    moderated: tag.moderated ?? false,
    emoji: tag.emoji ?? null,
  }));
  return {
    changes,
    unmanaged,
    ambiguous,
    resolvedTags: [...resolvedManaged, ...resolvedUnmanaged],
  };
}

function buildChannelPlan({
  config,
  snapshot,
  state,
  entries,
  operations,
  categoryResolution,
  roleResolution,
}) {
  const desired = enabledChannels(config);
  const channelStateIds = { ...state.channels };
  if (snapshot.guild.publicUpdatesChannelId && !channelStateIds.discordUpdates) {
    channelStateIds.discordUpdates = snapshot.guild.publicUpdatesChannelId;
  }
  const result = matchResources({
    desired,
    // Include categories only for mismatch detection. They are filtered from
    // the UNMANAGED channel list below because categories have their own plan.
    current: [...snapshot.channels, ...snapshot.categories],
    stateIds: channelStateIds,
    isCompatible: (wanted, actual) => wanted.type === actual.typeName,
    candidateScoreBonus: (wanted, actual) => {
      const desiredParentId = categoryResolution.get(wanted.categoryKey);
      return desiredParentId && actual.parentId === desiredParentId ? 3 : 0;
    },
  });
  const desiredByKey = new Map(desired.map((item) => [item.key, item]));
  const categoryByKey = new Map(
    config.channels.categories.map((category) => [category.key, category]),
  );
  const managedRoleIds = new Set(
    [...roleResolution.values()].filter(Boolean),
  );
  matchDiagnosticsToEntries({
    diagnostics: result.diagnostics,
    entries,
    desiredByKey,
    resourceType: "channel",
  });
  const erroredKeys = new Set(
    result.diagnostics
      .filter((item) => item.severity === "error")
      .map((item) => item.resourceKey),
  );

  for (const channel of desired) {
    if (erroredKeys.has(channel.key)) continue;
    const match = result.matches.get(channel.key);
    if (!match) {
      const categoryEntry = entries.get("category", channel.categoryKey);
      if (categoryEntry?.status === "ERROR") {
        entries.add(
          planEntry({
            id: `channel.${channel.key}`,
            status: "ERROR",
            resourceType: "channel",
            resourceKey: channel.key,
            name: channel.name,
            changes: [
              {
                path: "parent",
                from: null,
                to: `Categoria nao resolvida: ${channel.categoryKey}`,
              },
            ],
          }),
        );
        mergeDiagnostic(entries.diagnostics, {
          severity: "error",
          code: "CHANNEL_PARENT_UNRESOLVED",
          resourceKey: channel.key,
          message: `A categoria desejada de ${channel.name} nao pode ser resolvida.`,
        });
        continue;
      }
      const categoryCreateDependency =
        categoryEntry?.status === "CREATE"
          ? [`category.${channel.categoryKey}.create`]
          : [];
      entries.add(
        planEntry({
          id: `channel.${channel.key}`,
          status: "CREATE",
          resourceType: "channel",
          resourceKey: channel.key,
          name: channel.name,
          changes: [{ path: "resource", from: null, to: channel.name }],
        }),
      );
      operations.push(
        operation({
          id: `channel.${channel.key}.create`,
          phase: 4,
          action: "CREATE_CHANNEL",
          targetType: "channel",
          targetKey: channel.key,
          payload: {
            name: channel.name,
            type: channel.type,
            categoryKey: channel.categoryKey,
          },
          dependsOn: categoryCreateDependency,
        }),
      );
      if (channel.slowmode !== undefined || channel.availableTags) {
        const settingsPayload = {};
        if (channel.slowmode !== undefined) {
          settingsPayload.slowmode = Number(channel.slowmode);
        }
        if (channel.availableTags) {
          settingsPayload.availableTags = channel.availableTags.map((tag) => ({
            name: tag.name,
            aliases: tag.aliases ?? [],
            moderated: tag.moderated ?? false,
            emoji: tag.emoji ?? null,
          }));
        }
        operations.push(
          operation({
            id: `channel.${channel.key}.settings`,
            phase: 8,
            action: "UPDATE_CHANNEL_SETTINGS",
            targetType: "channel",
            targetKey: channel.key,
            payload: settingsPayload,
            dependsOn: [`channel.${channel.key}.create`],
          }),
        );
      }
      continue;
    }

    const current = match.current;
    const entry = entries.add(
      planEntry({
        id: `channel.${channel.key}`,
        resourceType: "channel",
        resourceKey: channel.key,
        resourceId: current.id,
        name: channel.name,
      }),
    );
    const identityPayload = {};
    if (current.name !== channel.name) {
      addChange(entry, "name", current.name, channel.name);
      identityPayload.name = channel.name;
    }
    if (Object.keys(identityPayload).length > 0) {
      operations.push(
        operation({
          id: `channel.${channel.key}.identity`,
          phase: 4,
          action: "UPDATE_CHANNEL",
          targetType: "channel",
          targetKey: channel.key,
          payload: identityPayload,
        }),
      );
    }

    const categoryEntry = entries.get("category", channel.categoryKey);
    const desiredParentId = categoryResolution.get(channel.categoryKey) ?? null;
    const parentWillBeCreated = categoryEntry?.status === "CREATE";
    const parentIsResolved = desiredParentId !== null || parentWillBeCreated;
    const needsParentMove = parentWillBeCreated
      ? true
      : desiredParentId !== null && current.parentId !== desiredParentId;
    if (parentIsResolved && needsParentMove) {
      const hasUnmanagedOverwrite = (current.permissionOverwrites ?? []).some(
        (overwrite) =>
          overwrite.targetType !== "role" ||
          !managedRoleIds.has(overwrite.id),
      );
      const desiredParentDisplay =
        desiredParentId ?? categoryByKey.get(channel.categoryKey)?.name ?? channel.categoryKey;
      addChange(entry, "parent", current.parentId, desiredParentDisplay);
      operations.push(
        operation({
          id: `channel.${channel.key}.parent`,
          phase: 5,
          action: "MOVE_CHANNEL",
          targetType: "channel",
          targetKey: channel.key,
          payload: {
            categoryKey: channel.categoryKey,
            lockPermissions:
              !hasOverwritePatch(channel.overwrites) &&
              (current.permissionsLocked === true || !hasUnmanagedOverwrite),
          },
          dependsOn: parentWillBeCreated
            ? [`category.${channel.categoryKey}.create`]
            : [],
        }),
      );
    } else if (categoryEntry?.status === "ERROR") {
      promoteEntry(entry, "ERROR");
      mergeDiagnostic(entries.diagnostics, {
        severity: "error",
        code: "CHANNEL_PARENT_UNRESOLVED",
        resourceKey: channel.key,
        resourceId: current.id,
        message: `A categoria desejada de ${channel.name} nao pode ser resolvida.`,
      });
    }

    const settingsPayload = {};
    if (
      channel.slowmode !== undefined &&
      Number(current.rateLimitPerUser ?? 0) !== Number(channel.slowmode)
    ) {
      addChange(
        entry,
        "slowmode",
        Number(current.rateLimitPerUser ?? 0),
        Number(channel.slowmode),
      );
      settingsPayload.slowmode = Number(channel.slowmode);
    }
    if (channel.availableTags) {
      const tagDiff = forumTagChanges(channel.availableTags, current.availableTags);
      if (tagDiff.ambiguous.length > 0) {
        promoteEntry(entry, "ERROR");
        for (const ambiguity of tagDiff.ambiguous) {
          mergeDiagnostic(entries.diagnostics, {
            severity: "error",
            code: "AMBIGUOUS_FORUM_TAG_MATCH",
            resourceKey: channel.key,
            resourceId: current.id,
            message: `Mais de uma tag corresponde a ${ambiguity.desiredTag.name} em ${channel.name}.`,
          });
        }
      }
      for (const change of tagDiff.changes) entry.changes.push(change);
      if (tagDiff.changes.length > 0 && tagDiff.ambiguous.length === 0) {
        promoteEntry(entry, "UPDATE");
        settingsPayload.availableTags = tagDiff.resolvedTags;
      }
      for (const extraTag of tagDiff.unmanaged) {
        entries.add(
          planEntry({
            id: `forumTag.unmanaged.${current.id}.${extraTag.id}`,
            status: "UNMANAGED",
            resourceType: "forumTag",
            resourceId: extraTag.id,
            name: `${channel.name}: ${extraTag.name}`,
          }),
        );
        mergeDiagnostic(entries.diagnostics, {
          severity: "warning",
          code: "UNMANAGED_FORUM_TAG",
          resourceKey: channel.key,
          resourceId: current.id,
          message: `Tag extra preservada em ${channel.name}: ${extraTag.name}.`,
        });
      }
    }
    if (Object.keys(settingsPayload).length > 0) {
      operations.push(
        operation({
          id: `channel.${channel.key}.settings`,
          phase: 8,
          action: "UPDATE_CHANNEL_SETTINGS",
          targetType: "channel",
          targetKey: channel.key,
          payload: settingsPayload,
        }),
      );
    }
  }

  for (const unmanaged of result.unmatchedCurrent.filter(
    (resource) => resource.typeName !== "GuildCategory",
  )) {
    entries.add(
      planEntry({
        id: `channel.unmanaged.${unmanaged.id}`,
        status: "UNMANAGED",
        resourceType: "channel",
        resourceId: unmanaged.id,
        name: unmanaged.name,
      }),
    );
  }

  for (const category of config.channels.categories) {
    const desiredChildren = desired
      .filter((channel) => channel.categoryKey === category.key)
      .sort((left, right) => left.order - right.order);
    const matchedChildren = desiredChildren
      .filter((channel) => result.matches.has(channel.key))
      .sort(
        (left, right) =>
          result.matches.get(left.key).current.position -
          result.matches.get(right.key).current.position,
      )
      .map((channel) => channel.key);
    const desiredMatched = desiredChildren
      .filter((channel) => result.matches.has(channel.key))
      .map((channel) => channel.key);
    if (
      desiredChildren.some((channel) => !result.matches.has(channel.key)) ||
      !sameSequence(matchedChildren, desiredMatched)
    ) {
      operations.push(
        operation({
          id: `channel.order.${category.key}`,
          phase: 5,
          action: "REORDER_CHANNELS",
          targetType: "channelHierarchy",
          targetKey: category.key,
          payload: { keys: desiredChildren.map((channel) => channel.key) },
        }),
      );
    }
  }

  const channelResolution = new Map();
  for (const channel of desired) {
    channelResolution.set(
      channel.key,
      result.matches.get(channel.key)?.current.id ?? null,
    );
  }
  return { result, channelResolution };
}

function desiredOverwriteExactPatch(desiredPatch, currentOverwrite) {
  const result = { ...desiredPatch };
  for (const [permission] of permissionEntries) {
    const currentAllowNames = currentOverwrite?.allowNames ?? [];
    const currentDenyNames = currentOverwrite?.denyNames ?? [];
    if (
      !(permission in result) &&
      (currentAllowNames.includes(permission) || currentDenyNames.includes(permission))
    ) {
      result[permission] = null;
    }
  }
  return result;
}

function addOverwritePlan({
  config,
  entries,
  operations,
  roleResolution,
  categoryResult,
  channelResult,
}) {
  const desiredCategories = new Map(
    config.channels.categories.map((category) => [category.key, category]),
  );
  const managedRoleKeyById = new Map(
    [...roleResolution]
      .filter(([, id]) => id)
      .map(([key, id]) => [id, key]),
  );

  const resources = [
    ...config.channels.categories.map((category) => ({
      type: "category",
      key: category.key,
      phase: 6,
      desired: materializeOverwrites(category.overwrites, []),
      current: categoryResult.matches.get(category.key)?.current ?? null,
    })),
    ...enabledChannels(config).map((channel) => {
      const current = channelResult.matches.get(channel.key)?.current ?? null;
      const hasOwnPatch = hasOverwritePatch(channel.overwrites);
      return {
        type: "channel",
        key: channel.key,
        phase: 7,
        desired: materializeOverwrites(
          desiredCategories.get(channel.categoryKey)?.overwrites,
          channel.overwrites,
        ),
        current,
        skipOverwritePlan:
          !hasOwnPatch &&
          (current === null || current.permissionsLocked === true),
      };
    }),
  ];

  for (const resource of resources) {
    const entry = entries.get(resource.type, resource.key);
    if (!entry || entry.status === "ERROR") continue;
    if (resource.skipOverwritePlan) continue;
    const currentOverwrites = resource.current?.permissionOverwrites ?? [];
    const targetKeys = new Set(Object.keys(resource.desired));
    for (const overwrite of currentOverwrites) {
      if (overwrite.targetType !== "role") {
        entries.add(
          planEntry({
            id: `overwrite.unmanaged.${resource.type}.${resource.current?.id}.${overwrite.targetType}.${overwrite.id}`,
            status: "UNMANAGED",
            resourceType: "permissionOverwrite",
            resourceId: overwrite.id,
            name: `${entry.name}: ${overwrite.targetName ?? overwrite.id}`,
          }),
        );
        mergeDiagnostic(entries.diagnostics, {
          severity: "warning",
          code: "UNMANAGED_MEMBER_OVERWRITE",
          resourceKey: resource.key,
          resourceId: resource.current?.id ?? null,
          message: `Overwrite individual preservado em ${entry.name}.`,
        });
        continue;
      }
      const managedKey = managedRoleKeyById.get(overwrite.id);
      if (managedKey) targetKeys.add(managedKey);
      else {
        entries.add(
          planEntry({
            id: `overwrite.unmanaged.${resource.type}.${resource.current?.id}.role.${overwrite.id}`,
            status: "UNMANAGED",
            resourceType: "permissionOverwrite",
            resourceId: overwrite.id,
            name: `${entry.name}: ${overwrite.targetName ?? overwrite.id}`,
          }),
        );
        mergeDiagnostic(entries.diagnostics, {
          severity: "warning",
          code: "UNMANAGED_ROLE_OVERWRITE",
          resourceKey: resource.key,
          resourceId: resource.current?.id ?? null,
          message: `Overwrite de cargo externo preservado em ${entry.name}.`,
        });
      }
    }

    for (const targetKey of targetKeys) {
      const targetId = roleResolution.get(targetKey);
      const currentOverwrite = targetId
        ? currentOverwrites.find(
            (overwrite) =>
              overwrite.targetType === "role" && overwrite.id === targetId,
          )
        : null;
      if (
        BigInt(currentOverwrite?.unknownAllow ?? 0) !== 0n ||
        BigInt(currentOverwrite?.unknownDeny ?? 0) !== 0n
      ) {
        promoteEntry(entry, "ERROR");
        mergeDiagnostic(entries.diagnostics, {
          severity: "error",
          code: "UNKNOWN_OVERWRITE_BITS",
          resourceKey: resource.key,
          resourceId: resource.current?.id ?? null,
          message: `${entry.name} possui bits desconhecidos no overwrite de ${targetKey}.`,
        });
        continue;
      }
      const exactPatch = desiredOverwriteExactPatch(
        resource.desired[targetKey] ?? {},
        currentOverwrite,
      );
      const diff = overwriteChanges({
        desiredPatch: exactPatch,
        currentOverwrite,
      });
      if (diff.changes.length === 0) continue;
      for (const change of diff.changes) {
        addChange(
          entry,
          `overwrites.${targetKey}.${change.path}`,
          change.from,
          change.to,
        );
      }
      operations.push(
        operation({
          id: `${resource.type}.${resource.key}.overwrite.${targetKey}`,
          phase: resource.phase,
          action: "EDIT_OVERWRITE",
          targetType: resource.type,
          targetKey: resource.key,
          payload: { roleKey: targetKey, permissions: diff.options },
          dependsOn: [
            ...(entry.status === "CREATE"
              ? [`${resource.type}.${resource.key}.create`]
              : []),
            ...(entries.get("role", targetKey)?.status === "CREATE"
              ? [`role.${targetKey}.create`]
              : []),
          ],
        }),
      );
    }
  }
}

function summarize(entries, diagnostics, operations) {
  const errorEntries = entries.filter((entry) => entry.status === "ERROR");
  const representedErrorKeys = new Set(
    errorEntries
      .map((entry) => entry.resourceKey)
      .filter((resourceKey) => resourceKey !== null),
  );
  const unrepresentedErrors = diagnostics.filter(
    (item) =>
      item.severity === "error" &&
      (!item.resourceKey || !representedErrorKeys.has(item.resourceKey)),
  );
  const summary = {
    create: entries.filter((entry) => entry.status === "CREATE").length,
    update: entries.filter((entry) => entry.status === "UPDATE").length,
    ok: entries.filter((entry) => entry.status === "OK").length,
    unmanaged: entries.filter((entry) => entry.status === "UNMANAGED").length,
    error: errorEntries.length + unrepresentedErrors.length,
    delete: 0,
  };
  return {
    summary,
    hasChanges: operations.length > 0,
    hasErrors:
      errorEntries.length > 0 ||
      diagnostics.some((item) => item.severity === "error"),
  };
}

export function buildPlan({ config, snapshot, state }) {
  const entries = makeEntryStore();
  const operations = [];

  if (
    config.server.expectedGuildName &&
    config.server.expectedGuildName !== snapshot.guild.name
  ) {
    mergeDiagnostic(entries.diagnostics, {
      severity: "warning",
      code: "UNEXPECTED_GUILD_NAME",
      message: `Guild atual: ${snapshot.guild.name}; esperado: ${config.server.expectedGuildName}.`,
    });
  }

  const rolePlan = buildRolePlan({
    config,
    snapshot,
    state,
    entries,
    operations,
  });
  const categoryPlan = buildCategoryPlan({
    config,
    snapshot,
    state,
    entries,
    operations,
  });
  const channelPlan = buildChannelPlan({
    config,
    snapshot,
    state,
    entries,
    operations,
    categoryResolution: categoryPlan.categoryResolution,
    roleResolution: rolePlan.roleResolution,
  });
  addOverwritePlan({
    config,
    entries,
    operations,
    roleResolution: rolePlan.roleResolution,
    categoryResult: categoryPlan.result,
    channelResult: channelPlan.result,
  });

  operations.sort(
    (left, right) => left.phase - right.phase || left.id.localeCompare(right.id),
  );
  const result = summarize(entries.list, entries.diagnostics, operations);

  return {
    entries: entries.list,
    operations,
    diagnostics: entries.diagnostics,
    resolution: {
      roles: rolePlan.roleResolution,
      categories: categoryPlan.categoryResolution,
      channels: channelPlan.channelResolution,
    },
    ...result,
  };
}

export function buildNextResourceState(plan, guildId) {
  return {
    schemaVersion: 1,
    guildId,
    roles: Object.fromEntries(
      [...plan.resolution.roles].filter(([key, id]) => key !== "everyone" && id),
    ),
    categories: Object.fromEntries(
      [...plan.resolution.categories].filter(([, id]) => id),
    ),
    channels: Object.fromEntries(
      [...plan.resolution.channels].filter(([, id]) => id),
    ),
    forumTags: {},
  };
}
