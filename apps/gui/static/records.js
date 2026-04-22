const pageKind = document.body.dataset.page;
const recordList = document.getElementById("recordList");
const recordTitle = document.getElementById("recordTitle");
const recordMeta = document.getElementById("recordMeta");
const recordInfo = document.getElementById("recordInfo");
const recordRawdata = document.getElementById("recordRawdata");
const recordData = document.getElementById("recordData");
const recordExperiments = document.getElementById("recordExperiments");
const recordImageWrap = document.getElementById("recordImageWrap");
const recordMainImage = document.getElementById("recordMainImage");
const recordReadme = document.getElementById("recordReadme");
const ownerFilterSelect = document.getElementById("ownerFilterSelect");
const materialFilterSelect = document.getElementById("materialFilterSelect");
const orientationFilterSelect = document.getElementById("orientationFilterSelect");
const statusEl = document.getElementById("status");
const sideInfoPanel = document.getElementById("sideInfoPanel");
const sideJsonPanel = document.getElementById("sideJsonPanel");
const sideLinksPanel = document.getElementById("sideLinksPanel");
const sidePanelSelect = document.getElementById("recordSidePanelSelect");
const recordJson = document.getElementById("recordJson");
const memoInput = document.getElementById("memoInput");
const memoSaveBtn = document.getElementById("memoSaveBtn");
const memoRevertBtn = document.getElementById("memoRevertBtn");
const memoStatusEl = document.getElementById("memoStatus");

let entries = [];
let currentId = "";
let memoOriginal = "";
let memoSaving = false;
let memoUpdatedAt = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message, isError = false) {
  statusEl.textContent = message || "";
  statusEl.classList.toggle("error", Boolean(isError));
}

async function apiJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

async function deleteEntity(kind, id) {
  return apiJson("/api/delete-entity", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({kind, id}),
  });
}

function detailUrl(id) {
  return pageKind === "samples"
    ? `/api/sample?id=${encodeURIComponent(id)}`
    : `/api/experiment?id=${encodeURIComponent(id)}`;
}

function listUrl() {
  return pageKind === "samples" ? "/api/samples" : "/api/experiments";
}

function listMeta(entry) {
  return [entry.material, entry.type, entry.time].filter(Boolean).join(" · ");
}

function populateFilter(selectEl, values) {
  const current = selectEl.value;
  selectEl.innerHTML = '<option value="">All</option>';
  for (const v of [...new Set(values)].filter(Boolean).sort()) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  }
  if (current) selectEl.value = current;
}

function filteredEntries() {
  const ownerVal = ownerFilterSelect?.value || "";
  const materialVal = materialFilterSelect?.value || "";
  const orientationVal = orientationFilterSelect?.value || "";
  return entries.filter(e => {
    if (ownerVal && (e.owner || "") !== ownerVal) return false;
    if (materialVal && (e.material || "") !== materialVal) return false;
    if (orientationVal && (e.orientation || "") !== orientationVal) return false;
    return true;
  });
}

function renderLinkList(container, items) {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = '<div class="catalog-path muted">—</div>';
    return;
  }
  container.innerHTML = items.map(({ href, label, sub }) =>
    `<a class="catalog-record-link" href="${escapeHtml(href)}">`
    + `<span class="catalog-record-link-label">${escapeHtml(label)}</span>`
    + (sub ? `<span class="catalog-record-link-sub">${escapeHtml(sub)}</span>` : "")
    + `</a>`
  ).join("");
}

function renderLinkBlock(blockId, container, items, options = {}) {
  const block = document.getElementById(blockId);
  if (!block || !container) return;
  const label = options.label || block.querySelector(".catalog-link-label")?.textContent || "Links";
  block.innerHTML = `
    <div class="catalog-link-label">${escapeHtml(label)}</div>
    <div class="catalog-link-list"></div>
  `;
  const list = block.querySelector(".catalog-link-list");
  renderLinkList(list, items);
}

function renderInfoGrid(container, rows) {
  renderStructuredInfoGrid(container, rows, {
    keyClass: "catalog-key",
    valueClass: "catalog-value",
  });
}

// ── Memo ──────────────────────────────────────────────────────────────────
function memoKind() {
  return pageKind === "samples" ? "sample" : "experiment";
}

function updateMemoButtons() {
  if (!memoInput) return;
  const hasId = Boolean(currentId);
  const dirty = hasId && memoInput.value !== memoOriginal;
  memoInput.disabled = !hasId;
  if (memoSaveBtn) memoSaveBtn.disabled = !hasId || !dirty || memoSaving;
  if (memoRevertBtn) memoRevertBtn.disabled = !hasId || !dirty || memoSaving;
  if (!memoStatusEl) return;
  memoStatusEl.className = "memo-status";
  if (!hasId) {
    memoStatusEl.textContent = "";
  } else if (dirty) {
    memoStatusEl.textContent = "unsaved changes";
    memoStatusEl.classList.add("dirty");
  } else if (memoUpdatedAt) {
    memoStatusEl.textContent = `saved · ${memoUpdatedAt}`;
    memoStatusEl.classList.add("saved");
  } else {
    memoStatusEl.textContent = "no memo yet";
  }
}

