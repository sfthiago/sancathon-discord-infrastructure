import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
} from "discord.js";

import {
  createDiscordSnapshot,
} from "../discord/snapshot.js";
import { fetchGuildResources } from "../discord/client.js";
import { validateConfig } from "../config/validate.js";
import {
  buildNextResourceState,
  buildPlan,
} from "../planner/build-plan.js";
import { materializeOverwrites } from "../planner/overwrites.js";
import {
  emptyResourceState,
  saveResourceState,
} from "../state/resource-state.js";
import { isCandidateName } from "../utils/names.js";
import {
  colorToNumber,
  permissionPatchToBits,
} from "../utils/permissions.js";
import { preflightPlan } from "./preflight.js";

const SUPPORTED_ACTIONS = new Set([
  "CREATE_ROLE",
  "UPDATE_ROLE",
  "REORDER_ROLES",
  "CREATE_CATEGORY",
  "UPDATE_CATEGORY",
  "CREATE_CHANNEL",
  "UPDATE_CHANNEL",
  "MOVE_CHANNEL",
  "REORDER_CATEGORIES",
  "REORDER_CHANNELS",
  "EDIT_OVERWRITE",
  "UPDATE_CHANNEL_SETTINGS",
]);

const CREATE_ACTIONS = new Set([
  "CREATE_ROLE",
  "CREATE_CATEGORY",
  "CREATE_CHANNEL",
]);

