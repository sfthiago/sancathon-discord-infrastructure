import { PermissionFlagsBits } from "discord.js";

const deprecatedAliases = new Set(["ManageEmojisAndStickers"]);
const seenPermissionBits = new Set();

export const permissionEntries = Object.entries(PermissionFlagsBits)
  .filter(
    ([name, bit]) =>
      typeof bit === "bigint" && !deprecatedAliases.has(name),
  )
  .sort((left, right) =>
    left[1] === right[1]
      ? left[0].localeCompare(right[0])
      : left[1] < right[1]
        ? -1
        : 1,
  )
  .filter(([, bit]) => {
    const key = bit.toString();
    if (seenPermissionBits.has(key)) return false;
    seenPermissionBits.add(key);
    return true;
  });

export const permissionNames = new Set(permissionEntries.map(([name]) => name));

export const knownPermissionMask = permissionEntries.reduce(
  (mask, [, bit]) => mask | bit,
  0n,
);

export function assertPermissionName(name) {
  if (!permissionNames.has(name)) {
    throw new Error(`Permissao desconhecida: ${name}`);
  }
}

export function encodePermissions(names = []) {
  return [...new Set(names)].reduce((bitfield, name) => {
    assertPermissionName(name);
    return bitfield | PermissionFlagsBits[name];
  }, 0n);
}

export function decodePermissionSet(value = 0n) {
  const bitfield = BigInt(value ?? 0);
  const names = permissionEntries
    .filter(([, bit]) => (bitfield & bit) === bit)
    .map(([name]) => name);

  return {
    bitfield: bitfield.toString(),
    names,
    unknownBitfield: (bitfield & ~knownPermissionMask).toString(),
  };
}

export function permissionState(overwrite, permissionName) {
  assertPermissionName(permissionName);
  const bit = PermissionFlagsBits[permissionName];
  const allow = BigInt(overwrite?.allow ?? 0);
  const deny = BigInt(overwrite?.deny ?? 0);

  if ((allow & bit) === bit) return true;
  if ((deny & bit) === bit) return false;
  return null;
}

export function permissionPatchToBits(patch = {}) {
  let allow = 0n;
  let deny = 0n;

  for (const [permission, state] of Object.entries(patch)) {
    assertPermissionName(permission);
    const bit = PermissionFlagsBits[permission];
    if (state === true) allow |= bit;
    if (state === false) deny |= bit;
  }

  if ((allow & deny) !== 0n) {
    throw new Error("Overwrite possui a mesma permissao em allow e deny.");
  }

  return { allow, deny };
}

export function bitfieldEquals(left, right) {
  return BigInt(left ?? 0) === BigInt(right ?? 0);
}

export function colorToNumber(color) {
  if (typeof color === "number") return color;
  if (!color) return 0;
  const normalized = String(color).replace(/^#/u, "");
  if (!/^[0-9a-f]{6}$/iu.test(normalized)) {
    throw new Error(`Cor invalida: ${color}`);
  }
  return Number.parseInt(normalized, 16);
}

export function colorToHex(value) {
  const numeric = Number(value ?? 0);
  return numeric === 0
    ? null
    : `#${numeric.toString(16).padStart(6, "0").toUpperCase()}`;
}