async function loadMemo(id) {
  if (!memoInput || !id) { memoOriginal = ""; memoUpdatedAt = null; if (memoInput) { memoInput.value = ""; } updateMemoButtons(); return; }
  try {
    const payload = await apiJson(`/api/record-memo?kind=${memoKind()}&id=${encodeURIComponent(id)}`);
    memoOriginal = payload.memo || "";
    memoUpdatedAt = payload.updated_at || null;
    memoInput.value = memoOriginal;
    updateMemoButtons();
  } catch {
    memoOriginal = ""; memoUpdatedAt = null; memoInput.value = ""; updateMemoButtons();
  }
}

async function saveMemo() {
  if (!memoInput || !currentId || memoSaving) return;
  memoSaving = true;
  updateMemoButtons();
  if (memoStatusEl) { memoStatusEl.textContent = "saving…"; memoStatusEl.className = "memo-status info"; }
  try {
    const payload = await apiJson("/api/record-memo", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({kind: memoKind(), id: currentId, memo: memoInput.value}),
    });
    memoOriginal = payload.memo || "";
    memoUpdatedAt = payload.updated_at || null;
    memoInput.value = memoOriginal;
  } catch (err) {
    if (memoStatusEl) { memoStatusEl.textContent = err.message || "save failed"; memoStatusEl.className = "memo-status error"; }
  } finally {
    memoSaving = false;
    updateMemoButtons();
  }
}

if (memoInput) {
  memoInput.addEventListener("input", updateMemoButtons);
  memoInput.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveMemo(); }
  });
}
if (memoSaveBtn) memoSaveBtn.addEventListener("click", saveMemo);
if (memoRevertBtn) memoRevertBtn.addEventListener("click", () => {
  if (memoInput) { memoInput.value = memoOriginal; updateMemoButtons(); }
});

// ── Markdown rendering ─────────────────────────────────────────────────────
// renderMarkdown and renderMathInScope are provided by markdown_render.js

async function loadExpDoc(id) {
  if (!recordReadme) return;
  if (pageKind !== "experiments") { recordReadme.hidden = true; return; }
  try {
    const payload = await apiJson(`/api/experiment-doc?id=${encodeURIComponent(id)}`);
    if (payload.content) {
      recordReadme.innerHTML = renderMarkdown(payload.content);
      renderMathInScope(recordReadme);
      recordReadme.hidden = false;
    } else {
      recordReadme.innerHTML = "";
      recordReadme.hidden = true;
    }
  } catch {
    recordReadme.innerHTML = "";
    recordReadme.hidden = true;
  }
}

// ── Record selection ───────────────────────────────────────────────────────
async function selectRecord(id) {
  currentId = id;
  for (const button of recordList.querySelectorAll(".catalog-list-item")) {
    button.classList.toggle("current", button.dataset.id === id);
  }
  const payload = await apiJson(detailUrl(id));
  const entry = entries.find(item => item.id === id) || {};
  const meta = payload.metadata || {};

  recordTitle.textContent = payload.display_name || payload.id || id;

  if (recordMeta) {
    const parts = [
      meta.material_id || entry.material,
      meta.orientation || null,
      meta.mass_mg != null ? `${meta.mass_mg} mg` : null,
      meta.owner || entry.owner,
    ].filter(v => v != null && v !== "");
    recordMeta.textContent = parts.join(" · ");
  }

  renderAutoInfoGrid(recordInfo, meta, {keyClass: "catalog-key", valueClass: "catalog-value"});
  await renderRepoJsonPanel(recordJson, payload.metadata_path);
  await loadMemo(id);

  renderLinkBlock("rawdataLinkBlock", recordRawdata, (payload.rawdata || []).map(item => ({
    href: `/?path=${encodeURIComponent(item.path)}`,
    label: item.display_name || item.file || item.path.split("/").pop(),
    sub: item.id || item.path,
  })), {label: "RAWDATA"});
  renderLinkBlock("dataLinkBlock", recordData, (payload.data || []).map(item => ({
    href: `/?path=${encodeURIComponent(item.path)}`,
    label: item.display_name || item.file || item.path.split("/").pop(),
    sub: item.id || item.path,
  })), {label: "DATA"});
  if (pageKind === "samples") {
    const expItems = (payload.experiments || []).map(exp => ({
      href: `/experiments/?id=${encodeURIComponent(exp.id)}`,
      label: exp.display_name || exp.id,
      sub: exp.id,
    }));
    renderLinkBlock("experimentLinkBlock", recordExperiments, expItems, {label: "EXPERIMENT"});
  }

  if (recordImageWrap && recordMainImage) {
    const imgPath = payload.main_image;
    if (imgPath) {
      recordMainImage.src = `/api/repo-file?path=${encodeURIComponent(imgPath)}`;
      recordMainImage.alt = payload.id || id;
      recordImageWrap.hidden = false;
    } else {
      recordImageWrap.hidden = true;
      recordMainImage.src = "";
    }
  }

  await loadExpDoc(id);
}