function createOperationIdentity(operation) {
  return `${operation.action}:${operation.targetType}:${operation.targetKey}`;
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

function asMap(value) {
  if (value instanceof Map) return new Map(value);
  return new Map(Object.entries(value ?? {}));
}

function cloneResolution(resolution) {
  return {
    roles: asMap(resolution?.roles),
    categories: asMap(resolution?.categories),
    channels: asMap(resolution?.channels),
  };
}

function collectionGet(collection, id) {
  if (!collection || !id) return null;
  if (typeof collection.get === "function") return collection.get(id) ?? null;
  if (typeof collection.find === "function") {
    return collection.find((item) => item?.id === id) ?? null;
  }
  return [...collection].find((item) => item?.id === id) ?? null;
}

function requireResolvedId(resolution, type, key, operationId = null) {
  const collection =
    type === "role"
      ? resolution.roles
      : type === "category"
        ? resolution.categories
        : resolution.channels;
  const id = collection.get(key);
  if (!id) {
    throw new ApplyPlanError(
      `Nao foi possivel resolver o ID de ${type}.${key}.`,
      { code: "UNRESOLVED_RESOURCE", operationId },
    );
  }
  return id;
}

function resolveChannelType(type) {
  if (Number.isInteger(type)) return type;
  const resolved = ChannelType[type];
  if (!Number.isInteger(resolved)) {
    throw new ApplyPlanError(`Tipo de canal desconhecido: ${type}.`, {
      code: "UNKNOWN_CHANNEL_TYPE",
    });
  }
  return resolved;
}

function configuredCategory(config, key) {
  const category = config.channels.categories.find((item) => item.key === key);
  if (!category) {
    throw new ApplyPlanError(`Categoria ausente na configuracao: ${key}.`, {
      code: "CATEGORY_CONFIG_NOT_FOUND",
    });
  }
  return category;
}

function configuredChannel(config, key) {
  const channel = config.channels.channels.find((item) => item.key === key);
  if (!channel) {
    throw new ApplyPlanError(`Canal ausente na configuracao: ${key}.`, {
      code: "CHANNEL_CONFIG_NOT_FOUND",
    });
  }
  return channel;
}

function desiredOverwriteMap(config, type, key) {
  if (type === "category") {
    const category = configuredCategory(config, key);
    return materializeOverwrites(category.overwrites, []);
  }
  const channel = configuredChannel(config, key);
  const category = configuredCategory(config, channel.categoryKey);
  return materializeOverwrites(category.overwrites, channel.overwrites);
}

function createOverwriteData(config, type, key, resolution, operationId) {
  const desired = desiredOverwriteMap(config, type, key);
  const overwrites = [];
  for (const [roleKey, patch] of Object.entries(desired)) {
    const roleId = requireResolvedId(
      resolution,
      "role",
      roleKey,
      operationId,
    );
    const { allow, deny } = permissionPatchToBits(patch);
    if (allow === 0n && deny === 0n) continue;
    overwrites.push({
      id: roleId,
      type: OverwriteType.Role,
      allow,
      deny,
    });
  }
  return overwrites;
}

function roleEditOptions(payload, reason) {
  const options = { reason };
  if (own(payload, "name")) options.name = payload.name;
  if (own(payload, "color")) {
    options.colors = { primaryColor: Number(payload.color) };
  }
  if (own(payload, "hoist")) options.hoist = Boolean(payload.hoist);
  if (own(payload, "mentionable")) {
    options.mentionable = Boolean(payload.mentionable);
  }
  if (own(payload, "permissions")) {
    options.permissions = BigInt(payload.permissions);
  }
  return options;
}

function positionAssignments(items, highestFirst = false) {
  const slots = items
    .map(({ resource }) => Number(resource.position))
    .sort((left, right) => left - right);
  if (highestFirst) slots.reverse();
  return items
    .map(({ resource }, index) => ({
      resource,
      position: slots[index],
    }))
    .filter(({ resource, position }) => Number(resource.position) !== position);
}

function mergeForumTags(desiredTags, currentTags) {
  const usedCurrentIndexes = new Set();
  const merged = [];

  for (const desired of desiredTags) {
    let currentIndex = -1;
    if (desired.id) {
      currentIndex = currentTags.findIndex(
        (tag, index) =>
          !usedCurrentIndexes.has(index) && tag.id === desired.id,
      );
    }
    if (currentIndex < 0) {
      currentIndex = currentTags.findIndex(
        (tag, index) =>
          !usedCurrentIndexes.has(index) && isCandidateName(desired, tag.name),
      );
    }
    const current = currentIndex >= 0 ? currentTags[currentIndex] : null;
    if (currentIndex >= 0) usedCurrentIndexes.add(currentIndex);
    const tag = {
      name: desired.name,
      moderated: own(desired, "moderated")
        ? Boolean(desired.moderated)
        : Boolean(current?.moderated),
    };
    if (desired.id) tag.id = desired.id;
    else if (current?.id) tag.id = current.id;
    if (own(desired, "emoji")) tag.emoji = desired.emoji;
    else if (current?.emoji) tag.emoji = current.emoji;
    merged.push(tag);
  }

  currentTags.forEach((tag, index) => {
    if (usedCurrentIndexes.has(index)) return;
    merged.push({
      id: tag.id,
      name: tag.name,
      moderated: Boolean(tag.moderated),
      ...(tag.emoji ? { emoji: tag.emoji } : {}),
    });
  });

  if (merged.length > 20) {
    throw new ApplyPlanError(
      `A preservacao das tags extras resultaria em ${merged.length} tags; o limite e 20.`,
      { code: "FORUM_TAG_LIMIT_EXCEEDED" },
    );
  }
  return merged;
}

async function fetchChannel(guild, id, operationId) {
  const channel = await guild.channels.fetch(id, { cache: true, force: true });
  if (!channel) {
    throw new ApplyPlanError(`Canal ${id} nao foi encontrado.`, {
      code: "CHANNEL_NOT_FOUND",
      operationId,
    });
  }
  return channel;
}

async function applyRoleReorder(guild, operation, resolution) {
  const roles = await guild.roles.fetch();
  const managed = operation.payload.keys.map((key) => {
    const id = requireResolvedId(resolution, "role", key, operation.id);
    const resource = collectionGet(roles, id);
    if (!resource) {
      throw new ApplyPlanError(`Cargo ${key} (${id}) nao foi encontrado.`, {
        code: "ROLE_NOT_FOUND",
        operationId: operation.id,
      });
    }
    return { key, resource };
  });
  const assignments = positionAssignments(managed, true);
  if (assignments.length > 0) {
    await guild.roles.setPositions(
      assignments.map(({ resource, position }) => ({
        role: resource.id,
        position,
      })),
    );
  }
  return { changedPositions: assignments.length };
}

async function applyCategoryReorder(guild, operation, resolution) {
  const channels = await guild.channels.fetch();
  const managed = operation.payload.keys.map((key) => {
    const id = requireResolvedId(resolution, "category", key, operation.id);
    const resource = collectionGet(channels, id);
    if (!resource) {
      throw new ApplyPlanError(`Categoria ${key} (${id}) nao foi encontrada.`, {
        code: "CATEGORY_NOT_FOUND",
        operationId: operation.id,
      });
    }
    return { key, resource };
  });
  const assignments = positionAssignments(managed);
  if (assignments.length > 0) {
    await guild.channels.setPositions(
      assignments.map(({ resource, position }) => ({
        channel: resource.id,
        position,
      })),
    );
  }
  return { changedPositions: assignments.length };
}

async function applyChannelReorder(guild, operation, resolution) {
  const channels = await guild.channels.fetch();
  const managed = operation.payload.keys.map((key) => {
    const id = requireResolvedId(resolution, "channel", key, operation.id);
    const resource = collectionGet(channels, id);
    if (!resource) {
      throw new ApplyPlanError(`Canal ${key} (${id}) nao foi encontrado.`, {
        code: "CHANNEL_NOT_FOUND",
        operationId: operation.id,
      });
    }
    return { key, resource };
  });

  // The planner models one relative order for all managed children in the
  // category. Reuse only their existing slots, including mixed channel types,
  // so unmanaged channels keep their relative placement.
  const assignments = positionAssignments(managed);
  if (assignments.length > 0) {
    await guild.channels.setPositions(
      assignments.map(({ resource, position }) => ({
        channel: resource.id,
        position,
      })),
    );
  }
  return { changedPositions: assignments.length };
}

async function executeOperation(context, operation) {
  const { config, guild, reason, resolution } = context;
  const payload = operation.payload ?? {};

  switch (operation.action) {
    case "CREATE_ROLE": {
      const role = await guild.roles.create({
        name: payload.name,
        colors: { primaryColor: colorToNumber(payload.color) },
        hoist: Boolean(payload.hoist),
        mentionable: Boolean(payload.mentionable),
        permissions: BigInt(payload.permissions ?? 0),
        reason,
      });
      resolution.roles.set(operation.targetKey, role.id);
      return { resourceId: role.id };
    }

    case "UPDATE_ROLE": {
      const roleId = requireResolvedId(
        resolution,
        "role",
        operation.targetKey,
        operation.id,
      );
      const role = await guild.roles.edit(
        roleId,
        roleEditOptions(payload, reason),
      );
      return { resourceId: role.id };
    }

    case "REORDER_ROLES":
      return applyRoleReorder(guild, operation, resolution);

    case "CREATE_CATEGORY": {
      const category = await guild.channels.create({
        name: payload.name,
        type: ChannelType.GuildCategory,
        // New private resources receive their final managed overwrites in the
        // create request, so they are never transiently public between phases.
        permissionOverwrites: createOverwriteData(
          config,
          "category",
          operation.targetKey,
          resolution,
          operation.id,
        ),
        reason,
      });
      resolution.categories.set(operation.targetKey, category.id);
      return { resourceId: category.id };
    }

    case "UPDATE_CATEGORY": {
      const categoryId = requireResolvedId(
        resolution,
        "category",
        operation.targetKey,
        operation.id,
      );
      const category = await guild.channels.edit(categoryId, {
        name: payload.name,
        reason,
      });
      return { resourceId: category.id };
    }

    case "CREATE_CHANNEL": {
      const parentId = requireResolvedId(
        resolution,
        "category",
        payload.categoryKey,
        operation.id,
      );
      const channel = await guild.channels.create({
        name: payload.name,
        type: resolveChannelType(payload.type),
        parent: parentId,
        // Category defaults and channel exceptions are materialized together
        // at creation. Existing resources are never replaced this way.
        permissionOverwrites: createOverwriteData(
          config,
          "channel",
          operation.targetKey,
          resolution,
          operation.id,
        ),
        reason,
      });
      resolution.channels.set(operation.targetKey, channel.id);
      return { resourceId: channel.id };
    }

    case "UPDATE_CHANNEL": {
      const channelId = requireResolvedId(
        resolution,
        "channel",
        operation.targetKey,
        operation.id,
      );
      const channel = await guild.channels.edit(channelId, {
        ...(own(payload, "name") ? { name: payload.name } : {}),
        reason,
      });
      return { resourceId: channel.id };
    }

    case "MOVE_CHANNEL": {
      const channelId = requireResolvedId(
        resolution,
        "channel",
        operation.targetKey,
        operation.id,
      );
      const categoryId = requireResolvedId(
        resolution,
        "category",
        payload.categoryKey,
        operation.id,
      );
      const channel = await fetchChannel(guild, channelId, operation.id);
      let visibilityGuardApplied = false;
      const desiredOverwrites = desiredOverwriteMap(
        config,
        "channel",
        operation.targetKey,
      );
      if (
        payload.lockPermissions !== true &&
        desiredOverwrites.everyone?.ViewChannel === false
      ) {
        const everyoneId = requireResolvedId(
          resolution,
          "role",
          "everyone",
          operation.id,
        );
        const existing = channel.permissionOverwrites.cache.get(everyoneId);
        const alreadyDenied =
          existing?.deny?.has?.(PermissionFlagsBits.ViewChannel) === true;
        if (!alreadyDenied) {
          const everyoneRole = collectionGet(guild.roles.cache, everyoneId);
          if (!everyoneRole) {
            throw new ApplyPlanError(
              `Cargo @everyone (${everyoneId}) nao esta no cache.`,
              { code: "ROLE_NOT_FOUND", operationId: operation.id },
            );
          }
          // Restrict visibility before moving an unsynchronised channel into
          // a private category. Phase 7 will reconcile the remaining bits.
          await channel.permissionOverwrites.edit(
            everyoneRole,
            { ViewChannel: false },
            { type: OverwriteType.Role, reason },
          );
          visibilityGuardApplied = true;
        }
      }
      const updated = await channel.setParent(categoryId, {
        lockPermissions: payload.lockPermissions === true,
        reason,
      });
      return { resourceId: updated.id, visibilityGuardApplied };
    }

    case "REORDER_CATEGORIES":
      return applyCategoryReorder(guild, operation, resolution);

    case "REORDER_CHANNELS":
      return applyChannelReorder(guild, operation, resolution);

    case "EDIT_OVERWRITE": {
      const resourceId = requireResolvedId(
        resolution,
        operation.targetType,
        operation.targetKey,
        operation.id,
      );
      const roleId = requireResolvedId(
        resolution,
        "role",
        payload.roleKey,
        operation.id,
      );
      const channel = await fetchChannel(guild, resourceId, operation.id);
      const role = collectionGet(guild.roles.cache, roleId);
      if (!role) {
        throw new ApplyPlanError(`Cargo ${payload.roleKey} (${roleId}) nao esta no cache.`, {
          code: "ROLE_NOT_FOUND",
          operationId: operation.id,
        });
      }
      await channel.permissionOverwrites.edit(
        role,
        payload.permissions,
        { type: OverwriteType.Role, reason },
      );
      return { resourceId };
    }

    case "UPDATE_CHANNEL_SETTINGS": {
      const channelId = requireResolvedId(
        resolution,
        "channel",
        operation.targetKey,
        operation.id,
      );
      const channel = await fetchChannel(guild, channelId, operation.id);
      const options = { reason };
      if (own(payload, "slowmode") && payload.slowmode !== undefined) {
        options.rateLimitPerUser = Number(payload.slowmode);
      }
      if (Array.isArray(payload.availableTags)) {
        options.availableTags = mergeForumTags(
          payload.availableTags,
          Array.isArray(channel.availableTags) ? channel.availableTags : [],
        );
      }
      const updated = await guild.channels.edit(channelId, options);
      return { resourceId: updated.id };
    }

    default:
      throw new ApplyPlanError(
        `Operacao nao suportada durante apply: ${operation.action}.`,
        { code: "UNSUPPORTED_OPERATION", operationId: operation.id },
      );
  }
}

async function notify(onOperation, event) {
  if (typeof onOperation === "function") await onOperation(event);
}

async function executePhases({
  config,
  guild,
  onOperation,
  pass,
  plan,
  reason,
  results,
}) {
  const resolution = cloneResolution(plan.resolution);
  const operationIds = new Set(plan.operations.map((operation) => operation.id));
  const completed = new Set();

  for (let phase = 1; phase <= 8; phase += 1) {
    const operations = plan.operations
      .filter((operation) => Number(operation.phase) === phase)
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const operation of operations) {
      if (
        !SUPPORTED_ACTIONS.has(operation.action) ||
        /DELETE|REMOVE/u.test(operation.action)
      ) {
        throw new ApplyPlanError(
          `Operacao insegura ou desconhecida bloqueada: ${operation.action}.`,
          { code: "UNSUPPORTED_OPERATION", operationId: operation.id },
        );
      }
      const pendingDependency = (operation.dependsOn ?? []).find(
        (dependency) =>
          operationIds.has(dependency) && !completed.has(dependency),
      );
      if (pendingDependency) {
        throw new ApplyPlanError(
          `${operation.id} foi executada antes da dependencia ${pendingDependency}.`,
          { code: "UNMET_DEPENDENCY", operationId: operation.id },
        );
      }

      await notify(onOperation, {
        status: "starting",
        pass,
        phase,
        operation,
      });
      try {
        const details = await executeOperation(
          { config, guild, reason, resolution },
          operation,
        );
        completed.add(operation.id);
        const result = {
          status: "applied",
          pass,
          phase,
          operationId: operation.id,
          action: operation.action,
          targetType: operation.targetType,
          targetKey: operation.targetKey,
          resourceId: details?.resourceId ?? null,
          details: details ?? {},
        };
        results.push(result);
        await notify(onOperation, { ...result, operation });
      } catch (cause) {
        await notify(onOperation, {
          status: "failed",
          pass,
          phase,
          operation,
          error: cause,
        });
        if (cause instanceof ApplyPlanError) throw cause;
        throw new ApplyPlanError(
          `Falha ao executar ${operation.id}: ${cause.message}`,
          {
            cause,
            code: "OPERATION_FAILED",
            operationId: operation.id,
            partialResults: results,
          },
        );
      }
    }
  }

  if (completed.size !== plan.operations.length) {
    const skipped = plan.operations
      .filter((operation) => !completed.has(operation.id))
      .map((operation) => operation.id);
    throw new ApplyPlanError(
      `Operacoes fora das fases 1-8 nao foram executadas: ${skipped.join(", ")}.`,
      { code: "OPERATIONS_NOT_EXECUTED", partialResults: results },
    );
  }
}

