import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvironment({ cwd = process.cwd() } = {}) {
  const envPath = resolve(cwd, ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  const token = process.env.DISCORD_TOKEN ?? process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.GUILD_ID ?? process.env.DISCORD_GUILD_ID;

  const missing = [];
  if (!token) missing.push("DISCORD_TOKEN");
  if (!guildId) missing.push("GUILD_ID");

  if (missing.length > 0) {
    throw new Error(
      `Credenciais ausentes: ${missing.join(", ")}. Copie .env.example para .env.`,
    );
  }

  if (!/^\d{17,20}$/u.test(guildId)) {
    throw new Error("GUILD_ID deve ser um snowflake numerico do Discord.");
  }

  return { token, guildId };
}
