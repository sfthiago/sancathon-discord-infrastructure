import assert from "node:assert/strict";
import test from "node:test";

import { indexBy, sortBy, unique } from "../src/utils/collections.js";
import {
  candidateNames,
  isCandidateName,
  namesMatch,
  normalizeName,
} from "../src/utils/names.js";
import { matchResources } from "../src/planner/match-resources.js";

test("name normalization trims, folds case, collapses spaces and uses Unicode NFKC", () => {
  const decomposed = "DU\u0301VIDAS";

  assert.equal(normalizeName(`  ${decomposed}   E   SUPORTE  `), "dúvidas e suporte");
  assert.equal(namesMatch(" Organização ", "organização"), true);
  assert.equal(normalizeName("ＦＯＯ"), "foo");
});

test("name normalization does not perform unsafe fuzzy, accent or emoji stripping", () => {
  assert.notEqual(normalizeName("Organização"), normalizeName("Organizacao"));
  assert.notEqual(normalizeName("📌 COMECE AQUI"), normalizeName("COMECE AQUI"));
  assert.equal(namesMatch("duvida", "duvidas"), false);
});

test("candidate matching includes explicit aliases only", () => {
  const resource = {
    name: "duvidas-dos-treinamentos",
    aliases: ["duvida-dos-treinamentos"],
  };

  assert.deepEqual(candidateNames(resource), [
    "duvidas-dos-treinamentos",
    "duvida-dos-treinamentos",
  ]);
  assert.equal(isCandidateName(resource, "DUVIDA-DOS-TREINAMENTOS"), true);
  assert.equal(isCandidateName(resource, "duvidas-treinamento"), false);
});

test("collection helpers sort numerically, index and deduplicate", () => {
  const values = [{ key: "team10" }, { key: "team2" }, { key: "team1" }];

  assert.deepEqual(
    sortBy(values, (item) => item.key).map((item) => item.key),
    ["team1", "team2", "team10"],
  );
  assert.equal(indexBy(values, (item) => item.key).get("team2"), values[1]);
  assert.deepEqual(unique(["a", "b", "a"]), ["a", "b"]);
});

test("saved resource ID has priority over a changed display name", () => {
  const desired = [{ key: "organization", name: "Organização", aliases: [] }];
  const current = [{ id: "200", name: "Nome alterado manualmente" }];
  const result = matchResources({
    desired,
    current,
    stateIds: { organization: "200" },
  });

  assert.equal(result.matches.get("organization")?.current, current[0]);
  assert.equal(result.matches.get("organization")?.source, "state");
  assert.deepEqual(result.diagnostics, []);
});

test("stale state ID falls back to a unique name or alias match", () => {
  const desired = [{
    key: "trainingQuestions",
    name: "duvidas-dos-treinamentos",
    aliases: ["duvida-dos-treinamentos"],
  }];
  const current = [{ id: "301", name: "duvida-dos-treinamentos" }];
  const result = matchResources({
    desired,
    current,
    stateIds: { trainingQuestions: "999" },
  });

  assert.equal(result.matches.get("trainingQuestions")?.current.id, "301");
  assert.equal(result.matches.get("trainingQuestions")?.source, "alias");
  assert.ok(result.diagnostics.some((item) => item.code === "STALE_STATE_ID"));
});

test("ambiguous name match is an error and never claims or creates implicitly", () => {
  const result = matchResources({
    desired: [{ key: "general", name: "geral", aliases: [] }],
    current: [
      { id: "401", name: "geral" },
      { id: "402", name: "GERAL" },
    ],
  });

  assert.equal(result.matches.has("general"), false);
  assert.equal(result.unmatchedDesired.length, 1);
  assert.equal(result.unmatchedCurrent.length, 2);
  assert.ok(
    result.diagnostics.some((item) => item.code === "AMBIGUOUS_RESOURCE_MATCH"),
  );
});

test("same name with incompatible type is reported instead of duplicated", () => {
  const result = matchResources({
    desired: [{ key: "general", name: "geral", type: "GuildText" }],
    current: [{ id: "501", name: "geral", typeName: "GuildVoice" }],
    isCompatible: (wanted, actual) => wanted.type === actual.typeName,
  });

  assert.equal(result.matches.has("general"), false);
  assert.ok(
    result.diagnostics.some((item) => item.code === "RESOURCE_TYPE_MISMATCH"),
  );
});

test("one saved ID cannot be assigned to two desired resources", () => {
  const result = matchResources({
    desired: [
      { key: "first", name: "Primeiro" },
      { key: "second", name: "Segundo" },
    ],
    current: [{ id: "601", name: "Recurso" }],
    stateIds: { first: "601", second: "601" },
  });

  assert.equal(result.matches.size, 1);
  assert.ok(result.diagnostics.some((item) => item.code === "STATE_ID_REUSED"));
});

test("global matching resolves a canonical/alias rename chain without duplicates", () => {
  const result = matchResources({
    desired: [
      {
        key: "administration",
        name: "Administração",
        aliases: ["Organização"],
      },
      {
        key: "organization",
        name: "Organização",
        aliases: ["Organização2"],
      },
    ],
    current: [
      { id: "701", name: "Organização" },
      { id: "702", name: "Organização2" },
    ],
  });

  assert.equal(result.matches.get("administration")?.current.id, "701");
  assert.equal(result.matches.get("organization")?.current.id, "702");
  assert.equal(result.diagnostics.some((item) => item.severity === "error"), false);
});

test("context score disambiguates equal channel names by desired parent", () => {
  const desired = [
    { key: "first", name: "status", parentId: "801" },
    { key: "second", name: "status", parentId: "802" },
  ];
  const result = matchResources({
    desired,
    current: [
      { id: "811", name: "status", parentId: "802" },
      { id: "812", name: "status", parentId: "801" },
    ],
    candidateScoreBonus: (wanted, actual) =>
      wanted.parentId === actual.parentId ? 3 : 0,
  });

  assert.equal(result.matches.get("first")?.current.id, "812");
  assert.equal(result.matches.get("second")?.current.id, "811");
  assert.deepEqual(result.diagnostics, []);
});
