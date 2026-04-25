"use strict";

const buildList = document.getElementById("buildList");
const buildTitle = document.getElementById("buildTitle");
const buildMeta = document.getElementById("buildMeta");
const buildBody = document.getElementById("buildBody");
const buildInfo = document.getElementById("buildInfo");
const buildJson = document.getElementById("buildJson");
const buildLinks = document.getElementById("buildLinks");
const buildSideInfo = document.getElementById("buildSideInfo");
const buildSideJson = document.getElementById("buildSideJson");
const buildSideLinks = document.getElementById("buildSideLinks");
const buildSidePanelSelect = document.getElementById("buildSidePanelSelect");
const memoInput = document.getElementById("memoInput");
const memoSaveBtn = document.getElementById("memoSaveBtn");
const statusEl = document.getElementById("status");

let entries = [];
let currentId = "";
let dbRoot = "";
const memoPanel = createMemoPanel({
  input: memoInput,
  saveBtn: memoSaveBtn,
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

async function deleteBuild(id) {
  return apiJson("/api/delete-entity", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({kind: "build", id}),
  });
}

function renderList(items) {
  buildList.innerHTML = "";
  for (const entry of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "catalog-list-item";
    btn.dataset.id = entry.id;
    btn.innerHTML = `
      <div class="catalog-list-name" title="Click again to rename">${escapeHtml(entry.display_name || entry.id)}</div>
      <span class="copy-path-btn" role="button" title="Copy absolute path" tabindex="-1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </span>
    `;
    btn.querySelector(".copy-path-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const absPath = dbRoot ? dbRoot.replace(/\/$/, "") + "/build/" + entry.id : "build/" + entry.id;
      navigator.clipboard.writeText(absPath).then(() => {
        const cb = btn.querySelector(".copy-path-btn");
        cb.classList.add("success");
        setTimeout(() => cb.classList.remove("success"), 1200);
      });
    });
    btn.addEventListener("click", (e) => {
      if (btn.classList.contains("current")) {
        const nameEl = btn.querySelector(".catalog-list-name");
        if (nameEl && !nameEl.querySelector("input")) {
          e.stopPropagation();
          startRename(btn, entry.id, nameEl);
          return;
        }
      }
      selectBuild(entry.id).catch(err => setStatus(err.message, true));
    });
    btn.addEventListener("contextmenu", event => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, [{
        label: "Delete",
        danger: true,
        action: async () => {
          if (!confirm(`Delete build "${entry.id}"?\nThis cannot be undone.`)) return;
          try {
            await deleteBuild(entry.id);
            if (currentId === entry.id) currentId = "";
            await loadBuilds();
          } catch (err) {
            setStatus(err.message || "Delete failed", true);
          }
        },
      }]);
    });
    buildList.appendChild(btn);
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
        body: JSON.stringify({kind: "build", old_id: oldId, new_name: newName}),
      });
      const idx = entries.findIndex(e => e.id === oldId);
      if (idx >= 0) entries[idx] = {...entries[idx], display_name: newName};
      currentId = oldId;
      renderList(entries);
      restoreCurrent();
      await selectBuild(oldId);
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
  for (const btn of buildList.querySelectorAll(".catalog-list-item")) {
    btn.classList.toggle("current", btn.dataset.id === currentId);
  }
}

function setSidePanel(panelName) {
  if (buildSideInfo) buildSideInfo.hidden = panelName !== "info";
  if (buildSideJson) buildSideJson.hidden = panelName !== "json";
  if (buildSideLinks) buildSideLinks.hidden = panelName !== "links";
  if (buildSidePanelSelect) buildSidePanelSelect.value = panelName;
}

