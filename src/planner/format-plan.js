const symbols = {
  CREATE: "+",
  UPDATE: "~",
  OK: "=",
  UNMANAGED: "?",
  DEFERRED: ">",
  ERROR: "!",
};

const headings = {
  role: "ROLES",
  roleHierarchy: "ROLE HIERARCHY",
  category: "CATEGORIES",
  channel: "CHANNELS",
  unmanaged: "UNMANAGED",
};

function displayValue(value) {
  if (value === null || value === undefined) return "inherit";
  if (Array.isArray(value)) return value.join(", ") || "(none)";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatPlan(plan, { guildName, mode }) {
  const lines = [
    "[SANCATHON DISCORD]",
    "",
    `Guild: ${guildName}`,
    `Mode: ${mode}`,
    "",
  ];

  for (const resourceType of ["role", "roleHierarchy", "category", "channel"]) {
    const items = plan.entries.filter(
      (entry) => entry.resourceType === resourceType && entry.status !== "UNMANAGED",
    );
    if (items.length === 0) continue;
    lines.push(headings[resourceType], "");
    for (const item of items) {
      lines.push(`${symbols[item.status]} ${item.status.padEnd(8)} ${item.name}`);
      for (const change of item.changes) {
        lines.push(
          `    ${change.path}: ${displayValue(change.from)} -> ${displayValue(change.to)}`,
        );
      }
    }
    lines.push("");
  }

  const unmanaged = plan.entries.filter((entry) => entry.status === "UNMANAGED");
  if (unmanaged.length > 0) {
    lines.push("UNMANAGED", "");
    for (const item of unmanaged) {
      lines.push(`? ${item.resourceType}: ${item.name}`);
    }
    lines.push("");
  }

  if (plan.diagnostics.length > 0) {
    lines.push("DIAGNOSTICS", "");
    for (const item of plan.diagnostics) {
      const prefix = item.severity === "error" ? "! ERROR" : "! WARNING";
      lines.push(`${prefix} [${item.code}] ${item.message}`);
    }
    lines.push("");
  }

  lines.push("--------------------------------", "", "SUMMARY", "");
  lines.push(`CREATE    ${plan.summary.create}`);
  lines.push(`UPDATE    ${plan.summary.update}`);
  lines.push(`DEFERRED  ${plan.summary.deferred ?? 0}`);
  lines.push(`OK        ${plan.summary.ok}`);
  lines.push(`UNMANAGED ${plan.summary.unmanaged}`);
  lines.push(`ERROR     ${plan.summary.error}`);
  lines.push("DELETE    0");
  lines.push("");
  if (!plan.hasChanges && !plan.hasErrors) lines.push("No changes required.");
  return lines.join("\n");
}
