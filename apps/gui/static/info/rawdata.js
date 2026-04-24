function buildRawdataInfoRows(meta, context = {}) {
  const data = meta && typeof meta === "object" ? meta : {};
  const rows = [];
  const sampleNames = context.samplesIndex || {};
  const sampleMaterials = context.sampleMaterialIndex || {};
  const expStarts = context.expsStartIndex || {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "sample_id") {
      const sampleId = String(value || "").trim();
      const materialId = sampleId ? String(sampleMaterials[sampleId] || "").trim() : "";
      if (materialId) rows.push(["material", materialId]);
      rows.push([
        "sample",
        sampleId
          ? infoLinkValue(`/samples/?id=${encodeURIComponent(sampleId)}`, sampleNames[sampleId] || sampleId)
          : "—",
      ]);
      continue;
    }
    if (key === "exp_id") {
      const expId = String(value || "").trim();
      rows.push([
        "experiment",
        expId
          ? infoLinkValue(`/experiments/?id=${encodeURIComponent(expId)}`, expStarts[expId] || expId)
          : "—",
      ]);
      continue;
    }
    if (key === "conditions") {
      rows.push(...buildConditionInfoRows(value));
      continue;
    }
    if (key === "payload_file") {
      rows.push([
        "payload_file",
        infoActionValue("Open in Finder", "open-finder", {
          tone: "finder",
          path: context.rawPath || "",
        }),
      ]);
      continue;
    }
    if (key === "calc") {
      rows.push(["calc", infoCalcValue(value)]);
      continue;
    }
    rows.push([key, value]);
  }
  return rows;
}
