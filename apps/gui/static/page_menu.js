function initPageMenu() {
  const trigger = document.getElementById("pageMenuBtn");
  const popover = document.getElementById("pageMenuPopover");
  if (!trigger || !popover) return;

  function position() {
    const r = trigger.getBoundingClientRect();
    popover.style.top = `${r.bottom + 6}px`;
    popover.style.left = `${r.left}px`;
    // keep within viewport
    const pw = popover.offsetWidth || 180;
    if (r.left + pw > window.innerWidth - 8) {
      popover.style.left = `${Math.max(8, window.innerWidth - pw - 8)}px`;
    }
  }

  function setOpen(open) {
    const expanded = Boolean(open);
    popover.hidden = !expanded;
    trigger.setAttribute("aria-expanded", expanded ? "true" : "false");
    trigger.classList.toggle("active", expanded);
    if (expanded) position();
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

function isInfoSpecialValue(value) {
  return Boolean(value && typeof value === "object" && typeof value.__infoType === "string");
}

function infoLinkValue(href, label, options = {}) {
  if (!href || !label) return label || "—";
  return {
    __infoType: "link",
    href,
    label,
    missing: Boolean(options.missing),
  };
}

function infoActionValue(label, action, options = {}) {
  if (!label || !action) return label || "—";
  return {
    __infoType: "action",
    label,
    action,
    tone: options.tone || "",
    path: options.path || "",
  };
}

function infoCalcValue(calc) {
  if (!calc || typeof calc !== "object") return "—";
  return {
    __infoType: "calc",
    calcId: calc.id || "",
    params: calc.params || {},
    overrides: calc.overrides || {},
  };
}

function renderInfoSpecialValue(value) {
  if (!isInfoSpecialValue(value)) return renderInfoValueTree(value);
  if (value.__infoType === "link") {
    const href = String(value.href || "").trim();
    const label = String(value.label || "").trim();
    const missingClass = value.missing ? " missing" : "";
    if (!href || !label) return "—";
    return `<a class="catalog-record-link info-link-value${missingClass}" href="${escapeInfoHtml(href)}">`
      + `<span class="catalog-record-link-label">${escapeInfoHtml(label)}</span>`
      + `</a>`;
  }
  if (value.__infoType === "action") {
    const label = String(value.label || "").trim();
    const action = String(value.action || "").trim();
    const tone = String(value.tone || "").trim();
    const path = String(value.path || "").trim();
    if (!label || !action) return "—";
    return `<span class="info-action-wrap">`
      + `<button class="info-action-link${tone ? ` tone-${escapeInfoHtml(tone)}` : ""}" type="button" data-info-action="${escapeInfoHtml(action)}"${path ? ` data-info-path="${escapeInfoHtml(path)}"` : ""}>${escapeInfoHtml(label)}</button>`
      + `</span>`;
  }
  if (value.__infoType === "calc") {
    const calcId = String(value.calcId || "").trim();
    const params = value.params && typeof value.params === "object" ? Object.entries(value.params) : [];
    const overrides = value.overrides && typeof value.overrides === "object" ? Object.entries(value.overrides) : [];
    const labelFor = typeof humanizeInfoLabel === "function"
      ? humanizeInfoLabel
      : key => String(key || "");
    return `<details class="info-calc-disclosure">`
      + `<summary class="info-calc-summary"><span class="info-calc-summary-text">parameter</span><span class="info-calc-summary-label">></span></summary>`
      + `<div class="info-calc-body">`
      + (calcId ? `<div class="info-calc-id">${escapeInfoHtml(calcId)}</div>` : "")
      + params.map(([key, item]) => `<div class="info-calc-key">${escapeInfoHtml(key)}</div><div class="info-calc-value">${renderInfoValueTree(item)}</div>`).join("")
      + (overrides.length
        ? `<div class="info-calc-section">Override</div>`
          + overrides.map(([key, item]) => `<div class="info-calc-key">${escapeInfoHtml(labelFor(key))}</div><div class="info-calc-value">${renderInfoValueTree(item)}</div>`).join("")
        : "")
      + `</div>`
      + `</details>`;
  }
  return escapeInfoHtml(JSON.stringify(value));
}

function renderInfoValueTree(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (isInfoPrimitive(value)) return escapeInfoHtml(value);
  if (isInfoSpecialValue(value)) return renderInfoSpecialValue(value);
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
      if (isInfoSpecialValue(value) && value.__infoType === "calc") {
        return `<div class="info-group info-calc-group">`
          + `<div class="${valueClass} info-group-body info-calc-group-body">${renderInfoValueTree(value)}</div>`
          + `</div>`;
      }
      const structured = value && typeof value === "object" && !isInfoSpecialValue(value);
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

document.addEventListener("click", async event => {
  const actionEl = event.target instanceof Element ? event.target.closest("[data-info-action]") : null;
  if (!actionEl) return;
  const action = actionEl.getAttribute("data-info-action") || "";
  if (!action) return;
  if (action === "open-finder") {
    const path = actionEl.getAttribute("data-info-path") || "";
    if (!path) return;
    event.preventDefault();
    try {
      const response = await fetch("/api/open-external", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({path, app: "Finder"}),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || response.statusText);
      }
    } catch (err) {
      console.error(err);
    }
  }
});

const INFO_JSON_SKIP = new Set(["memo", "memo_updated_at", "default_x", "default_y", "display_name"]);

function shouldRenderInfoKey(key, extraSkipKeys = []) {
  return !new Set([...INFO_JSON_SKIP, ...extraSkipKeys]).has(key);
}

function renderInfoAsJson(container, payload, options = {}) {
  if (!container) return;
  const data = payload && typeof payload === "object" ? payload : {};
  const rows = Object.entries(data).filter(([key]) => shouldRenderInfoKey(key, options.skipKeys || []));
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

function renderJsonDump(container, payload, options = {}) {
  if (!container) return;
  const text = JSON.stringify(payload ?? {}, null, 2);
  const path = String(options.path || "").trim();
  container.innerHTML = `<div class="json-panel-head">`
    + `<div class="json-panel-actions">`
    + (path ? `<button class="info-action-link tone-finder" type="button" data-info-action="open-finder" data-info-path="${escapeInfoHtml(path)}">Open in Finder</button>` : "")
    + `</div>`
    + `</div>`
    + `<pre class="json-view">${escapeInfoHtml(text)}</pre>`;
}

async function renderRepoJsonPanel(container, path) {
  if (!container) return;
  container.innerHTML = `<pre class="json-view muted">Loading…</pre>`;
  try {
    const payload = await fetchRepoJson(path);
    renderJsonDump(container, payload, {path});
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
  const apiJson = options.apiJson;

  let currentTarget = null;
  let original = "";
  let saving = false;

  function updateButtons() {
    if (!input) return;
    const hasTarget = Boolean(currentTarget?.kind && currentTarget?.id);
    const dirty = hasTarget && input.value !== original;
    input.disabled = !hasTarget;
    if (saveBtn) saveBtn.disabled = !hasTarget || !dirty || saving;
  }

  function reset() {
    currentTarget = null;
    original = "";
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
      input.value = original;
      updateButtons();
    } catch {
      original = "";
      input.value = "";
      updateButtons();
    }
  }

  async function save() {
    if (!input || !currentTarget?.kind || !currentTarget?.id || saving) return;
    saving = true;
    updateButtons();
    try {
      const payload = await apiJson("/api/memo", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({kind: currentTarget.kind, id: currentTarget.id, memo: input.value}),
      });
      original = payload.memo || "";
      input.value = original;
    } catch {
      // silent
    } finally {
      saving = false;
      updateButtons();
    }
  }

  if (input) input.addEventListener("input", updateButtons);
  if (input) input.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      save();
    }
  });
  if (saveBtn) saveBtn.addEventListener("click", save);

  updateButtons();

  return {load, save, reset};
}

initPageMenu();
