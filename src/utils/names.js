export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("pt-BR");
}

export function namesMatch(left, right) {
  return normalizeName(left) === normalizeName(right);
}

export function candidateNames(resource) {
  return [resource.name, ...(resource.aliases ?? [])];
}

export function isCandidateName(resource, currentName) {
  const normalizedCurrent = normalizeName(currentName);
  return candidateNames(resource).some(
    (name) => normalizeName(name) === normalizedCurrent,
  );
}
