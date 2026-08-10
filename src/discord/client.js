import { Client, Events, GatewayIntentBits } from "discord.js";

/**
 * Creates the minimal Discord client needed to inspect and manage guild
 * structure. Environment loading deliberately lives outside this module.
 */
export function createDiscordClient() {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

/**
 * Connects an existing client without returning discord.js' login result,
 * because Client#login resolves to the token used for the connection.
 */
export async function loginDiscordClient(client, token, { timeoutMs = 30_000 } = {}) {
  if (!client || typeof client.login !== "function") {
    throw new TypeError("Cliente Discord invalido.");
  }

  if (typeof token !== "string" || token.trim().length === 0) {
    throw new Error("Token do Discord ausente.");
  }

  await client.login(token);
  if (client.isReady()) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.off(Events.ClientReady, onReady);
      client.off(Events.Error, onError);
      callback(value);
    };
    const onReady = () => finish(resolve);
    const onError = (error) => finish(reject, error);
    const timeout = setTimeout(
      () => finish(
        reject,
        new Error(`Discord nao ficou pronto em ${timeoutMs} ms.`),
      ),
      timeoutMs,
    );

    client.once(Events.ClientReady, onReady);
    client.once(Events.Error, onError);
    // Avoid missing ClientReady if it fired between login() and listener setup.
    if (client.isReady()) onReady();
  });
}

/**
 * Fetches a fresh structural view of one guild. The returned discord.js
 * instances must be normalized before serialization; they retain references
 * to their client internally.
 */
export async function fetchGuildResources(client, guildId) {
  if (!client?.isReady?.()) {
    throw new Error("Cliente Discord ainda nao esta pronto.");
  }

  if (typeof guildId !== "string" || !/^\d{17,20}$/u.test(guildId)) {
    throw new Error("Guild ID invalido.");
  }

  const guild = await client.guilds.fetch({
    guild: guildId,
    cache: true,
    force: true,
    withCounts: true,
  });

  // Refresh roles before the current member so roles.highest is calculated
  // against the latest hierarchy returned by Discord.
  const [roles, channels] = await Promise.all([
    guild.roles.fetch(),
    guild.channels.fetch(),
  ]);
  const botMember = await guild.members.fetchMe({ cache: true, force: true });

  return { guild, botMember, roles, channels };
}

export async function destroyDiscordClient(client) {
  if (client && typeof client.destroy === "function") {
    await client.destroy();
  }
}
