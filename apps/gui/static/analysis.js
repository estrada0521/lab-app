"use strict";

const analysisList = document.getElementById("analysisList");
const analysisTitle = document.getElementById("analysisTitle");
const analysisMeta = document.getElementById("analysisMeta");
const analysisBody = document.getElementById("analysisBody");
const analysisInfo = document.getElementById("analysisInfo");
const analysisJson = document.getElementById("analysisJson");
const analysisLinks = document.getElementById("analysisLinks");
const analysisSideInfo = document.getElementById("analysisSideInfo");
const analysisSideJson = document.getElementById("analysisSideJson");
const analysisSideLinks = document.getElementById("analysisSideLinks");
const analysisSidePanelSelect = document.getElementById("analysisSidePanelSelect");
const memoInput = document.getElementById("memoInput");
const memoSaveBtn = document.getElementById("memoSaveBtn");
const memoRevertBtn = document.getElementById("memoRevertBtn");
const memoStatusEl = document.getElementById("memoStatus");
const statusEl = document.getElementById("status");

let entries = [];
let currentId = "";
const memoPanel = createMemoPanel({
  input: memoInput,
  saveBtn: memoSaveBtn,
  revertBtn: memoRevertBtn,
  statusEl: memoStatusEl,
  apiJson,
});

function escapeHtml(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg || "";
  statusEl.classList.toggle("error", Boolean(isError));
}

async function apiJson(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  const payload = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(payload.error || r.statusText);
  return payload;
}

async function deleteAnalysis(id) {
  return apiJson("/api/delete-entity", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({kind: "analysis", id}),
  });
}

function renderList(items) {
  analysisList.innerHTML = "";
  for (const entry of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "catalog-list-item";
    btn.dataset.id = entry.id;
    btn.innerHTML = `
      <div class="catalog-list-name" title="Click again to rename">${escapeHtml(entry.display_name || entry.id)}</div>
      <div class="catalog-list-meta">${escapeHtml(entry.id)}</div>
    `;
    btn.addEventListener("click", (e) => {
      if (btn.classList.contains("current")) {
        const nameEl = btn.querySelector(".catalog-list-name");
        if (nameEl && !nameEl.querySelector("input")) {
          e.stopPropagation();
          startRename(btn, entry.id, nameEl);
          return;
        }
      }
      selectProject(entry.id).catch(err => setStatus(err.message, true));
    });
    btn.addEventListener("contextmenu", event => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, [{
        label: "Delete",
        danger: true,
        action: async () => {
          if (!confirm(`Delete analysis "${entry.id}"?\nThis cannot be undone.`)) return;
          try {
            await deleteAnalysis(entry.id);
            if (currentId === entry.id) currentId = "";
            await loadAnalyses();
          } catch (err) {
            setStatus(err.message || "Delete failed", true);
          }
        },
      }]);
    });
    analysisList.appendChild(btn);
  }
}

function startRename(btn, oldId, nameEl) {
  const entry = entries.find(item => item.id === oldId) || {id: oldId, display_name: oldId};
  const oldName = entry.display_name || oldId;
  const input = document.createElement("input");
  input.type = "text";
  input.value = oldName;
  input.className = "rename-input";
  input.addEventListener("click", e => e.stopPropagation());
  nameEl.textContent = "";
  nameEl.appendChild(input);
  input.focus();
  input.select();

  async function commit() {
    const newName = input.value.trim();
    if (!newName || newName === oldName) { renderList(entries); restoreCurrent(); return; }
    try {
      await apiJson("/api/rename", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({kind: "analysis", old_id: oldId, new_name: newName}),
      });
      const idx = entries.findIndex(e => e.id === oldId);
      if (idx >= 0) entries[idx] = {...entries[idx], display_name: newName};
      currentId = oldId;
      renderList(entries);
      restoreCurrent();
      await selectProject(oldId);
    } catch (err) {
      setStatus(err.message, true);
      renderList(entries);
      restoreCurrent();
    }
  }

  bindExplicitRenameInput(input, {
    onCommit: commit,
    onCancel: () => {
      renderList(entries);
      restoreCurrent();
    },
  });
}

function restoreCurrent() {
  for (const btn of analysisList.querySelectorAll(".catalog-list-item")) {
    btn.classList.toggle("current", btn.dataset.id === currentId);
  }
}

function setSidePanel(panelName) {
  if (analysisSideInfo) analysisSideInfo.hidden = panelName !== "info";
  if (analysisSideJson) analysisSideJson.hidden = panelName !== "json";
  if (analysisSideLinks) analysisSideLinks.hidden = panelName !== "links";
  if (analysisSidePanelSelect) analysisSidePanelSelect.value = panelName;
}

