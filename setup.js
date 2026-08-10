import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import config from "./config/index.js";
import { applyPlan } from "./src/apply/apply-plan.js";
import { preflightPlan } from "./src/apply/preflight.js";
import { loadEnvironment } from "./src/config/environment.js";
import { validateConfig } from "./src/config/validate.js";
import {
  createDiscordClient,
  destroyDiscordClient,
  fetchGuildResources,
  loginDiscordClient,
} from "./src/discord/client.js";
import { createDiscordSnapshot } from "./src/discord/snapshot.js";
import { buildPlan } from "./src/planner/build-plan.js";
import { deferPlanRoles } from "./src/planner/defer-plan.js";
import { formatPlan } from "./src/planner/format-plan.js";
import { loadResourceState } from "./src/state/resource-state.js";

function diagnosticSignature(item) {
  return [
    item.severity,
    item.code,
    item.path,
    item.resourceKey,
    item.resourceId,
    item.message,
  ].join("|");
}

function withDiagnostics(plan, additionalDiagnostics = []) {
  const seen = new Set();
  const diagnostics = [...plan.diagnostics, ...additionalDiagnostics].filter(
    (item) => {
      const signature = diagnosticSignature(item);
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    },
  );
  const diagnosticErrors = diagnostics.filter(
    (item) => item.severity === "error",
  ).length;
  const entryErrors = plan.entries.filter(
    (entry) => entry.status === "ERROR",
  ).length;

  return {
    ...plan,
    diagnostics,
    hasErrors: diagnosticErrors > 0 || entryErrors > 0,
    summary: {
      ...plan.summary,
      error: Math.max(diagnosticErrors, entryErrors),
      delete: 0,
    },
  };
}

export function parseSetupArguments(argumentsList) {
  const allowed = new Set(["--dry-run", "--apply", "--help", "-h"]);
  const unknown = [];
  const deferRoleKeys = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (allowed.has(argument)) continue;
    if (argument === "--defer-role") {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--defer-role exige a key de um cargo.");
      }
      deferRoleKeys.push(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--defer-role=")) {
      const value = argument.slice("--defer-role=".length).trim();
      if (!value) throw new Error("--defer-role exige a key de um cargo.");
      deferRoleKeys.push(value);
      continue;
    }
    unknown.push(argument);
  }
  if (unknown.length > 0) {
    throw new Error(`Argumento desconhecido: ${unknown.join(", ")}.`);
  }
  if (argumentsList.includes("--apply") && argumentsList.includes("--dry-run")) {
    throw new Error("Use apenas --dry-run ou --apply, nunca os dois juntos.");
  }
  return {
    apply: argumentsList.includes("--apply"),
    help: argumentsList.includes("--help") || argumentsList.includes("-h"),
    deferRoleKeys: [...new Set(deferRoleKeys)],
  };
}

function printHelp() {
  console.log([
    "Uso:",
    "  node setup.js              # dry-run (padrao)",
    "  node setup.js --dry-run    # somente planeja",
    "  node setup.js --apply      # aplica o plano",
    "  node setup.js --dry-run --defer-role administration",
    "  node setup.js --apply --defer-role administration",
    "                              # adia somente o cargo acima do bot",
    "",
    "Nenhum modo exclui cargos, categorias, canais ou membros.",
  ].join("\n"));
}

function printValidationFailure(validation) {
  console.error("[CONFIGURATION ERROR]");
  for (const item of validation.diagnostics) {
    console.error(
      `${item.severity.toUpperCase()} [${item.code}] ${item.path}: ${item.message}`,
    );
  }
}

function operationLogger(event) {
  if (event.status !== "starting") return;
  console.log(
    `[APPLY ${event.phase}/8] ${event.operation.action} ${event.operation.targetKey}`,
  );
}

export async function runSetup({
  apply = false,
  cwd = process.cwd(),
  desiredConfig = config,
  deferRoleKeys = [],
} = {}) {
  const validation = validateConfig(desiredConfig);
  if (!validation.isValid) {
    printValidationFailure(validation);
    const error = new Error("Configuracao invalida. ABORT APPLY.");
    error.code = "INVALID_CONFIG";
    throw error;
  }

  const { token, guildId } = loadEnvironment({ cwd });
  const statePath = resolve(cwd, desiredConfig.server.stateFile);
  const state = await loadResourceState(statePath, guildId);
  const client = createDiscordClient();

  try {
    console.log("[SANCATHON DISCORD] Conectando ao Discord...");
    await loginDiscordClient(client, token);
    const resources = await fetchGuildResources(client, guildId);
    const snapshot = createDiscordSnapshot(resources);
    const planned = deferPlanRoles(
      buildPlan({ config: desiredConfig, snapshot, state }),
      { roleKeys: deferRoleKeys },
    );
    const preflight = preflightPlan({ plan: planned, snapshot });
    const plan = withDiagnostics(planned, [
      ...validation.warnings,
      ...preflight.diagnostics.filter(
        (diagnostic) => !diagnostic.code.startsWith("PLAN_"),
      ),
    ]);

    console.log("");
    console.log(
      formatPlan(plan, {
        guildName: snapshot.guild.name,
        mode: apply ? "APPLY" : "DRY RUN",
      }),
    );

    if (!apply) {
      console.log("");
      console.log("No changes were applied.");
      if (plan.hasErrors) {
        console.log("Corrija os erros acima antes de usar --apply.");
      } else if (plan.hasChanges) {
        const deferredArguments = deferRoleKeys
          .map((key) => ` --defer-role ${key}`)
          .join("");
        console.log(`Run with --apply${deferredArguments} to apply this plan.`);
      }
      return { mode: "dry-run", snapshot, plan, preflight };
    }

    if (plan.hasErrors || !preflight.ok) {
      const error = new Error("O preflight encontrou erros. ABORT APPLY.");
      error.code = "PREFLIGHT_FAILED";
      throw error;
    }

    console.log("");
    console.log("Aplicando o plano em fases seguras...");
    const result = await applyPlan({
      client,
      guildId,
      config: desiredConfig,
      state,
      statePath,
      reason: "Sancathon Discord Infrastructure apply",
      onOperation: operationLogger,
      deferRoleKeys,
    });

    console.log("");
    console.log("Apply concluido e validado por um novo planejamento.");
    console.log(
      formatPlan(result.plan, {
        guildName: result.snapshot?.guild?.name ?? snapshot.guild.name,
        mode: "POST-APPLY CHECK",
      }),
    );
    return { mode: "apply", ...result };
  } finally {
    await destroyDiscordClient(client);
  }
}

async function main() {
  const options = parseSetupArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  await runSetup({
    apply: options.apply,
    deferRoleKeys: options.deferRoleKeys,
  });
}

function printSetupError(error) {
  const code = error.code ? ` ${error.code}` : "";
  console.error(`[ERRO${code}] ${error.message}`);
  for (const diagnostic of error.preflight?.diagnostics ?? []) {
    console.error(
      `  ${diagnostic.severity.toUpperCase()} [${diagnostic.code}] ${diagnostic.message}`,
    );
  }
  if (error.operationId) {
    console.error(`  Operacao: ${error.operationId}`);
  }
  if (error.verificationPlan) {
    console.error(
      `  Verificacao: ${error.verificationPlan.operations.length} operacao(oes) ainda pendente(s).`,
    );
  }
  if ((error.partialResults?.length ?? 0) > 0) {
    console.error(
      `  Operacoes concluidas antes da falha: ${error.partialResults.length}.`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    printSetupError(error);
    if (process.env.DEBUG === "1") console.error(error.stack);
    process.exitCode = 1;
  });
}
