// GridSpec-based layout builder for assigning workspace "data" items into cells/areas.
(() => {
  const STORAGE_KEY = "lab-gridspec-layout-v1";
  const DND_MIME = "application/x-lab-data-path";

  const rowsInput = document.getElementById("gsRows");
  const colsInput = document.getElementById("gsCols");
  const applyBtn = document.getElementById("gsApplyBtn");
  const exportBtn = document.getElementById("gsExportBtn");
  const clearBtn = document.getElementById("gsClearBtn");
  const wrap = document.getElementById("gsWrap");
  const board = wrap.querySelector(".layout-board");
  const grid = document.getElementById("gsGrid");
  const overlay = document.getElementById("gsOverlay");
  const hint = document.getElementById("gsHint");
  const statusEl = document.getElementById("gsStatus");

  function setStatus(message, isError = false) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", isError);
  }

  async function apiJson(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    let payload = {};
    if (text) payload = JSON.parse(text);
    if (!response.ok) throw new Error(payload.error || response.statusText);
    return payload;
  }

  function clampInt(value, min, max, fallback) {
    const num = Number.parseInt(String(value || ""), 10);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, num));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function newIdFromCell(r, c) {
    return `r${r}c${c}`;
  }

  function normalizeState(raw) {
    const fallback = { rows: 2, cols: 2, areas: [] };
    if (!raw || typeof raw !== "object") return fallback;
    const rows = clampInt(raw.rows, 1, 32, fallback.rows);
    const cols = clampInt(raw.cols, 1, 32, fallback.cols);
    const areas = Array.isArray(raw.areas) ? raw.areas : [];
    const normalizedAreas = [];
    for (const a of areas) {
      if (!a || typeof a !== "object") continue;
      const id = String(a.id || "").trim();
      if (!id) continue;
      const r0 = clampInt(a.r0, 0, rows - 1, 0);
      const c0 = clampInt(a.c0, 0, cols - 1, 0);
      const r1 = clampInt(a.r1, r0 + 1, rows, r0 + 1);
      const c1 = clampInt(a.c1, c0 + 1, cols, c0 + 1);
      const items = Array.isArray(a.items) ? a.items : [];
      const safeItems = items
        .filter(it => it && typeof it === "object" && String(it.path || "").trim())
        .map(it => ({ path: String(it.path || ""), display_name: String(it.display_name || "") }));
      normalizedAreas.push({ id, r0, c0, r1, c1, items: safeItems });
    }
    return { rows, cols, areas: normalizedAreas };
  }

  function loadState() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || ""));
    } catch {
      return normalizeState(null);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  let state = loadState();

  // Selection (drag rectangle over cells)
  let selecting = null; // {r0,c0,r1,c1} inclusive coords (kept after drag until Esc/Enter)
  let _selDragging = false;
  let _selStart = null; // {r,c}
  let activeAreaId = "";

  function setGridVars() {
    board.style.setProperty("--gs-rows", String(state.rows));
    board.style.setProperty("--gs-cols", String(state.cols));
  }

  function cellEl(r, c) {
    return grid.querySelector(`.gs-cell[data-r="${r}"][data-c="${c}"]`);
  }

  function areaAtCell(r, c) {
    for (const a of state.areas) {
      if (r >= a.r0 && r < a.r1 && c >= a.c0 && c < a.c1) return a;
    }
    return null;
  }

  async function assignByPoint(clientX, clientY, dataPath) {
    const p = cellFromClientPoint(clientX, clientY);
    if (!p) return;
    const area = areaAtCell(p.r, p.c);
    if (area) {
      await assignToArea(area, dataPath);
    } else {
      await assignToCell(p.r, p.c, dataPath);
    }
  }

  async function assignToSelectionOrPoint(clientX, clientY, dataPath) {
    if (selecting) {
      const rect = { r0: selecting.r0, c0: selecting.c0, r1: selecting.r1, c1: selecting.c1 };
      if (!overlapsAnyArea(rect)) {
        // Create an area matching the current selection, then assign to that area.
        const id = `area-${state.areas.length + 1}`;
        const area = { id, r0: rect.r0, c0: rect.c0, r1: rect.r1 + 1, c1: rect.c1 + 1, items: [] };
        state.areas.push(area);
        activeAreaId = id;
        clearSelection();
        saveState();
        render();
        await assignToArea(area, dataPath);
        return;
      }
      // If selection overlaps an existing area, fall back to point-based assignment.
    }
    await assignByPoint(clientX, clientY, dataPath);
  }

  function cellsInRect(r0, c0, r1, c1) {
    const cells = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) cells.push([r, c]);
    }
    return cells;
  }

  function setSelectionOverlay(rect) {
    grid.querySelectorAll(".gs-cell").forEach(el => {
      el.classList.remove("is-selected");
      el.classList.remove("sel");
    });
    if (!rect) return;
    const { r0, c0, r1, c1 } = rect;
    for (const [r, c] of cellsInRect(r0, c0, r1, c1)) {
      const el = cellEl(r, c);
      if (el) el.classList.add("sel");
    }
  }

  function clearSelection() {
    selecting = null;
    setSelectionOverlay(null);
  }

  function rectFromCells(a, b) {
    const r0 = Math.min(a.r, b.r);
    const c0 = Math.min(a.c, b.c);
    const r1 = Math.max(a.r, b.r);
    const c1 = Math.max(a.c, b.c);
    return { r0, c0, r1, c1 };
  }

  function cellFromClientPoint(clientX, clientY) {
    // Prefer DOM hit-test when possible (fast + accurate on gaps).
    const el = document.elementFromPoint(clientX, clientY);
    const cell = el && el.closest ? el.closest(".gs-cell") : null;
    if (cell && cell.dataset) {
      const r = clampInt(cell.dataset.r, 0, state.rows - 1, 0);
      const c = clampInt(cell.dataset.c, 0, state.cols - 1, 0);
      return { r, c };
    }

    // Fallback: coordinate math (works even when a .gs-area overlays cells).
    // Match gridspec-builder.html: fixed cell size + fixed gap.
    const rect = grid.getBoundingClientRect();
    if (!(clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom)) return null;
    const boardCss = getComputedStyle(board);
    const cellSize = parseFloat(boardCss.getPropertyValue("--gs-cell")) || 56;
    const gap = parseFloat(boardCss.getPropertyValue("--gs-gap")) || 6;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const c = clampInt(Math.floor(x / (cellSize + gap)), 0, state.cols - 1, 0);
    const r = clampInt(Math.floor(y / (cellSize + gap)), 0, state.rows - 1, 0);
    return { r, c };
  }

  function overlapsAnyArea(rect) {
    for (const a of state.areas) {
      const rr0 = rect.r0, cc0 = rect.c0, rr1 = rect.r1 + 1, cc1 = rect.c1 + 1;
      const overlap = !(rr1 <= a.r0 || rr0 >= a.r1 || cc1 <= a.c0 || cc0 >= a.c1);
      if (overlap) return true;
    }
    return false;
  }

  function createAreaFromSelection() {
    if (!selecting) return;
    const { r0, c0, r1, c1 } = selecting;
    const rect = { r0, c0, r1, c1 };
    if (overlapsAnyArea(rect)) {
      setStatus("既存エリアと重なっています（選択を変えてください）", true);
      return;
    }
    const id = `area-${state.areas.length + 1}`;
    state.areas.push({ id, r0, c0, r1: r1 + 1, c1: c1 + 1, items: [] });
    activeAreaId = id;
    clearSelection();
    saveState();
    render();
    setStatus(`エリア ${id} を作成しました`);
  }

  function removeArea(id) {
    state.areas = state.areas.filter(a => a.id !== id);
    if (activeAreaId === id) activeAreaId = "";
    saveState();
    render();
  }

  function setActiveArea(id) {
    activeAreaId = id || "";
    render();
  }

  async function resolveDisplayName(dataPath) {
    try {
      const meta = await apiJson(`/api/data-meta?path=${encodeURIComponent(dataPath)}`);
      const dn = String(meta?.display_name || "").trim();
      return dn;
    } catch {
      return "";
    }
  }

  async function assignToArea(area, dataPath) {
    if (!area || !dataPath) return;
    const displayName = await resolveDisplayName(dataPath);
    const existingIndex = area.items.findIndex(it => it.path === dataPath);
    if (existingIndex >= 0) area.items.splice(existingIndex, 1);
    area.items.unshift({ path: dataPath, display_name: displayName });
    saveState();
    render();
    setStatus(`追加: ${displayName || dataPath}`);
  }

  async function assignToCell(r, c, dataPath) {
    let area = areaAtCell(r, c);
    if (!area) {
      const id = newIdFromCell(r, c);
      // If id exists (rare) generate a unique suffix
      let finalId = id;
      let n = 2;
      while (state.areas.some(a => a.id === finalId)) {
        finalId = `${id}-${n++}`;
      }
      area = { id: finalId, r0: r, c0: c, r1: r + 1, c1: c + 1, items: [] };
      state.areas.push(area);
      activeAreaId = area.id;
    }
    await assignToArea(area, dataPath);
  }

  function exportJson() {
    const payload = {
      type: "gridspec",
      rows: state.rows,
      cols: state.cols,
      areas: state.areas.map(a => ({
        id: a.id,
        r0: a.r0,
        c0: a.c0,
        r1: a.r1,
        c1: a.c1,
        items: a.items || [],
      })),
    };
    return JSON.stringify(payload, null, 2) + "\n";
  }

  async function copyToClipboard(text) {
    await navigator.clipboard.writeText(text);
  }

  function render() {
    rowsInput.value = String(state.rows);
    colsInput.value = String(state.cols);
    setGridVars();
    grid.innerHTML = "";
    overlay.innerHTML = "";

    // background cells
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        const cell = document.createElement("div");
        cell.className = "gs-cell";
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        cell.tabIndex = -1;
        cell.innerHTML = `<div class="gs-cell-coord">${r},${c}</div>`;
        cell.addEventListener("dragover", (e) => {
          const has = e.dataTransfer.types.includes(DND_MIME) || e.dataTransfer.types.includes("text/plain");
          if (!has) return;
          e.preventDefault();
          cell.classList.add("is-drop");
        });
        cell.addEventListener("dragleave", () => cell.classList.remove("is-drop"));
        cell.addEventListener("drop", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          cell.classList.remove("is-drop");
          const dataPath = e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData("text/plain");
          const trimmed = String(dataPath || "").trim();
          if (!trimmed) return;
          // only allow "data/..."
          if (!trimmed.startsWith("data/")) {
            setStatus("data 以外は割り当てできません", true);
            return;
          }
          // Use pointer position (robust across overlays / cross-window DnD)
          await assignToSelectionOrPoint(e.clientX, e.clientY, trimmed);
        });
        grid.appendChild(cell);
      }
    }

    // areas overlays (absolute, like gridspec-builder.html)
    const boardCss = getComputedStyle(board);
    const cellSize = parseFloat(boardCss.getPropertyValue("--gs-cell")) || 56;
    const gap = parseFloat(boardCss.getPropertyValue("--gs-gap")) || 6;
    const boardRect = board.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const ox = gridRect.left - boardRect.left;
    const oy = gridRect.top - boardRect.top;
    function areaPixels(a) {
      const x = a.c0 * (cellSize + gap);
      const y = a.r0 * (cellSize + gap);
      const cs = (a.c1 - a.c0);
      const rs = (a.r1 - a.r0);
      const w = cs * cellSize + Math.max(0, cs - 1) * gap;
      const h = rs * cellSize + Math.max(0, rs - 1) * gap;
      return { x, y, w, h };
    }
    for (const a of state.areas) {
      const el = document.createElement("div");
      el.className = "gs-area" + (a.id === activeAreaId ? " is-active" : "");
      el.dataset.areaId = a.id;
      const px = areaPixels(a);
      el.style.left = `${ox + px.x}px`;
      el.style.top = `${oy + px.y}px`;
      el.style.width = `${px.w}px`;
      el.style.height = `${px.h}px`;

      const title = a.items?.[0]?.display_name || a.items?.[0]?.path || a.id;
      const count = (a.items || []).length;
      el.innerHTML = `
        <div class="gs-area-head">
          <div class="gs-area-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <div class="gs-area-actions">
            <button type="button" class="gs-area-btn" data-action="clear" title="Clear items">×</button>
            <button type="button" class="gs-area-btn" data-action="remove" title="Remove area">Del</button>
          </div>
        </div>
        <div class="gs-area-body">
          ${count ? `<div class="gs-area-sub">${count} item(s)</div>` : `<div class="gs-area-sub muted">drop data here</div>`}
        </div>
      `;
      el.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (btn) {
          const act = btn.dataset.action;
          if (act === "remove") removeArea(a.id);
          if (act === "clear") {
            a.items = [];
            saveState();
            render();
          }
          e.stopPropagation();
          return;
        }
        setActiveArea(a.id);
      });
      el.addEventListener("dragover", (e) => {
        const has = e.dataTransfer.types.includes(DND_MIME) || e.dataTransfer.types.includes("text/plain");
        if (!has) return;
        e.preventDefault();
        el.classList.add("is-drop");
      });
      el.addEventListener("dragleave", () => el.classList.remove("is-drop"));
      el.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove("is-drop");
        const dataPath = e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData("text/plain");
        const trimmed = String(dataPath || "").trim();
        if (!trimmed) return;
        if (!trimmed.startsWith("data/")) {
          setStatus("data 以外は割り当てできません", true);
          return;
        }
        await assignToSelectionOrPoint(e.clientX, e.clientY, trimmed);
      });
      overlay.appendChild(el);
    }

    hint.hidden = state.areas.length > 0;
  }

  function applyGridFromInputs() {
    const nextRows = clampInt(rowsInput.value, 1, 32, state.rows);
    const nextCols = clampInt(colsInput.value, 1, 32, state.cols);
    // Keep only areas inside bounds
    state.rows = nextRows;
    state.cols = nextCols;
    state.areas = state.areas
      .map(a => ({
        ...a,
        r0: Math.min(a.r0, nextRows - 1),
        c0: Math.min(a.c0, nextCols - 1),
        r1: Math.min(Math.max(a.r0 + 1, a.r1), nextRows),
        c1: Math.min(Math.max(a.c0 + 1, a.c1), nextCols),
      }))
      .filter(a => a.r0 < a.r1 && a.c0 < a.c1);
    saveState();
    clearSelection();
    render();
  }

  applyBtn.addEventListener("click", applyGridFromInputs);
  exportBtn.addEventListener("click", async () => {
    try {
      const text = exportJson();
      await copyToClipboard(text);
      setStatus("JSONをコピーしました");
    } catch (e) {
      setStatus(e.message || "コピー失敗", true);
    }
  });
  clearBtn.addEventListener("click", () => {
    state = { rows: clampInt(rowsInput.value, 1, 32, 2), cols: clampInt(colsInput.value, 1, 32, 2), areas: [] };
    activeAreaId = "";
    clearSelection();
    saveState();
    render();
    setStatus("クリアしました");
  });

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      clearSelection();
      setStatus("");
    }
    if (e.key === "Enter") {
      if (selecting) {
        e.preventDefault();
        createAreaFromSelection();
      }
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      if (!activeAreaId) return;
      const area = state.areas.find(a => a.id === activeAreaId);
      if (!area) return;
      e.preventDefault();
      removeArea(activeAreaId);
      setStatus("エリアを削除しました");
    }
  });

  // Allow drop anywhere on wrap/board (robust against gaps/overlay)
  for (const target of [wrap, board, grid, overlay]) {
    target.addEventListener("dragover", (e) => {
      const has = e.dataTransfer.types.includes(DND_MIME) || e.dataTransfer.types.includes("text/plain");
      if (!has) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
  }

  wrap.addEventListener("drop", async (e) => {
    const has = e.dataTransfer.types.includes(DND_MIME) || e.dataTransfer.types.includes("text/plain");
    const dataPath = e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData("text/plain");
    const trimmed = String(dataPath || "").trim();
    if (!trimmed) return;
    e.preventDefault();
    if (!trimmed.startsWith("data/")) {
      setStatus("data 以外は割り当てできません", true);
      return;
    }
    await assignToSelectionOrPoint(e.clientX, e.clientY, trimmed);
  });

  // Stable selection: pointerdown + window pointermove (like gridspec-builder.html)
  board.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // Only start selection when clicking on empty grid (not on an area or its buttons).
    if (e.target.closest(".gs-area")) return;
    const p = cellFromClientPoint(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    _selDragging = true;
    _selStart = p;
    selecting = { r0: p.r, c0: p.c, r1: p.r, c1: p.c };
    setSelectionOverlay(selecting);
  });

  window.addEventListener("pointermove", (e) => {
    if (!_selDragging || !_selStart || !selecting) return;
    const p = cellFromClientPoint(e.clientX, e.clientY);
    if (!p) return;
    selecting = rectFromCells(_selStart, p);
    setSelectionOverlay(selecting);
  });

  window.addEventListener("pointerup", () => {
    _selDragging = false;
    _selStart = null;
  });

  // Keep overlays aligned during scroll/resize (builder does this).
  wrap.addEventListener("scroll", () => render());
  window.addEventListener("resize", () => render());

  render();
})();