async function selectProject(id) {
  currentId = id;
  restoreCurrent();
  setStatus("Loading…");
  const detail = await apiJson(`/api/analysis?id=${encodeURIComponent(id)}`);
  renderDetail(detail);
  setStatus("");
}

function wsLinkItem(href, text, sub = "") {
  return `<a class="catalog-record-link" href="${escapeHtml(href)}">` +
    `<span class="catalog-record-link-label">${escapeHtml(text)}</span>` +
    (sub ? `<span class="catalog-record-link-sub">${escapeHtml(sub)}</span>` : "") +
    `</a>`;
}

function wsRecordLink(href, displayName, id, fallback = "") {
  return wsLinkItem(href, displayName || id || fallback, id || fallback);
}

function wsLinkBlock(label, items) {
  if (!items.length) return "";
  return `<section class="link-section">` +
    `<div class="catalog-link-label">${escapeHtml(label)}</div>` +
    `<div class="link-section-list">${items.join("")}</div>` +
    `</section>`;
}

function renderDetail(detail) {
  analysisTitle.textContent = detail.display_name || detail.id;
  analysisMeta.textContent = "";

  renderInfoAsJson(analysisInfo, detail.metadata || {}, {keyClass: "catalog-key", valueClass: "catalog-value"});
  renderRepoJsonPanel(analysisJson, detail.metadata_path);

  // Center body: description + images only
  let html = "";
  if (detail.description) {
    html += `<div class="analysis-description">${escapeHtml(detail.description)}</div>`;
  }
  if (detail.images && detail.images.length) {
    html += `<div class="analysis-section-label">Outputs</div><div class="analysis-images">`;
    for (const imgPath of detail.images) {
      html += `<figure class="analysis-figure">
        <a href="/api/repo-file?path=${encodeURIComponent(imgPath)}" target="_blank">
          <img src="/api/repo-file?path=${encodeURIComponent(imgPath)}" alt="${escapeHtml(imgPath.split("/").pop())}" loading="lazy">
        </a>
        <figcaption>${escapeHtml(imgPath.split("/").pop())}</figcaption>
      </figure>`;
    }
    html += `</div>`;
  }
  analysisBody.innerHTML = html;

  // Links panel: DATA block + unique RAWDATA block
  const rawdataSet = new Set();
  let missingCount = 0;
  const dataLinks = (detail.source_data || []).map(src => {
    if (src.raw_source) rawdataSet.add(src.raw_source);
    const id = src.data_id || src.ref || src.path;
    const label = src.display_name || id;
    if (src.exists) return wsRecordLink(`/?path=${encodeURIComponent(src.path)}`, label, id, src.path);
    missingCount += 1;
    return `<span class="catalog-record-link missing">`
      + `<span class="catalog-record-link-label">${escapeHtml(label)}</span>`
      + `<span class="catalog-record-link-sub">${escapeHtml(id)}</span>`
      + `</span>`;
  });
  const rawLinks = [...rawdataSet].map(raw => {
    const id = raw.split("/")[1] || raw;
    const found = (detail.source_data || []).find(src => src.raw_source === raw);
    return wsRecordLink(`/?path=${encodeURIComponent(raw)}`, found?.raw_display_name || "", id, raw);
  });
  const warningHtml = missingCount
    ? `<div class="analysis-links-warning">${escapeHtml(`${missingCount} data source${missingCount === 1 ? "" : "s"} could not be found. This analysis may be stale.`)}</div>`
    : "";
  const linksHtml = warningHtml + wsLinkBlock("DATA", dataLinks) + wsLinkBlock("RAWDATA", rawLinks);
  analysisLinks.innerHTML = linksHtml || '<div class="data-info-val muted">—</div>';
  memoPanel.load({kind: "analysis", id: detail.id}).catch(err => setStatus(err.message, true));
}

async function loadAnalyses() {
  setStatus("Loading…");
  const payload = await apiJson("/api/analyses");
  entries = payload.entries || [];
  renderList(entries);
  const paramId = new URLSearchParams(location.search).get("id");
  const initialId = paramId && entries.some(e => e.id === paramId) ? paramId : (entries[0]?.id || null);
  if (initialId) await selectProject(initialId);
  setStatus("");
}

initPaneResize({
  root: document.querySelector(".catalog-main"),
  container: document.querySelector(".catalog-main"),
  leftSplitterId: "catalogLeftSplitter",
  rightSplitterId: "catalogRightSplitter",
  storagePrefix: "datparser-analysis",
  left: {min: 220, max: 520, reserve: 460},
  right: {min: 260, max: 560, reserve: 440},
});

analysisSidePanelSelect?.addEventListener("change", () => setSidePanel(analysisSidePanelSelect.value));
setSidePanel("info");
loadAnalyses().catch(err => setStatus(err.message, true));