function renderList(items) {
  recordList.innerHTML = "";
  for (const entry of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "catalog-list-item";
    button.dataset.id = entry.id;
    button.innerHTML = `
      <div class="catalog-list-name" title="Click again to rename">${escapeHtml(entry.display_name || entry.id)}</div>
      <div class="catalog-list-meta">${escapeHtml(entry.id)}</div>
    `;
    button.addEventListener("click", (e) => {
      if (button.classList.contains("current")) {
        const nameEl = button.querySelector(".catalog-list-name");
        if (nameEl && !nameEl.querySelector("input")) {
          e.stopPropagation();
          startRecordRename(button, entry, nameEl);
          return;
        }
      }
      selectRecord(entry.id).catch(err => setStatus(err.message, true));
    });
    button.addEventListener("contextmenu", event => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, [{
        label: "Delete",
        danger: true,
        action: async () => {
          const kind = pageKind === "samples" ? "sample" : "exp";
          if (!confirm(`Delete ${kind} "${entry.id}"?\nThis cannot be undone.`)) return;
          try {
            await deleteEntity(kind, entry.id);
            if (currentId === entry.id) currentId = "";
            await loadRecords();
          } catch (err) {
            setStatus(err.message || "Delete failed", true);
          }
        },
      }]);
    });
    recordList.appendChild(button);
  }
}

function startRecordRename(button, entry, nameEl) {
  const kind = pageKind === "samples" ? "sample" : "exp";
  const oldId = entry.id;
  const input = document.createElement("input");
  input.type = "text";
  input.value = entry.display_name || oldId;
  input.className = "rename-input";
  input.addEventListener("click", e => e.stopPropagation());
  nameEl.textContent = "";
  nameEl.appendChild(input);
  input.focus();
  input.select();

  async function commit() {
    const newName = input.value.trim();
    if (!newName || newName === (entry.display_name || oldId)) { applyFilters(); return; }
    try {
      await apiJson("/api/rename", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({kind, old_id: oldId, new_name: newName}),
      });
      await loadRecords();
      currentId = oldId;
      await selectRecord(oldId);
    } catch (err) {
      setStatus(err.message, true);
      applyFilters();
    }
  }

  bindExplicitRenameInput(input, {
    onCommit: commit,
    onCancel: () => applyFilters(),
  });
}

function applyFilters() {
  const visible = filteredEntries();
  renderList(visible);
  if (currentId && visible.some(e => e.id === currentId)) {
    for (const button of recordList.querySelectorAll(".catalog-list-item")) {
      button.classList.toggle("current", button.dataset.id === currentId);
    }
  } else if (visible[0]) {
    selectRecord(visible[0].id).catch(err => setStatus(err.message, true));
  }
}

function setSidePanel(panelName) {
  if (sideInfoPanel) sideInfoPanel.hidden = panelName !== "info";
  if (sideJsonPanel) sideJsonPanel.hidden = panelName !== "json";
  if (sideLinksPanel) sideLinksPanel.hidden = panelName !== "links";
  if (sidePanelSelect) sidePanelSelect.value = panelName;
}

sidePanelSelect?.addEventListener("change", () => setSidePanel(sidePanelSelect.value));

async function loadRecords() {
  setStatus("Loading…");
  const payload = await apiJson(listUrl());
  entries = payload.entries || [];

  if (pageKind === "samples") {
    populateFilter(ownerFilterSelect, entries.map(e => e.owner || ""));
    populateFilter(materialFilterSelect, entries.map(e => e.material || ""));
    populateFilter(orientationFilterSelect, entries.map(e => e.orientation || ""));
    ownerFilterSelect?.addEventListener("change", applyFilters);
    materialFilterSelect?.addEventListener("change", applyFilters);
    orientationFilterSelect?.addEventListener("change", applyFilters);
  } else {
    document.getElementById("recordFilterGrid")?.remove();
    document.getElementById("experimentLinkBlock")?.remove();
  }

  if (pageKind === "samples") document.querySelector(".records-link-samples")?.classList.add("current");
  if (pageKind === "experiments") document.querySelector(".records-link-experiments")?.classList.add("current");

  renderList(entries);

  const paramId = new URLSearchParams(location.search).get("id");
  const initialId = paramId && entries.some(e => e.id === paramId) ? paramId : (entries[0]?.id || null);
  if (initialId) await selectRecord(initialId);
  setStatus("");
}

setSidePanel("info");
updateMemoButtons();
initPaneResize({
  root: document.querySelector(".catalog-main"),
  container: document.querySelector(".catalog-main"),
  leftSplitterId: "catalogLeftSplitter",
  rightSplitterId: "catalogRightSplitter",
  storagePrefix: `datparser-${pageKind}`,
  left: {min: 220, max: 520, reserve: 460},
  right: {min: 260, max: 560, reserve: 440},
});
loadRecords().catch(err => setStatus(err.message, true));
