function buildDataInfoRows(meta) {
  const data = meta && typeof meta === "object" ? meta : {};
  const rows = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === "conditions") {
      rows.push(...buildConditionInfoRows(value));
      continue;
    }
    rows.push([key, value]);
  }
  return rows;
}

