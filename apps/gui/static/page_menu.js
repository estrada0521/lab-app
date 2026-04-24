function initPageMenu() {
  const trigger = document.getElementById("pageMenuBtn");
  const popover = document.getElementById("pageMenuPopover");
  if (!trigger || !popover) return;

  function setOpen(open) {
    const expanded = Boolean(open);
    popover.hidden = !expanded;
    trigger.setAttribute("aria-expanded", expanded ? "true" : "false");
    trigger.classList.toggle("active", expanded);
  }

  trigger.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(popover.hidden);
  });

  document.addEventListener("mousedown", event => {
    if (popover.hidden) return;
    if (popover.contains(event.target) || trigger.contains(event.target)) return;
    setOpen(false);
  });

  window.addEventListener("keydown", event => {
    if (event.key === "Escape") setOpen(false);
  });
}

function escapeInfoHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isInfoPrimitive(value) {
  return value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function renderInfoValueTree(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (isInfoPrimitive(value)) return escapeInfoHtml(value);
  if (Array.isArray(value)) {
    if (!value.length) return "—";
    return renderInfoTreeEntries(value.map((item, index) => [String(index + 1), item]));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "—";
    return renderInfoTreeEntries(entries);
  }
  return escapeInfoHtml(value);
}

function renderInfoTreeEntries(entries) {
  return `<div class="info-tree">` + entries.map(([key, item]) => {
    const structured = item && typeof item === "object";
    if (structured) {
      return `<div class="info-tree-group">`
        + `<div class="info-tree-group-key">${escapeInfoHtml(key)}</div>`
        + `<div class="info-tree-group-body">${renderInfoValueTree(item)}</div>`
        + `</div>`;
    }
    return `<div class="info-tree-key">${escapeInfoHtml(key)}</div><div class="info-tree-value">${renderInfoValueTree(item)}</div>`;
  }).join("") + `</div>`;
}

function renderStructuredInfoGrid(container, rows, options = {}) {
  if (!container) return;
  const keyClass = options.keyClass || "catalog-key";
  const valueClass = options.valueClass || "catalog-value";
  const filteredRows = (rows || []).filter(row => Array.isArray(row) && row.length >= 2);
  container.innerHTML = filteredRows.length
    ? filteredRows.map(([key, value]) => {
      const structured = value && typeof value === "object";
      if (structured) {
        return `<div class="info-group">`
          + `<div class="${keyClass} info-group-key">${escapeInfoHtml(key)}</div>`
          + `<div class="${valueClass} info-group-body">${renderInfoValueTree(value)}</div>`
          + `</div>`;
      }
      return `<div class="${keyClass}">${escapeInfoHtml(key)}</div><div class="${valueClass}">${renderInfoValueTree(value)}</div>`;
    }).join("")
    : `<div class="${keyClass}">—</div><div class="${valueClass}">—</div>`;
}

const INFO_JSON_SKIP = new Set(["memo", "memo_updated_at", "default_x", "default_y", "display_name"]);

function renderInfoAsJson(container, payload, options = {}) {
  if (!container) return;
  const skipKeys = new Set([...(options.skipKeys || []), ...INFO_JSON_SKIP]);
  const data = payload && typeof payload === "object" ? payload : {};
  const rows = Object.entries(data).filter(([key]) => !skipKeys.has(key));
  renderStructuredInfoGrid(container, rows, options);
}

function hideContextMenu() {
  if (window.__pageMenuCtxMenu) {
    window.__pageMenuCtxMenu.remove();
    window.__pageMenuCtxMenu = null;
  }
}

function showContextMenu(x, y, items) {
  hideContextMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  for (const {label, action, danger} of items || []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `ctx-menu-item${danger ? " danger" : ""}`;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      hideContextMenu();
      action?.();
    });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  window.__pageMenuCtxMenu = menu;
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${Math.max(8, x - rect.width)}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${Math.max(8, y - rect.height)}px`;
  setTimeout(() => document.addEventListener("click", hideContextMenu, {once: true}), 0);
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape") hideContextMenu();
});

function bindExplicitRenameInput(input, {onCommit, onCancel}) {
  if (!input) return;
  let composing = false;
  let committed = false;

  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
      return;
    }
    if (event.key !== "Enter") return;
    if (composing || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    committed = true;
    onCommit?.();
  });
  input.addEventListener("blur", () => {
    if (committed) return;
    onCancel?.();
  });
}

async function fetchRepoJson(path) {
  if (!path) throw new Error("path required");
  const response = await fetch(`/api/repo-file?path=${encodeURIComponent(path)}`);
  const text = await response.text();
  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = text ? JSON.parse(text) : {};
      message = payload.error || message;
    } catch {
      message = text || message;
    }
    throw new Error(message);
  }
  return text ? JSON.parse(text) : {};
}

function renderJsonDump(container, payload) {
  if (!container) return;
  const text = JSON.stringify(payload ?? {}, null, 2);
  container.innerHTML = `<pre class="json-view">${escapeInfoHtml(text)}</pre>`;
}

async function renderRepoJsonPanel(container, path) {
  if (!container) return;
  container.innerHTML = `<pre class="json-view muted">Loading…</pre>`;
  try {
    const payload = await fetchRepoJson(path);
    renderJsonDump(container, payload);
  } catch (err) {
    container.innerHTML = `<pre class="json-view muted">${escapeInfoHtml(err.message || "JSON not found")}</pre>`;
  }
}

// ── Auto info grid ─────────────────────────────────────────────────────────
// Fields that are skipped entirely in auto info display
const AUTO_INFO_SKIP = new Set([
  "memo", "memo_updated_at", "kind", "version", "outputs",
  "bindings",  // calculator params - too noisy for general info view
]);

// Render a metadata object as an auto info grid into container.
function renderAutoInfoGrid(container, meta, options = {}) {
  if (!container) return;
  const keyClass = options.keyClass || "catalog-key";
  const valueClass = options.valueClass || "catalog-value";

  if (!meta || !Object.keys(meta).length) {
    container.innerHTML = `<div class="${keyClass}">—</div><div class="${valueClass}">—</div>`;
    return;
  }

  const rows = [];
  for (const [key, value] of Object.entries(meta)) {
    if (AUTO_INFO_SKIP.has(key)) continue;
    rows.push([key, value]);
  }

  const parts = rows.map(([key, value]) => {
    const structured = value && typeof value === "object";
    if (structured) {
      return `<div class="info-group">`
        + `<div class="${keyClass} info-group-key">${escapeInfoHtml(key)}</div>`
        + `<div class="${valueClass} info-group-body">${renderInfoValueTree(value)}</div>`
        + `</div>`;
    }
    return `<div class="${keyClass}">${escapeInfoHtml(key)}</div>`
      + `<div class="${valueClass}">${renderInfoValueTree(value)}</div>`;
  });

  container.innerHTML = parts.join("") || `<div class="${keyClass}">—</div><div class="${valueClass}">—</div>`;
}

function createMemoPanel(options) {
  const input = options.input;
  const saveBtn = options.saveBtn;
  const revertBtn = options.revertBtn;
  const statusEl = options.statusEl;
  const apiJson = options.apiJson;

  let currentTarget = null;
  let original = "";
  let updatedAt = null;
  let saving = false;

  function setStatus(text, kind = "") {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = "memo-status";
    if (kind) statusEl.classList.add(kind);
  }

  function updateButtons() {
    if (!input) return;
    const hasTarget = Boolean(currentTarget?.kind && currentTarget?.id);
    const dirty = hasTarget && input.value !== original;
    input.disabled = !hasTarget;
    if (saveBtn) saveBtn.disabled = !hasTarget || !dirty || saving;
    if (revertBtn) revertBtn.disabled = !hasTarget || !dirty || saving;
    if (!hasTarget) {
      setStatus("");
    } else if (dirty) {
      setStatus("unsaved changes", "dirty");
    } else if (updatedAt) {
      setStatus(`saved · ${updatedAt}`, "saved");
    } else {
      setStatus("no memo yet");
    }
  }

  function reset() {
    currentTarget = null;
    original = "";
    updatedAt = null;
    if (input) input.value = "";
    updateButtons();
  }

  async function load(target) {
    if (!input || !target?.kind || !target?.id) {
      reset();
      return;
    }
    currentTarget = {kind: String(target.kind), id: String(target.id)};
    try {
      const payload = await apiJson(`/api/memo?kind=${encodeURIComponent(currentTarget.kind)}&id=${encodeURIComponent(currentTarget.id)}`);
      original = payload.memo || "";
      updatedAt = payload.updated_at || null;
      input.value = original;
      updateButtons();
    } catch {
      original = "";
      updatedAt = null;
      input.value = "";
      updateButtons();
      setStatus("memo load failed", "error");
    }
  }

  async function save() {
    if (!input || !currentTarget?.kind || !currentTarget?.id || saving) return;
    saving = true;
    updateButtons();
    setStatus("saving…", "info");
    try {
      const payload = await apiJson("/api/memo", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({kind: currentTarget.kind, id: currentTarget.id, memo: input.value}),
      });
      original = payload.memo || "";
      updatedAt = payload.updated_at || null;
      input.value = original;
    } catch (err) {
      setStatus(err.message || "save failed", "error");
    } finally {
      saving = false;
      updateButtons();
    }
  }

  function revert() {
    if (!input) return;
    input.value = original;
    updateButtons();
  }

  if (input) input.addEventListener("input", updateButtons);
  if (input) input.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      save();
    }
  });
  if (saveBtn) saveBtn.addEventListener("click", save);
  if (revertBtn) revertBtn.addEventListener("click", revert);

  updateButtons();

  return {load, save, reset, revert};
}

initPageMenu();
