function buildDataInfoRows(meta, context = {}) {
  const data = meta && typeof meta === "object" ? meta : {};
  const rows = [];
  const rawEntry = context.rawEntry && typeof context.rawEntry === "object" ? context.rawEntry : null;
  const rawSourcePath = String(context.rawSourcePath || rawEntry?.path || "").trim();
  const sampleId = String(rawEntry?.sample || "").trim();
  const expId = String(rawEntry?.exp || "").trim();
  const sampleNames = context.samplesIndex || {};
  const sampleMaterials = context.sampleMaterialIndex || {};
  const expStarts = context.expsStartIndex || {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "rawdata_id") {
      const rawdataId = String(value || "").trim();
      rows.push([
        "rawdata",
        rawdataId && rawSourcePath
          ? infoLinkValue(`/?path=${encodeURIComponent(rawSourcePath)}`, rawdataId)
          : rawdataId || "—",
      ]);
      if (sampleId) {
        const materialId = String(sampleMaterials[sampleId] || "").trim();
        if (materialId) rows.push(["material", materialId]);
        rows.push([
          "sample",
          infoLinkValue(`/samples/?id=${encodeURIComponent(sampleId)}`, sampleNames[sampleId] || sampleId),
        ]);
      }
      if (expId) {
        rows.push([
          "experiment",
          infoLinkValue(`/experiments/?id=${encodeURIComponent(expId)}`, expStarts[expId] || expId),
        ]);
      }
      continue;
    }
    if (key === "conditions") {
      rows.push(...buildConditionInfoRows(value));
      continue;
    }
    rows.push([key, value]);
  }
  return rows;
}
