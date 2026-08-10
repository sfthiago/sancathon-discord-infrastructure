import { normalizeName } from "../utils/names.js";

function candidateScore(desired, current) {
  const normalized = normalizeName(current.name);
  if (normalizeName(desired.name) === normalized) return 2;
  if ((desired.aliases ?? []).some((alias) => normalizeName(alias) === normalized)) {
    return 1;
  }
  return 0;
}

function scoredCandidate(desired, current, candidateScoreBonus) {
  const nameScore = candidateScore(desired, current);
  if (nameScore === 0) return 0;
  const bonus = Number(candidateScoreBonus(desired, current) ?? 0);
  if (!Number.isFinite(bonus) || bonus < 0) {
    throw new TypeError("Bonus de matching deve ser um numero finito e nao negativo.");
  }
  return nameScore + bonus;
}

function addFlowEdge(graph, from, to, capacity, cost, metadata = null) {
  const forward = {
    to,
    reverseIndex: graph[to].length,
    capacity,
    cost,
    metadata,
  };
  const reverse = {
    to: from,
    reverseIndex: graph[from].length,
    capacity: 0,
    cost: -cost,
    metadata: null,
  };
  graph[from].push(forward);
  graph[to].push(reverse);
}

/**
 * Finds a global one-to-one assignment. Cardinality has precedence over the
 * quality score, while canonical names have precedence over aliases among
 * assignments with the same cardinality.
 */
function assignmentEdgeKey(desiredKey, currentId) {
  return `${desiredKey}\u0000${currentId}`;
}

function assignGlobally(
  desired,
  current,
  candidatesByDesiredKey,
  excludedEdges = new Set(),
) {
  const source = 0;
  const desiredOffset = 1;
  const currentOffset = desiredOffset + desired.length;
  const sink = currentOffset + current.length;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const currentIndexById = new Map(
    current.map((resource, index) => [resource.id, index]),
  );
  const maximumCandidateScore = Math.max(
    0,
    ...desired.flatMap((resource) =>
      (candidatesByDesiredKey.get(resource.key) ?? []).map(
        (candidate) => candidate.score,
      ),
    ),
  );
  const cardinalityWeight = desired.length * maximumCandidateScore + 1;

  desired.forEach((resource, desiredIndex) => {
    const desiredNode = desiredOffset + desiredIndex;
    addFlowEdge(graph, source, desiredNode, 1, 0);
    for (const candidate of candidatesByDesiredKey.get(resource.key) ?? []) {
      if (
        excludedEdges.has(
          assignmentEdgeKey(resource.key, candidate.current.id),
        )
      ) {
        continue;
      }
      const currentIndex = currentIndexById.get(candidate.current.id);
      if (currentIndex === undefined) continue;
      addFlowEdge(
        graph,
        desiredNode,
        currentOffset + currentIndex,
        1,
        -(cardinalityWeight + candidate.score),
        {
          desiredKey: resource.key,
          currentId: candidate.current.id,
          score: candidate.score,
        },
      );
    }
  });
  current.forEach((resource, currentIndex) => {
    addFlowEdge(graph, currentOffset + currentIndex, sink, 1, 0);
  });

  while (true) {
    const distance = Array(graph.length).fill(Number.POSITIVE_INFINITY);
    const previousNode = Array(graph.length).fill(-1);
    const previousEdge = Array(graph.length).fill(-1);
    distance[source] = 0;

    for (let iteration = 0; iteration < graph.length - 1; iteration += 1) {
      let changed = false;
      for (let node = 0; node < graph.length; node += 1) {
        if (!Number.isFinite(distance[node])) continue;
        for (let edgeIndex = 0; edgeIndex < graph[node].length; edgeIndex += 1) {
          const edge = graph[node][edgeIndex];
          if (edge.capacity === 0) continue;
          const nextDistance = distance[node] + edge.cost;
          if (nextDistance >= distance[edge.to]) continue;
          distance[edge.to] = nextDistance;
          previousNode[edge.to] = node;
          previousEdge[edge.to] = edgeIndex;
          changed = true;
        }
      }
      if (!changed) break;
    }

    if (!Number.isFinite(distance[sink])) break;
    for (let node = sink; node !== source; node = previousNode[node]) {
      const from = previousNode[node];
      const edge = graph[from][previousEdge[node]];
      edge.capacity -= 1;
      graph[node][edge.reverseIndex].capacity += 1;
    }
  }

  const assignment = new Map();
  const scoreByCurrentId = new Map();
  let score = 0;
  desired.forEach((resource, desiredIndex) => {
    const desiredNode = desiredOffset + desiredIndex;
    const selected = graph[desiredNode].find(
      (edge) => edge.metadata && edge.capacity === 0,
    );
    if (!selected) return;
    assignment.set(resource.key, selected.metadata.currentId);
    scoreByCurrentId.set(selected.metadata.currentId, selected.metadata.score);
    score += selected.metadata.score;
  });
  return {
    assignment,
    scoreByCurrentId,
    matchCount: assignment.size,
    score,
  };
}

