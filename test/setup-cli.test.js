import assert from "node:assert/strict";
import test from "node:test";

import { parseSetupArguments } from "../setup.js";

test("setup CLI parses repeatable role deferrals in both forms", () => {
  assert.deepEqual(
    parseSetupArguments([
      "--apply",
      "--defer-role",
      "administration",
      "--defer-role=organization",
      "--defer-role",
      "administration",
    ]),
    {
      apply: true,
      help: false,
      deferRoleKeys: ["administration", "organization"],
    },
  );
});

test("setup CLI rejects a role deferral without a key", () => {
  assert.throws(
    () => parseSetupArguments(["--apply", "--defer-role"]),
    /exige a key/u,
  );
});
