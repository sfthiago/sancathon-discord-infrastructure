import assert from "node:assert/strict";
import test from "node:test";

import { PermissionFlagsBits } from "discord.js";

import {
  canonicalizeOverwrites,
  materializeOverwrites,
  overwriteChanges,
  overwriteListToMap,
} from "../src/planner/overwrites.js";

test("channel overwrite patches override category state per permission", () => {
  const category = [
    {
      target: "participant",
      allow: ["ViewChannel", "SendMessages"],
      deny: [],
    },
    {
      target: "organization",
      allow: ["ViewChannel"],
      deny: [],
    },
  ];
  const channel = [{
    target: "participant",
    allow: [],
    deny: ["SendMessages"],
  }];

  assert.deepEqual(materializeOverwrites(category, channel), {
    participant: {
      ViewChannel: true,
      SendMessages: false,
    },
    organization: {
      ViewChannel: true,
    },
  });
});

test("overwrite list rejects the same permission in allow and deny", () => {
  assert.throws(
    () => overwriteListToMap([{
      target: "participant",
      allow: ["ViewChannel"],
      deny: ["ViewChannel"],
    }]),
    /aparece em allow e deny/u,
  );
});

test("overwrite diff represents allow, deny and inherit transitions once", () => {
  const currentOverwrite = {
    allow: PermissionFlagsBits.ViewChannel.toString(),
    deny: "0",
  };
  const diff = overwriteChanges({
    desiredPatch: {
      ViewChannel: null,
      SendMessages: false,
    },
    currentOverwrite,
  });

  assert.deepEqual(diff, {
    changes: [
      { path: "ViewChannel", from: true, to: null },
      { path: "SendMessages", from: null, to: false },
    ],
    options: {
      ViewChannel: null,
      SendMessages: false,
    },
  });
});

test("overwrite diff is empty when explicit states already match", () => {
  const currentOverwrite = {
    allow: PermissionFlagsBits.ViewChannel.toString(),
    deny: PermissionFlagsBits.SendMessages.toString(),
  };

  assert.deepEqual(
    overwriteChanges({
      desiredPatch: { ViewChannel: true, SendMessages: false },
      currentOverwrite,
    }),
    { changes: [], options: {} },
  );
});

test("overwrite diff rejects permission names unknown to discord.js", () => {
  assert.throws(
    () => overwriteChanges({
      desiredPatch: { FuturePermissionTypo: true },
      currentOverwrite: null,
    }),
    /Permissao desconhecida em overwrite/u,
  );
});

test("canonical overwrite comparison is target-order independent", () => {
  const first = [
    { targetType: "role", targetId: "20", allow: "1024", deny: "0" },
    { targetType: "member", targetId: "10", allow: "0", deny: "2048" },
  ];
  const second = [...first].reverse();

  assert.deepEqual(
    canonicalizeOverwrites(first),
    canonicalizeOverwrites(second),
  );
});

test("canonical overwrites distinguish role and member with the same snowflake", () => {
  const canonical = canonicalizeOverwrites([
    { targetType: "role", targetId: "42", allow: "1", deny: "0" },
    { targetType: "member", targetId: "42", allow: "0", deny: "1" },
  ]);

  assert.equal(canonical.length, 2);
  assert.notEqual(canonical[0].targetType, canonical[1].targetType);
});

test("canonical overwrites preserve bitfields above Number.MAX_SAFE_INTEGER", () => {
  const highBit = 1n << 62n;
  const [canonical] = canonicalizeOverwrites([{
    targetType: "role",
    targetId: "99",
    allow: highBit,
    deny: 0n,
  }]);

  assert.equal(canonical.allow, highBit.toString());
  assert.equal(canonical.deny, "0");
});
