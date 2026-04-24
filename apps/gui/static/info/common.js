function humanizeInfoLabel(key) {
  const text = String(key || "").trim();
  if (!text) return "";
  return text
    .split("_")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildConditionInfoRows(conditions) {
  if (!conditions || typeof conditions !== "object") return [];
  const rows = [];
  const sweep = conditions.sweep;
  if (Array.isArray(sweep) && sweep.length) {
    rows.push(["Sweep", sweep.join(", ")]);
  }
  const fixed = conditions.fixed;
  if (fixed && typeof fixed === "object") {
    for (const [key, value] of Object.entries(fixed)) {
      rows.push([humanizeInfoLabel(key), value]);
    }
  }
  for (const [key, value] of Object.entries(conditions)) {
    if (key === "sweep" || key === "fixed") continue;
    rows.push([humanizeInfoLabel(key), value]);
  }
  return rows;
}