export class ApplyPlanError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ApplyPlanError";
    this.code = options.code ?? "APPLY_FAILED";
    this.operationId = options.operationId ?? null;
    this.preflight = options.preflight ?? null;
    this.validation = options.validation ?? null;
    this.plan = options.plan ?? null;
    this.verificationPlan = options.verificationPlan ?? null;
    this.partialResults = options.partialResults ?? [];
  }
}

export class ApplyConvergenceError extends ApplyPlanError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "CONVERGENCE_FAILED" });
    this.name = "ApplyConvergenceError";
  }
}

/**
 * Reconciles Discord in planner phases 1-8. A fresh snapshot/plan is always
 * used, so an optional caller-side plan can never authorize stale mutations.
 * State is written atomically only after a final refetch produces zero work.
 */
export async function applyPlan({
  client,
  guildId,
  config,
  state = null,
  statePath = config?.server?.stateFile,
  reason = "Sancathon 2026 infrastructure reconciliation",
  onOperation = null,
  maxPasses = 3,
  services = {},
}) {
  if (!client) throw new TypeError("client e obrigatorio para apply.");
  if (!config?.server || !config?.roles || !config?.channels) {
    throw new TypeError("config e obrigatorio para apply.");
  }
  if (typeof guildId !== "string" || guildId.length === 0) {
    throw new TypeError("guildId e obrigatorio para apply.");
  }
  if (!Number.isInteger(maxPasses) || maxPasses < 1 || maxPasses > 10) {
    throw new RangeError("maxPasses deve ser um inteiro entre 1 e 10.");
  }
  if (typeof statePath !== "string" || statePath.length === 0) {
    throw new TypeError("statePath e obrigatorio para salvar o state.");
  }
  if (
    state?.guildId &&
    String(state.guildId) !== String(guildId)
  ) {
    throw new ApplyPlanError(
      `O state pertence a guild ${state.guildId}; esperado ${guildId}.`,
      { code: "STATE_GUILD_MISMATCH" },
    );
  }

  let validation;
  try {
    validation = validateConfig(config);
  } catch (cause) {
    throw new ApplyPlanError(
      `A configuracao nao pode ser validada: ${cause.message}`,
      { cause, code: "CONFIG_INVALID" },
    );
  }
  if (!validation.isValid) {
    throw new ApplyPlanError(
      `A configuracao possui ${validation.errors.length} erro(s) e nao pode ser aplicada.`,
      { code: "CONFIG_INVALID", validation },
    );
  }

  const implementation = {
    fetchGuildResources,
    createDiscordSnapshot,
    buildPlan,
    buildNextResourceState,
    saveResourceState,
    ...services,
  };
  const currentState = state ?? emptyResourceState(guildId);
  const auditReason = String(reason).slice(0, 512);
  const results = [];
  const plans = [];
  const completedCreates = new Set();
  let finalPlan = null;
  let finalSnapshot = null;

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const resources = await implementation.fetchGuildResources(client, guildId);
    if (String(resources.guild?.id) !== String(guildId)) {
      throw new ApplyPlanError(
        `A API retornou a guild ${resources.guild?.id}; esperado ${guildId}.`,
        { code: "GUILD_MISMATCH", partialResults: results },
      );
    }
    const snapshot = implementation.createDiscordSnapshot(resources);
    const plan = implementation.buildPlan({
      config,
      snapshot,
      state: currentState,
    });
    plans.push(plan);

    const repeatedCreate = plan.operations.find(
      (operation) =>
        CREATE_ACTIONS.has(operation.action) &&
        completedCreates.has(createOperationIdentity(operation)),
    );
    if (repeatedCreate) {
      throw new ApplyConvergenceError(
        `O novo planejamento repetiu ${repeatedCreate.id} depois de a criacao ja ter sido concluida; nova criacao foi bloqueada para evitar duplicatas.`,
        {
          operationId: repeatedCreate.id,
          verificationPlan: plan,
          partialResults: results,
        },
      );
    }

    const preflight = preflightPlan({ plan, snapshot });
    if (!preflight.ok) {
      throw new ApplyPlanError(
        pass === 1
          ? "Preflight bloqueou o apply."
          : "O plano de verificacao nao pode ser aplicado com seguranca.",
        {
          code: "PREFLIGHT_FAILED",
          preflight,
          plan,
          partialResults: results,
        },
      );
    }

    if (plan.operations.length === 0) {
      finalPlan = plan;
      finalSnapshot = snapshot;
      break;
    }

    await executePhases({
      config,
      guild: resources.guild,
      onOperation,
      pass,
      plan,
      reason: auditReason,
      results,
    });
    for (const operation of plan.operations) {
      if (CREATE_ACTIONS.has(operation.action)) {
        completedCreates.add(createOperationIdentity(operation));
      }
    }

    if (pass === maxPasses) {
      const verificationResources = await implementation.fetchGuildResources(
        client,
        guildId,
      );
      const verificationSnapshot = implementation.createDiscordSnapshot(
        verificationResources,
      );
      const verificationPlan = implementation.buildPlan({
        config,
        snapshot: verificationSnapshot,
        state: currentState,
      });
      if (verificationPlan.hasErrors || verificationPlan.operations.length > 0) {
        throw new ApplyConvergenceError(
          `O Discord ainda apresenta ${verificationPlan.operations.length} operacoes pendentes apos ${maxPasses} passagem(ns).`,
          {
            verificationPlan,
            partialResults: results,
          },
        );
      }
      finalPlan = verificationPlan;
      finalSnapshot = verificationSnapshot;
    }
  }

  if (!finalPlan || !finalSnapshot) {
    throw new ApplyConvergenceError("Nao foi possivel confirmar a convergencia.", {
      verificationPlan: finalPlan,
      partialResults: results,
    });
  }

  const nextState = implementation.buildNextResourceState(finalPlan, guildId);
  try {
    await implementation.saveResourceState(statePath, nextState);
  } catch (cause) {
    throw new ApplyPlanError(
      `Discord convergiu, mas o state nao pode ser salvo: ${cause.message}`,
      {
        cause,
        code: "STATE_SAVE_FAILED",
        plan: finalPlan,
        partialResults: results,
      },
    );
  }

  return {
    applied: results.length > 0,
    passes: plans.length,
    results,
    plans,
    plan: finalPlan,
    planAfter: finalPlan,
    snapshot: finalSnapshot,
    snapshotAfter: finalSnapshot,
    state: nextState,
    statePath,
  };
}

export const executePlan = applyPlan;