async function selectBuild(id) {
  currentId = id;
  restoreCurrent();
  setStatus("Loading…");
  const detail = await apiJson(`/api/build?id=${encodeURIComponent(id)}`);
  renderDetail(detail);
  loadAndRenderAttachments(document.getElementById("attachmentsSection"), "build", id);
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
  buildTitle.textContent = detail.display_name || detail.id;
  buildMeta.textContent = "";

  renderInfoAsJson(buildInfo, detail.metadata || {}, {keyClass: "catalog-key", valueClass: "catalog-value"});
  renderRepoJsonPanel(buildJson, detail.metadata_path);

  let html = "";
  if (detail.description) {
    html += `<div class="analysis-description">${escapeHtml(detail.description)}</div>`;
  }
  if (detail.output_files && detail.output_files.length) {
    for (const f of detail.output_files) {
      if (!f.exists) {
        html += `<div class="build-output-missing">${escapeHtml(f.name)} (not found)</div>`;
        continue;
      }
      const fileUrl = `/api/repo-file?path=${encodeURIComponent(f.path)}`;
      if (f.suffix === ".pdf") {
        html += `<div class="build-pdf-wrap">` +
          `<div class="build-pdf-toolbar">` +
          `<span class="build-pdf-name">${escapeHtml(f.name)}</span>` +
          `<a class="build-pdf-open" href="${escapeHtml(fileUrl)}" target="_blank">Open ↗</a>` +
          `</div>` +
          `<iframe class="build-pdf-frame" src="${escapeHtml(fileUrl)}" title="${escapeHtml(f.name)}"></iframe>` +
          `</div>`;
      } else {
        html += `<div class="build-attachment-item">` +
          `<a class="catalog-record-link" href="${escapeHtml(fileUrl)}" target="_blank">` +
          `<span class="catalog-record-link-label">${escapeHtml(f.name)}</span>` +
          `</a></div>`;
      }
    }
  }
  if (detail.images && detail.images.length) {
    html += `<div class="analysis-section-label">Images</div><div class="analysis-images">`;
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

  const hasPdf = detail.output_files && detail.output_files.some(f => f.suffix === ".pdf" && f.exists);
  buildBody.classList.toggle("has-pdf", Boolean(hasPdf));
  buildBody.innerHTML = html;

  let missingCount = 0;
  const analysisLinks = (detail.source_analysis || []).map(src => {
    const id = src.analysis_id || src.ref;
    const label = src.display_name || id;
    if (src.exists) return wsRecordLink(`/analysis/?id=${encodeURIComponent(id)}`, label, id);
    missingCount += 1;
    return `<span class="catalog-record-link missing">` +
      `<span class="catalog-record-link-label">${escapeHtml(label)}</span>` +
      `<span class="catalog-record-link-sub">${escapeHtml(id)}</span>` +
      `</span>`;
  });
  const warningHtml = missingCount
    ? `<div class="analysis-links-warning">${escapeHtml(`${missingCount} analysis source${missingCount === 1 ? "" : "s"} could not be found. This build may be stale.`)}</div>`
    : "";
  const linksHtml = warningHtml + wsLinkBlock("ANALYSIS", analysisLinks);
  buildLinks.innerHTML = linksHtml || '<div class="data-info-val muted">—</div>';
  memoPanel.load({kind: "build", id: detail.id}).catch(err => setStatus(err.message, true));
}

async function loadBuilds() {
  setStatus("Loading…");
  const [payload, configPayload] = await Promise.all([apiJson("/api/builds"), apiJson("/api/config")]);
  dbRoot = configPayload.db_root || "";
  entries = payload.entries || [];
  renderList(entries);
  const paramId = new URLSearchParams(location.search).get("id");
  const initialId = paramId && entries.some(e => e.id === paramId) ? paramId : (entries[0]?.id || null);
  if (initialId) await selectBuild(initialId);
  setStatus("");
}

initPaneResize({
  root: document.querySelector(".catalog-main"),
  container: document.querySelector(".catalog-main"),
  leftSplitterId: "catalogLeftSplitter",
  rightSplitterId: "catalogRightSplitter",
  storagePrefix: "lab-build",
  left: {min: 140, max: 520, reserve: 460},
  right: {min: 160, max: 560, reserve: 440},
});

buildSidePanelSelect?.addEventListener("change", () => setSidePanel(buildSidePanelSelect.value));
setSidePanel("info");
loadBuilds().catch(err => setStatus(err.message, true));

initDropUpload({
  getTarget: () => currentId ? {kind: "build", id: currentId} : null,
  onUploaded: (target) => {
    loadAndRenderAttachments(document.getElementById("attachmentsSection"), target.kind, target.id);
  },
});
