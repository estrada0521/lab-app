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
            line.className = "as-cell-name" + (did === _focusDataId ? " as-cell-name-current" : "");
            line.textContent = (_entriesIdx[did]?.display_name) || did;
            line.title = did;
            line.addEventListener("click", (ev) => {
              ev.stopPropagation();
              _selectedKeys.clear();
              _selectedKeys.add(key);
              _lastKey = key;
              _focusDataId = did;
              renderGrid();
              renderDataList();
              syncToolbar();
              loadPreview(did);
            });
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
      _lastKey = key;
    } else if (e.metaKey) {
      if (_selectedKeys.has(key)) _selectedKeys.delete(key);
      else _selectedKeys.add(key);
      _lastKey = key;
    } else {
      const [r, c] = kParse(key);
      const cell = getCell(r, c);

      _selectedKeys.clear();
      _selectedKeys.add(key);
      _lastKey = key;

      if (cell?.data_ids?.length) {
        /* Cell body: selection only; central pane updates only on .as-cell-name click or list click. */
        renderGrid();
        syncToolbar();
        return;
      }
    }

    renderGrid();
    renderDataList();
    syncToolbar();
  }

  function focusInAnySelectedCell() {
    if (!_focusDataId || !_selectedKeys.size) return false;
    for (const key of _selectedKeys) {
      const [r, c] = kParse(key);
      const cell = getCell(r, c);
      if (cell?.data_ids?.includes(_focusDataId)) return true;
    }
    return false;
  }

  function syncToolbar() {
    const titleEl = document.getElementById("asPreviewTitle");
    const addBtn = document.getElementById("asAddBtn");
    const delBtn = document.getElementById("asDeleteBtn");
    if (titleEl) {
      const label = _focusDataId
        ? ((_entriesIdx[_focusDataId]?.display_name) || _focusDataId)
        : "—";
      titleEl.textContent = label;
      titleEl.title = _focusDataId ? String(_focusDataId) : "";
    }
    if (addBtn) addBtn.disabled = !_focusDataId || _selectedKeys.size === 0;
    if (delBtn) delBtn.disabled = !focusInAnySelectedCell();
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
    syncToolbar();
  }

  function deleteFromCell() {
    if (!focusInAnySelectedCell()) return;
    const id = _focusDataId;
    for (const key of _selectedKeys) {
      const [r, c] = kParse(key);
      const cell = getCell(r, c);
      if (!cell) continue;
      cell.data_ids = cell.data_ids.filter(d => d !== id);
      if (!cell.data_ids.length) { cell.rowspan = 1; cell.colspan = 1; }
    }
    _focusDataId = null;
    const graphEl = document.getElementById("asPreviewGraph");
    const infoEl = document.getElementById("asPreviewInfo");
    if (graphEl) graphEl.innerHTML = '<span class="as-hint">Click data from the list</span>';
    if (infoEl) infoEl.innerHTML = "";
    renderGrid();
    renderDataList();
    syncToolbar();
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

    const idSet = new Set(list.map(e => e.id));
    if (_focusDataId && !idSet.has(_focusDataId)) {
      _focusDataId = null;
      const graphEl = document.getElementById("asPreviewGraph");
      const infoEl = document.getElementById("asPreviewInfo");
      if (graphEl) graphEl.innerHTML = '<span class="as-hint">Click data from the list</span>';
      if (infoEl) infoEl.innerHTML = "";
      renderGrid();
    }

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
        renderGrid();
        syncToolbar();
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

    syncToolbar();
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
    syncToolbar();
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
    const PAD = { top: 16, right: 14, bottom: 42, left: 56 };
    const W = 260, H = 260;
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

    const linePath = points.map((p, i) => `${i ? "L" : "M"}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join(" ");
    const N = 4;
    const xt = Array.from({ length: N + 1 }, (_, i) => xMin + xR * i / N);
    const yt = Array.from({ length: N + 1 }, (_, i) => yMin + yR * i / N);

    const ink = "#1a1a1a";
    const tick = "#444444";
    const grid = "#cccccc";

    const gridLines =
      xt.map(v => `<line x1="${px(v).toFixed(1)}" y1="${PAD.top}" x2="${px(v).toFixed(1)}" y2="${(PAD.top + ih).toFixed(1)}" stroke="${grid}" stroke-width="0.5"/>`).join("") +
      yt.map(v => `<line x1="${PAD.left}" y1="${py(v).toFixed(1)}" x2="${(PAD.left + iw).toFixed(1)}" y2="${py(v).toFixed(1)}" stroke="${grid}" stroke-width="0.5"/>`).join("");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "as-sparkline");
    svg.innerHTML =
      `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>` +
      `<rect x="${PAD.left}" y="${PAD.top}" width="${iw}" height="${ih}" fill="none"/>` +
      gridLines +
      `<rect x="${PAD.left}" y="${PAD.top}" width="${iw}" height="${ih}" fill="none" stroke="${tick}" stroke-width="1"/>` +
      xt.map(v =>
        `<text x="${px(v).toFixed(1)}" y="${(PAD.top + ih + 14).toFixed(1)}" text-anchor="middle" font-size="11" fill="${tick}">${esc(fmt(v))}</text>`
      ).join("") +
      yt.map(v =>
        `<text x="${(PAD.left - 5).toFixed(1)}" y="${py(v).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="${tick}">${esc(fmt(v))}</text>`
      ).join("") +
      `<text x="${(PAD.left + iw / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle" font-size="11" fill="${tick}">${esc(xLabel)}</text>` +
      `<text transform="translate(12,${(PAD.top + ih / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" font-size="11" fill="${tick}">${esc(yLabel)}</text>` +
      `<path d="${linePath}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
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
      setStatus(`Created ${d.id} — opening Antigravity…`);
      const q = new URLSearchParams({ id: d.id, open_output: "1" });
      setTimeout(() => {
        window.location.href = `/analysis/?${q}`;
      }, 400);
    } catch (err) {
      setStatus(err.message, true);
      btn.disabled = false;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    resizeGrid(2, 2);
    renderGrid();
    syncToolbar();

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
      syncToolbar();
    });
    document.getElementById("asCols").addEventListener("change", e => {
      const v = Math.max(1, Math.min(8, parseInt(e.target.value) || 2));
      e.target.value = v;
      resizeGrid(_rows, v);
      renderGrid();
      syncToolbar();
    });

    document.getElementById("asAddBtn").addEventListener("click", addToCell);
    document.getElementById("asDeleteBtn").addEventListener("click", deleteFromCell);
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
      right: { min: 200, max: 720, reserve: 380 },
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