export function matchResources({
  desired,
  current,
  stateIds = {},
  isCompatible = () => true,
  candidateScoreBonus = () => 0,
}) {
  const matches = new Map();
  const diagnostics = [];
  const currentById = new Map(current.map((resource) => [resource.id, resource]));
  const claimedCurrentIds = new Set();

  for (const desiredResource of desired) {
    const stateId = stateIds[desiredResource.key];
    if (!stateId) continue;
    const currentResource = currentById.get(stateId);
    if (!currentResource) {
      diagnostics.push({
        severity: "warning",
        code: "STALE_STATE_ID",
        resourceKey: desiredResource.key,
        message: `ID salvo para ${desiredResource.name} nao existe mais; buscando por nome.`,
      });
      continue;
    }
    if (!isCompatible(desiredResource, currentResource)) {
      diagnostics.push({
        severity: "error",
        code: "STATE_TYPE_MISMATCH",
        resourceKey: desiredResource.key,
        resourceId: currentResource.id,
        message: `ID salvo para ${desiredResource.name} aponta para tipo incompativel.`,
      });
      continue;
    }
    if (claimedCurrentIds.has(currentResource.id)) {
      diagnostics.push({
        severity: "error",
        code: "STATE_ID_REUSED",
        resourceKey: desiredResource.key,
        resourceId: currentResource.id,
        message: `O mesmo ID salvo foi associado a mais de uma key.`,
      });
      continue;
    }
    matches.set(desiredResource.key, {
      desired: desiredResource,
      current: currentResource,
      source: "state",
    });
    claimedCurrentIds.add(currentResource.id);
  }

  const remainingDesired = desired.filter((item) => !matches.has(item.key));
  const remainingCurrent = current.filter((item) => !claimedCurrentIds.has(item.id));
  const graph = new Map();

  for (const desiredResource of remainingDesired) {
    const namedCandidates = remainingCurrent
      .map((currentResource) => ({
        current: currentResource,
        score: scoredCandidate(
          desiredResource,
          currentResource,
          candidateScoreBonus,
        ),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.current.id.localeCompare(right.current.id),
      );
    const compatibleCandidates = namedCandidates.filter((candidate) =>
      isCompatible(desiredResource, candidate.current),
    );

    const candidatesClaimableBySibling = namedCandidates.filter((candidate) =>
      remainingDesired.some(
        (otherDesired) =>
          otherDesired.key !== desiredResource.key &&
          candidateScore(otherDesired, candidate.current) > 0 &&
          isCompatible(otherDesired, candidate.current),
      ),
    );
    if (
      namedCandidates.length > 0 &&
      compatibleCandidates.length === 0 &&
      candidatesClaimableBySibling.length === 0
    ) {
      diagnostics.push({
        severity: "error",
        code: "RESOURCE_TYPE_MISMATCH",
        resourceKey: desiredResource.key,
        resourceId: namedCandidates[0].current.id,
        message: `${desiredResource.name} existe com tipo incompativel; corrija manualmente.`,
      });
    }

    graph.set(desiredResource.key, compatibleCandidates);
  }

  const desiredByKey = new Map(remainingDesired.map((item) => [item.key, item]));
  const optimal = assignGlobally(
    remainingDesired,
    remainingCurrent,
    graph,
  );
  const { assignment } = optimal;

  const ambiguousKeys = new Set();
  for (const [desiredKey, currentId] of assignment) {
    const alternative = assignGlobally(
      remainingDesired,
      remainingCurrent,
      graph,
      new Set([assignmentEdgeKey(desiredKey, currentId)]),
    );
    if (
      alternative.matchCount !== optimal.matchCount ||
      alternative.score !== optimal.score
    ) {
      continue;
    }
    for (const desiredResource of remainingDesired) {
      if (
        assignment.get(desiredResource.key) !==
        alternative.assignment.get(desiredResource.key)
      ) {
        ambiguousKeys.add(desiredResource.key);
      }
    }
  }

  for (const [desiredKey, currentId] of assignment) {
    if (ambiguousKeys.has(desiredKey)) continue;
    const desiredResource = desiredByKey.get(desiredKey);
    const currentResource = currentById.get(currentId);
    matches.set(desiredKey, {
      desired: desiredResource,
      current: currentResource,
      source:
        normalizeName(desiredResource.name) === normalizeName(currentResource.name)
          ? "name"
          : "alias",
    });
    claimedCurrentIds.add(currentId);
  }

  for (const desiredKey of ambiguousKeys) {
    const desiredResource = desiredByKey.get(desiredKey);
    diagnostics.push({
      severity: "error",
      code: "AMBIGUOUS_RESOURCE_MATCH",
      resourceKey: desiredKey,
      resourceId: assignment.get(desiredKey) ?? null,
      message: `Nao e possivel associar ${desiredResource.name} de forma univoca; use o arquivo de state para fixar o ID.`,
    });
  }

  return {
    matches,
    unmatchedDesired: desired.filter((item) => !matches.has(item.key)),
    unmatchedCurrent: current.filter((item) => !claimedCurrentIds.has(item.id)),
    diagnostics,
  };
}
