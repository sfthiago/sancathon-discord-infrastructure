import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { version as discordJsVersion } from "discord.js";

import config from "./config/index.js";
import { buildReport } from "./src/audit/build-report.js";
import { renderMarkdown } from "./src/audit/render-markdown.js";
import { loadEnvironment } from "./src/config/environment.js";
import {
  createDiscordClient,
  destroyDiscordClient,
  fetchGuildResources,
  loginDiscordClient,
} from "./src/discord/client.js";
import { createDiscordSnapshot } from "./src/discord/snapshot.js";

async function writeAtomic(path, contents) {
  const absolutePath = resolve(path);
  const temporaryPath = `${absolutePath}.tmp-${process.pid}`;
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, absolutePath);
}

function parseArguments(argumentsList) {
  const allowed = new Set(["--help", "-h"]);
  const unknown = argumentsList.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) {
    throw new Error(`Argumento desconhecido: ${unknown.join(", ")}.`);
  }
  return { help: argumentsList.includes("--help") || argumentsList.includes("-h") };
}

function printHelp() {
  console.log([
    "Uso: node audit.js",
    "",
    "Le o servidor sem modifica-lo e grava:",
    "  reports/discord-report.json",
    "  reports/discord-report.md",
  ].join("\n"));
}

export async function runAudit({ cwd = process.cwd() } = {}) {
  const { token, guildId } = loadEnvironment({ cwd });
  const client = createDiscordClient();

  try {
    console.log("[SANCATHON DISCORD] Conectando para auditoria somente leitura...");
    await loginDiscordClient(client, token);
    const resources = await fetchGuildResources(client, guildId);
    const snapshot = createDiscordSnapshot(resources);
    const report = buildReport(snapshot, {
      discordJsVersion,
      generatorVersion: "1.0.0",
    });
    const reportsDirectory = resolve(cwd, config.server.reportsDirectory);
    const jsonPath = join(reportsDirectory, "discord-report.json");
    const markdownPath = join(reportsDirectory, "discord-report.md");

    await Promise.all([
      writeAtomic(jsonPath, `${JSON.stringify(report, null, 2)}\n`),
      writeAtomic(markdownPath, renderMarkdown(report)),
    ]);

    console.log(`Guild: ${report.guild.name} (${report.guild.id})`);
    console.log(
      `Relatorio: ${report.summary.roleCount} cargos, ${report.summary.categoryCount} categorias, ${report.summary.channelCount} canais.`,
    );
    console.log(`JSON: ${jsonPath}`);
    console.log(`Markdown: ${markdownPath}`);
    return { report, jsonPath, markdownPath };
  } finally {
    await destroyDiscordClient(client);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  await runAudit();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[ERRO] ${error.message}`);
    if (process.env.DEBUG === "1") console.error(error.stack);
    process.exitCode = 1;
  });
}
