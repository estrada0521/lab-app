"use strict";

(function () {
  let _rows = 2, _cols = 2;
  let _grid = [];
  let _selectedKeys = new Set();
  let _lastKey = null;
  let _focusDataId = null;
  let _entries = [];
  let _entriesIdx = {};
  let _rawEntries = [];
  let _samplesIndex = {};
  let _sampleMaterialIndex = {};
  let _expsStartIndex = {};

  const statusEl = document.getElementById("status");

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("error", Boolean(isError));
  }

  function esc(s) {
    return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  // ── Grid model ────────────────────────────────────────────────────────────
  function kStr(r, c) { return `${r},${c}`; }
  function kParse(k) { return k.split(",").map(Number); }
  function getCell(r, c) { return _grid[r]?.[c] ?? null; }

  function resizeGrid(newRows, newCols) {
    const old = _grid;
    _grid = [];
    for (let r = 0; r < newRows; r++) {
      _grid[r] = [];
      for (let c = 0; c < newCols; c++) {
        const prev = old[r]?.[c];
        _grid[r][c] = prev
          ? { ...prev, row: r, col: c }
          : { row: r, col: c, rowspan: 1, colspan: 1, data_ids: [] };
      }
    }
    _rows = newRows;
    _cols = newCols;
    const covered = coveredSet();
    _selectedKeys = new Set([..._selectedKeys].filter(k => {
      const [r, c] = kParse(k);
      return r < newRows && c < newCols && !covered.has(k);
    }));
  }

  function coveredSet() {
    const s = new Set();
    for (let r = 0; r < _rows; r++) {
      for (let c = 0; c < _cols; c++) {
        const cell = _grid[r]?.[c];
        if (!cell || (cell.rowspan <= 1 && cell.colspan <= 1)) continue;
        for (let dr = 0; dr < cell.rowspan; dr++) {
          for (let dc = 0; dc < cell.colspan; dc++) {
            if (dr || dc) s.add(kStr(r + dr, c + dc));
          }
        }
      }
    }
    return s;
  }

  // ── Grid render ───────────────────────────────────────────────────────────
  function renderGrid() {
    const container = document.getElementById("asGrid");
    container.style.gridTemplateColumns = `repeat(${_cols}, 1fr)`;
    container.style.gridTemplateRows = `repeat(${_rows}, 1fr)`;
    container.innerHTML = "";

    const covered = coveredSet();

    for (let r = 0; r < _rows; r++) {
      for (let c = 0; c < _cols; c++) {
        const key = kStr(r, c);
        if (covered.has(key)) continue;
        const cell = _grid[r][c];

        const el = document.createElement("div");
        el.className = "as-cell";
        el.dataset.key = key;
        if (_selectedKeys.has(key)) el.classList.add("as-cell-selected");
        if (cell.data_ids.length) el.classList.add("as-cell-has-data");

        el.style.gridRow = `${r + 1} / span ${cell.rowspan}`;
        el.style.gridColumn = `${c + 1} / span ${cell.colspan}`;

        const names = document.createElement("div");
        names.className = "as-cell-names";
        if (cell.data_ids.length) {
          for (const did of cell.data_ids) {
            const line = document.createElement("div");
            line.className = "as-cell-name";
            line.textContent = (_entriesIdx[did]?.display_name) || did;
            names.appendChild(line);
          }
        }
        el.appendChild(names);

        const pos = document.createElement("span");
        pos.className = "as-cell-pos";
        const spanLabel = (cell.rowspan > 1 || cell.colspan > 1) ? ` ${cell.rowspan}×${cell.colspan}` : "";
        pos.textContent = `${r + 1},${c + 1}${spanLabel}`;
        el.appendChild(pos);

        el.addEventListener("click", e => handleCellClick(e, key));
        container.appendChild(el);
      }
    }
  }

  // ── Cell selection ────────────────────────────────────────────────────────
  function handleCellClick(e, key) {
    const covered = coveredSet();
    if (covered.has(key)) return;

    if (e.shiftKey && _lastKey) {
      const [r0, c0] = kParse(_lastKey);
      const [r1, c1] = kParse(key);
      const minR = Math.min(r0, r1), maxR = Math.max(r0, r1);
      const minC = Math.min(c0, c1), maxC = Math.max(c0, c1);
      if (!e.metaKey) _selectedKeys.clear();
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const k = kStr(r, c);
          if (!covered.has(k)) _selectedKeys.add(k);
        }
      }
    } else if (e.metaKey) {
      if (_selectedKeys.has(key)) _selectedKeys.delete(key);
      else _selectedKeys.add(key);
      _lastKey = key;
    } else {
      _selectedKeys.clear();
      _selectedKeys.add(key);
      _lastKey = key;
    }

    renderGrid();
    renderRightCellSection();
  }

  // ── Right pane (cell assignment: same visual language as workspace Links) ───
  function renderRightCellSection() {
    const listEl = document.getElementById("asCellLinksList");
    const wrapEl = document.getElementById("asCellAssignWrap");
    const headingEl = document.getElementById("asCellHeading");
    const addBtn = document.getElementById("asAddBtn");
    if (!listEl || !wrapEl || !headingEl) return;

    listEl.innerHTML = "";

    if (_selectedKeys.size === 0) {
      wrapEl.hidden = true;
      addBtn.disabled = true;
      return;
    }

    wrapEl.hidden = false;

    const selCells = [..._selectedKeys]
      .map(k => { const [r, c] = kParse(k); return getCell(r, c); })
      .filter(Boolean);

    const seen = new Set(selCells.flatMap(cell => cell.data_ids));

    if (seen.size === 0) {
      headingEl.hidden = true;
    } else {
      headingEl.hidden = false;
      for (const did of seen) {
        const row = document.createElement("div");
        row.className = "as-cell-link-row";

        const linkBtn = document.createElement("button");
        linkBtn.type = "button";
        linkBtn.className = "catalog-record-link as-cell-link-btn" + (did === _focusDataId ? " is-active" : "");
        linkBtn.title = did;

        const lab = document.createElement("span");
        lab.className = "catalog-record-link-label";
        lab.textContent = (_entriesIdx[did]?.display_name) || did;
        linkBtn.appendChild(lab);
        if (did !== lab.textContent) {
          const sub = document.createElement("span");
          sub.className = "catalog-record-link-sub";
          sub.textContent = did;
          linkBtn.appendChild(sub);
        }

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "as-cell-remove";
        removeBtn.setAttribute("aria-label", "Remove from cell");
        removeBtn.title = "Remove from cell";
        removeBtn.textContent = "×";

        linkBtn.addEventListener("click", () => {
          _focusDataId = did;
          renderDataList();
          renderRightCellSection();
          loadPreview(did);
        });

        removeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          for (const cell of selCells) {
            cell.data_ids = cell.data_ids.filter(d => d !== did);
            if (!cell.data_ids.length) { cell.rowspan = 1; cell.colspan = 1; }
          }
          if (_focusDataId === did) _focusDataId = null;
          renderGrid();
          renderRightCellSection();
        });

        row.appendChild(linkBtn);
        row.appendChild(removeBtn);
        listEl.appendChild(row);
      }
    }

    addBtn.disabled = !_focusDataId || _selectedKeys.size === 0;
  }

  // ── Add to cell ───────────────────────────────────────────────────────────
  function addToCell() {
    if (!_focusDataId || _selectedKeys.size === 0) return;
    for (const key of _selectedKeys) {
      const [r, c] = kParse(key);
      const cell = getCell(r, c);
      if (cell && !cell.data_ids.includes(_focusDataId)) {
        cell.data_ids.push(_focusDataId);
      }
    }
    renderGrid();
    renderRightCellSection();
  }

  // ── Data list ─────────────────────────────────────────────────────────────
  function renderDataList() {
    const container = document.getElementById("asDataList");
    const kind = document.getElementById("asKindFilter").value;
    const condition = document.getElementById("asConditionFilter").value;
    const sample = document.getElementById("asSampleFilter").value;

    let list = _entries;
    if (kind) list = list.filter(e => (e.measurement || "") === kind);
    if (condition) list = list.filter(e => (e.dependance || "") === condition);
    if (sample) list = list.filter(e => (e.sample || "") === sample);

    container.innerHTML = "";
    for (const entry of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "browser-file" + (entry.id === _focusDataId ? " current" : "");
      btn.dataset.id = entry.id;

      const name = document.createElement("div");
      name.className = "browser-file-name";
      name.textContent = entry.display_name || entry.id;
      btn.appendChild(name);

      btn.addEventListener("click", () => {
        _focusDataId = entry.id;
        renderDataList();
        renderRightCellSection();
        loadPreview(entry.id);
      });
      container.appendChild(btn);
    }

    if (!list.length) {
      const msg = document.createElement("div");
      msg.className = "as-hint";
      msg.style.padding = "12px";
      msg.textContent = "No data found";
      container.appendChild(msg);
    }
  }

  function populateFilters() {
    const kinds = [...new Set(_entries.map(e => e.measurement).filter(Boolean))].sort();
    const conditions = [...new Set(_entries.map(e => e.dependance).filter(Boolean))].sort();
    const samples = [...new Set(_entries.map(e => e.sample).filter(Boolean))].sort();

    document.getElementById("asKindFilter").innerHTML = '<option value="">all kinds</option>' +
      kinds.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("");
    document.getElementById("asConditionFilter").innerHTML = '<option value="">all conditions</option>' +
      conditions.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    document.getElementById("asSampleFilter").innerHTML = '<option value="">all samples</option>' +
      samples.map(s => {
        const label = _samplesIndex[s] || s;
        return `<option value="${esc(s)}">${esc(label)}</option>`;
      }).join("");
  }

  function findRawEntryForData(dataEntry, meta) {
    const rs = String(dataEntry?.raw_source || "").trim();
    if (rs) {
      let hit = _rawEntries.find(r => String(r.path || "") === rs);
      if (!hit) {
        const prefix = rs.split("/").slice(0, 2).join("/");
        hit = _rawEntries.find(r => {
          const p = String(r.path || "");
          return p === prefix || p.startsWith(prefix + "/");
        });
      }
      if (hit) return hit;
    }
    const rid = String(meta?.rawdata_id || "").trim();
    if (rid) return _rawEntries.find(r => r.id === rid) || null;
    return null;
  }

  // ── Graph preview ─────────────────────────────────────────────────────────
  async function loadPreview(dataId) {
    const graphEl = document.getElementById("asPreviewGraph");
    const infoEl = document.getElementById("asPreviewInfo");
    graphEl.innerHTML = '<span class="as-hint">Loading…</span>';
    infoEl.innerHTML = "";

    const entry = _entriesIdx[dataId];
    const metaPath = `data/${dataId}/metadata.json`;
    let meta = {};
    try {
      meta = await fetchRepoJson(metaPath);
    } catch (_) {
      meta = {};
    }

    const rawEntry = findRawEntryForData(entry, meta);
    const rawSourcePath = String(entry?.raw_source || rawEntry?.path || "").trim();
    try {
      if (typeof buildDataInfoRows === "function" && typeof renderStructuredInfoGrid === "function") {
        const rows = buildDataInfoRows(meta, {
          rawEntry,
          rawSourcePath,
          samplesIndex: _samplesIndex,
          sampleMaterialIndex: _sampleMaterialIndex,
          expsStartIndex: _expsStartIndex,
        });
        renderStructuredInfoGrid(infoEl, rows.filter(([k]) => shouldRenderInfoKey(k)), {
          keyClass: "data-info-key",
          valueClass: "data-info-val",
        });
      } else {
        infoEl.innerHTML = '<div class="data-info-key muted">—</div><div class="data-info-val">—</div>';
      }
    } catch (_) {
      infoEl.innerHTML = '<div class="data-info-key muted">—</div><div class="data-info-val">—</div>';
    }

    try {
      const csvPath = `data/${dataId}/${dataId}.csv`;
      const summary = await fetch(`/api/table?path=${encodeURIComponent(csvPath)}`)
        .then(r => r.ok ? r.json() : null);
      if (!summary) { graphEl.innerHTML = '<span class="as-hint">No CSV found</span>'; return; }

      const x = summary.suggested_x, y = summary.suggested_y;
      if (!x || !y) { graphEl.innerHTML = '<span class="as-hint">No suggested axes</span>'; return; }

      const plotData = await fetch(
        `/api/plot?path=${encodeURIComponent(csvPath)}&x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}`
      ).then(r => r.ok ? r.json() : null);

      if (!plotData?.points?.length) { graphEl.innerHTML = '<span class="as-hint">No plot data</span>'; return; }
      graphEl.innerHTML = "";
      graphEl.appendChild(renderSparkline(plotData.points, x, y));
    } catch (err) {
      graphEl.innerHTML = `<span class="as-hint">${esc(err.message)}</span>`;
    }
  }

  function renderSparkline(points, xLabel, yLabel) {
    const PAD = { top: 16, right: 12, bottom: 34, left: 48 };
    const W = 240, H = 240;
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const xR = xMax - xMin || 1, yR = yMax - yMin || 1;
    const iw = W - PAD.left - PAD.right, ih = H - PAD.top - PAD.bottom;

    function px(v) { return PAD.left + (v - xMin) / xR * iw; }
    function py(v) { return PAD.top + ih - (v - yMin) / yR * ih; }
    function fmt(v) {
      if (Math.abs(v) >= 10000 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(1);
      return (+v.toFixed(3)).toString();
    }

    const path = points.map((p, i) => `${i ? "L" : "M"}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join(" ");
    const N = 4;
    const xt = Array.from({ length: N + 1 }, (_, i) => xMin + xR * i / N);
    const yt = Array.from({ length: N + 1 }, (_, i) => yMin + yR * i / N);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "as-sparkline");
    svg.innerHTML =
      `<rect x="${PAD.left}" y="${PAD.top}" width="${iw}" height="${ih}" fill="none" stroke="var(--line)" stroke-width="1"/>` +
      xt.map(v =>
        `<text x="${px(v).toFixed(1)}" y="${(PAD.top + ih + 12).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--muted)">${esc(fmt(v))}</text>`
      ).join("") +
      yt.map(v =>
        `<text x="${(PAD.left - 4).toFixed(1)}" y="${py(v).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="var(--muted)">${esc(fmt(v))}</text>`
      ).join("") +
      `<text x="${(PAD.left + iw / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle" font-size="9" fill="var(--muted)">${esc(xLabel)}</text>` +
      `<text transform="translate(10,${(PAD.top + ih / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" font-size="9" fill="var(--muted)">${esc(yLabel)}</text>` +
      `<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    return svg;
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  async function doStart() {
    const btn = document.getElementById("asStartBtn");
    btn.disabled = true;
    setStatus("Creating…");
    try {
      const display_name = document.getElementById("asDisplayName").value.trim();
      const covered = coveredSet();
      const cells = [];
      for (let r = 0; r < _rows; r++) {
        for (let c = 0; c < _cols; c++) {
          if (covered.has(kStr(r, c))) continue;
          const cell = _grid[r][c];
          cells.push({ row: cell.row, col: cell.col, rowspan: cell.rowspan, colspan: cell.colspan, data_ids: [...cell.data_ids] });
        }
      }
      const resp = await fetch("/api/analysis-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name, grid: { rows: _rows, cols: _cols, cells } }),
      });
      const d = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(d.error || resp.statusText);
      setStatus(`Created ${d.id} — opening VS Code…`);
      setTimeout(() => { window.location.href = "/analysis/"; }, 1200);
    } catch (err) {
      setStatus(err.message, true);
      btn.disabled = false;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    resizeGrid(2, 2);
    renderGrid();
    renderRightCellSection();

    try {
      const [rawD, dataD] = await Promise.all([
        fetch("/api/raw-files").then(r => r.json()),
        fetch("/api/data-files").then(r => r.json()),
      ]);
      _rawEntries = rawD.entries || [];
      _entries = dataD.entries || [];
      _samplesIndex = dataD.samples_index || rawD.samples_index || {};
      _sampleMaterialIndex = dataD.sample_material_index || rawD.sample_material_index || {};
      _expsStartIndex = dataD.exps_start_index || rawD.exps_start_index || {};
      _entriesIdx = {};
      for (const e of _entries) _entriesIdx[e.id] = e;
    } catch (_) {
      _rawEntries = [];
      _entries = [];
      _entriesIdx = {};
    }

    populateFilters();
    renderDataList();

    document.getElementById("asKindFilter").addEventListener("change", renderDataList);
    document.getElementById("asConditionFilter").addEventListener("change", renderDataList);
    document.getElementById("asSampleFilter").addEventListener("change", renderDataList);

    document.getElementById("asRows").addEventListener("change", e => {
      const v = Math.max(1, Math.min(8, parseInt(e.target.value) || 2));
      e.target.value = v;
      resizeGrid(v, _cols);
      renderGrid();
      renderRightCellSection();
    });
    document.getElementById("asCols").addEventListener("change", e => {
      const v = Math.max(1, Math.min(8, parseInt(e.target.value) || 2));
      e.target.value = v;
      resizeGrid(_rows, v);
      renderGrid();
      renderRightCellSection();
    });

    document.getElementById("asAddBtn").addEventListener("click", addToCell);
    document.getElementById("asStartBtn").addEventListener("click", doStart);

    document.getElementById("asStartBtn").disabled = _entries.length === 0;
    document.getElementById("asDisplayName").addEventListener("input", () => {
      document.getElementById("asStartBtn").disabled = _entries.length === 0;
    });

    initPaneResize({
      root: document.getElementById("asMain"),
      container: document.getElementById("asMain"),
      leftSplitterId: "leftSplitter",
      rightSplitterId: "rightSplitter",
      storagePrefix: "lab-new-analysis",
      left: { min: 140, max: 420, reserve: 460 },
      right: { min: 200, max: 400, reserve: 440 },
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
