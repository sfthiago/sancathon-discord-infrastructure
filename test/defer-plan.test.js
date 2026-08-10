import assert from "node:assert/strict";
import test from "node:test";

import { deferPlanRoles } from "../src/planner/defer-plan.js";
import { formatPlan } from "../src/planner/format-plan.js";

function fixturePlan() {
  return {
    entries: [
      {
        id: "role.administration",
        status: "UPDATE",
        resourceType: "role",
        resourceKey: "administration",
        resourceId: "100",
        name: "Administração",
        changes: [{ path: "name", from: "Organização", to: "Administração" }],
      },
      {
        id: "role.organization",
        status: "UPDATE",
        resourceType: "role",
        resourceKey: "organization",
        resourceId: "200",
        name: "Organização",
        changes: [{ path: "name", from: "Organização2", to: "Organização" }],
      },
      {
        id: "role.participant",
        status: "OK",
        resourceType: "role",
        resourceKey: "participant",
        resourceId: "300",
        name: "Participante",
        changes: [],
      },
      {
        id: "role.hierarchy",
        status: "UPDATE",
        resourceType: "roleHierarchy",
        resourceKey: null,
        resourceId: null,
        name: "Hierarquia dos cargos",
        changes: [{
          path: "relativeOrder",
          from: ["administration", "participant", "organization"],
          to: ["administration", "organization", "participant"],
        }],
      },
      {
        id: "category.private",
        status: "UPDATE",
        resourceType: "category",
        resourceKey: "private",
        resourceId: "400",
        name: "PRIVADO",
        changes: [
          {
            path: "overwrites.administration.ViewChannel",
            from: "inherit",
            to: "allow",
          },
          {
            path: "overwrites.organization.ViewChannel",
            from: "inherit",
            to: "allow",
          },
        ],
      },
    ],
    operations: [
      {
        id: "role.administration.update",
        phase: 1,
        action: "UPDATE_ROLE",
        targetType: "role",
        targetKey: "administration",
        payload: { name: "Administração" },
        dependsOn: [],
      },
      {
        id: "role.organization.update",
        phase: 1,
        action: "UPDATE_ROLE",
        targetType: "role",
        targetKey: "organization",
        payload: { name: "Organização" },
        dependsOn: [],
      },
      {
        id: "role.hierarchy.update",
        phase: 2,
        action: "REORDER_ROLES",
        targetType: "roleHierarchy",
        targetKey: "hierarchy",
        payload: { keys: ["administration", "organization", "participant"] },
        dependsOn: [],
      },
      {
        id: "category.private.overwrite.administration",
        phase: 6,
        action: "EDIT_OVERWRITE",
        targetType: "category",
        targetKey: "private",
        payload: { roleKey: "administration", permissions: { ViewChannel: true } },
        dependsOn: [],
      },
      {
        id: "category.private.overwrite.organization",
        phase: 6,
        action: "EDIT_OVERWRITE",
        targetType: "category",
        targetKey: "private",
        payload: { roleKey: "organization", permissions: { ViewChannel: true } },
        dependsOn: [],
      },
    ],
    diagnostics: [],
    resolution: {
      roles: new Map([
        ["everyone", "999"],
        ["administration", "100"],
        ["organization", "200"],
        ["participant", "300"],
      ]),
      categories: new Map([["private", "400"]]),
      channels: new Map(),
    },
    summary: {
      create: 0,
      update: 4,
      ok: 1,
      unmanaged: 0,
      error: 0,
      delete: 0,
    },
    hasChanges: true,
    hasErrors: false,
  };
}

test("explicit role deferral removes only its unsafe operations", () => {
  const deferred = deferPlanRoles(fixturePlan(), {
    roleKeys: ["administration"],
  });

  assert.deepEqual(
    deferred.operations.map((item) => item.id),
    [
      "role.organization.update",
      "role.hierarchy.update",
      "category.private.overwrite.organization",
    ],
  );
  assert.deepEqual(
    deferred.operations.find((item) => item.action === "REORDER_ROLES").payload.keys,
    ["organization", "participant"],
  );
  assert.equal(
    deferred.entries.find((item) => item.resourceKey === "administration").status,
    "DEFERRED",
  );
  assert.deepEqual(
    deferred.entries.find((item) => item.resourceType === "roleHierarchy")
      .changes[0].to,
    ["organization", "participant"],
  );
  assert.deepEqual(
    deferred.entries.find((item) => item.resourceKey === "private").changes,
    [{
      path: "overwrites.organization.ViewChannel",
      from: "inherit",
      to: "allow",
    }],
  );
  assert.equal(deferred.summary.deferred, 1);
  assert.equal(deferred.hasErrors, false);
  assert.ok(
    deferred.diagnostics.some((item) => item.code === "ROLE_DEFERRED_BY_OPTION"),
  );
});

test("role deferral cannot hide missing, unknown or planner-error roles", () => {
  const missing = fixturePlan();
  missing.resolution.roles.set("administration", null);
  assert.throws(
    () => deferPlanRoles(missing, { roleKeys: ["administration"] }),
    /ainda nao existe/u,
  );
  assert.throws(
    () => deferPlanRoles(fixturePlan(), { roleKeys: ["unknown"] }),
    /Cargo desconhecido/u,
  );
  const errored = fixturePlan();
  errored.entries[0].status = "ERROR";
  assert.throws(
    () => deferPlanRoles(errored, { roleKeys: ["administration"] }),
    /erro de planejamento/u,
  );
  assert.throws(
    () => deferPlanRoles(fixturePlan(), { roleKeys: ["everyone"] }),
    /everyone nao pode ser adiado/u,
  );
});

test("formatter exposes deferred resources and summary", () => {
  const output = formatPlan(
    deferPlanRoles(fixturePlan(), { roleKeys: ["administration"] }),
    { guildName: "Fixture", mode: "DRY RUN" },
  );
  assert.match(output, /> DEFERRED\s+Administração/u);
  assert.match(output, /DEFERRED\s+1/u);
});
