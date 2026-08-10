import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export function emptyResourceState(guildId = null) {
  return {
    schemaVersion: 1,
    guildId,
    roles: {},
    categories: {},
    channels: {},
    forumTags: {},
  };
}

export async function loadResourceState(path, guildId) {
  const absolutePath = resolve(path);
  try {
    const parsed = JSON.parse(await readFile(absolutePath, "utf8"));
    if (parsed.guildId && guildId && parsed.guildId !== guildId) {
      throw new Error(
        `State pertence a outra guild (${parsed.guildId}); esperado ${guildId}.`,
      );
    }
    return {
      ...emptyResourceState(guildId),
      ...parsed,
      guildId,
    };
  } catch (error) {
    if (error.code === "ENOENT") return emptyResourceState(guildId);
    throw error;
  }
}

export async function saveResourceState(path, state) {
  const absolutePath = resolve(path);
  const directory = dirname(absolutePath);
  const temporaryPath = `${absolutePath}.tmp-${process.pid}`;
  await mkdir(directory, { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, absolutePath);
}
