import assert from "node:assert/strict";
import test from "node:test";

import { PermissionFlagsBits } from "discord.js";

import {
  bitfieldEquals,
  colorToHex,
  colorToNumber,
  decodePermissionSet,
  encodePermissions,
  permissionPatchToBits,
  permissionState,
} from "../src/utils/permissions.js";

test("permission encoding is set-like and independent from input order", () => {
  const left = encodePermissions([
    "SendMessages",
    "ViewChannel",
    "SendMessages",
  ]);
  const right = encodePermissions(["ViewChannel", "SendMessages"]);

  assert.equal(left, right);
  assert.equal(
    left,
    PermissionFlagsBits.SendMessages | PermissionFlagsBits.ViewChannel,
  );
});

test("permission decoder keeps decimal bitfields JSON-safe", () => {
  const bitfield =
    PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages;
  const decoded = decodePermissionSet(bitfield);

  assert.equal(decoded.bitfield, bitfield.toString());
  assert.deepEqual(decoded.names, ["ViewChannel", "SendMessages"]);
  assert.equal(decoded.unknownBitfield, "0");
  assert.doesNotThrow(() => JSON.stringify(decoded));
});

test("permission decoder preserves bits unknown to the installed discord.js", () => {
  const futurePermission = 1n << 62n;
  const bitfield = PermissionFlagsBits.ViewChannel | futurePermission;
  const decoded = decodePermissionSet(bitfield);

  assert.equal(decoded.bitfield, bitfield.toString());
  assert.equal(decoded.unknownBitfield, futurePermission.toString());
  assert.ok(decoded.names.includes("ViewChannel"));
});

test("permission decoder emits one canonical name per bit", () => {
  const decoded = decodePermissionSet(
    PermissionFlagsBits.ManageGuildExpressions,
  );

  assert.deepEqual(decoded.names, ["ManageGuildExpressions"]);
});

test("unknown permission names fail before a Discord mutation is planned", () => {
  assert.throws(
    () => encodePermissions(["DefinitelyNotADiscordPermission"]),
    /Permissao desconhecida/u,
  );
});

test("overwrite permission state is tri-state", () => {
  const overwrite = {
    allow: PermissionFlagsBits.ViewChannel.toString(),
    deny: PermissionFlagsBits.SendMessages.toString(),
  };

  assert.equal(permissionState(overwrite, "ViewChannel"), true);
  assert.equal(permissionState(overwrite, "SendMessages"), false);
  assert.equal(permissionState(overwrite, "ReadMessageHistory"), null);
});

test("permission patches encode allow, deny and inherit without Number coercion", () => {
  const result = permissionPatchToBits({
    ViewChannel: true,
    SendMessages: false,
    ReadMessageHistory: null,
  });

  assert.equal(result.allow, PermissionFlagsBits.ViewChannel);
  assert.equal(result.deny, PermissionFlagsBits.SendMessages);
  assert.equal(typeof result.allow, "bigint");
});

test("bitfield and color helpers preserve canonical values", () => {
  assert.equal(bitfieldEquals("1024", 1024n), true);
  assert.equal(bitfieldEquals("1024", "2048"), false);
  assert.equal(colorToNumber("#a61b1b"), 0xa61b1b);
  assert.equal(colorToHex(0xa61b1b), "#A61B1B");
  assert.equal(colorToHex(0), null);
  assert.throws(() => colorToNumber("vermelho"), /Cor invalida/u);
});
