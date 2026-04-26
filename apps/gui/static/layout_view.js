(() => {
  const STORAGE_KEY = "lab-gridspec-layout-v1";

  const gridEl = document.getElementById("lvGrid");
  const statusEl = document.getElementById("lvStatus");
  const reloadBtn = document.getElementById("lvReloadBtn");

  function setStatus(message, isError = false) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", isError);
  }

  function clampInt(value, min, max, fallback) {
    const num = Number.parseInt(String(value || ""), 10);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, num));
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function render() {
    const state = loadState();
    gridEl.innerHTML = "";

    gridEl.style.gridTemplateColumns = `repeat(${state.cols}, minmax(200px, 1fr))`;
    gridEl.style.gridTemplateRows = `repeat(${state.rows}, minmax(200px, auto))`;

    if (!state.areas.length) {
      gridEl.innerHTML = `<div class="layout-view-empty">まだエリアがありません。<a href="/layout/">Layout</a> で作成してください。</div>`;
      setStatus("エリア未作成");
      return;
    }

    for (const a of state.areas) {
      const el = document.createElement("div");
      el.className = "layout-view-area";
      el.style.gridColumn = `${a.c0 + 1} / ${a.c1 + 1}`;
      el.style.gridRow = `${a.r0 + 1} / ${a.r1 + 1}`;

      const primary = a.items?.[0] || null;
      const title = primary?.display_name || primary?.path || a.id;
      const count = (a.items || []).length;

      el.innerHTML = `
        <div class="layout-view-area-head">
          <div class="layout-view-area-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <div class="layout-view-area-sub">${count ? `${count} item(s)` : "empty"}</div>
        </div>
        <div class="layout-view-area-body">
          ${
            primary?.path
              ? `<iframe class="layout-view-embed" loading="lazy" src="/?path=${encodeURIComponent(primary.path)}&embed=1"></iframe>`
              : `<div class="layout-view-empty">このエリアには data が割り当てられていません</div>`
          }
        </div>
      `;
      gridEl.appendChild(el);
    }

    setStatus(`rows=${state.rows}, cols=${state.cols}, areas=${state.areas.length}`);
  }

  if (reloadBtn) reloadBtn.addEventListener("click", () => render());

  render();
})();

