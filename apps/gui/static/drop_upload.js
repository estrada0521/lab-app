"use strict";

(function () {
  let _getTarget = null;
  let _onUploaded = null;
  let _uploadOne = null;
  let _overlay = null;
  let _dragDepth = 0;
  let _toast = null;

  // ── Overlay ──────────────────────────────────────────────────────────────
  function getOverlay() {
    if (!_overlay) {
      _overlay = document.createElement("div");
      _overlay.className = "drop-overlay";
      _overlay.innerHTML =
        `<div class="drop-overlay-inner">` +
        `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>` +
        `<polyline points="17 8 12 3 7 8"/>` +
        `<line x1="12" y1="3" x2="12" y2="15"/>` +
        `</svg>` +
        `<span class="drop-overlay-label">Drop to attach</span>` +
        `<span class="drop-overlay-hint" id="dropOverlayHint"></span>` +
        `</div>`;
      document.body.appendChild(_overlay);
    }
    return _overlay;
  }

  function showOverlay() {
    const ov = getOverlay();
    const target = _getTarget ? _getTarget() : null;
    const hint = ov.querySelector("#dropOverlayHint");
    if (hint) {
      hint.textContent = target && target.id ? `${target.kind}/${target.id}/uploaded/` : "no record selected";
    }
    ov.classList.add("active");
  }

  function hideOverlay() {
    if (_overlay) _overlay.classList.remove("active");
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg, isError) {
    if (!_toast) {
      _toast = document.createElement("div");
      _toast.className = "drop-toast";
      document.body.appendChild(_toast);
    }
    _toast.textContent = msg;
    _toast.className = "drop-toast" + (isError ? " error" : " ok");
    _toast.classList.add("visible");
    clearTimeout(_toast._timer);
    _toast._timer = setTimeout(() => _toast.classList.remove("visible"), 2400);
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  async function defaultUploadAttachment(file, target) {
    const bytes = await file.arrayBuffer();
    const url = `/api/upload-attachment?kind=${encodeURIComponent(target.kind)}&id=${encodeURIComponent(target.id)}&filename=${encodeURIComponent(file.name)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/octet-stream"},
      body: bytes,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  async function runUploadsForFiles(files) {
    const target = _getTarget ? _getTarget() : null;
    if (!target || !target.id) {
      showToast("No record selected", true);
      return;
    }
    const upload = _uploadOne || defaultUploadAttachment;
    let ok = 0, fail = 0;
    for (const file of files) {
      try {
        await upload(file, target);
        ok++;
      } catch (err) {
        fail++;
        console.error("Upload failed:", file.name, err);
      }
    }
    if (fail === 0) showToast(`Uploaded ${ok} file${ok !== 1 ? "s" : ""}`, false);
    else showToast(`${ok} uploaded, ${fail} failed`, true);
    if (ok > 0 && _onUploaded) _onUploaded(target);
  }

  // ── Drag events ───────────────────────────────────────────────────────────
  document.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer || !e.dataTransfer.types.includes("Files")) return;
    _dragDepth++;
    showOverlay();
    e.preventDefault();
  });

  document.addEventListener("dragleave", () => {
    _dragDepth = Math.max(0, _dragDepth - 1);
    if (_dragDepth === 0) hideOverlay();
  });

  document.addEventListener("dragover", (e) => {
    if (!e.dataTransfer || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  document.addEventListener("drop", async (e) => {
    _dragDepth = 0;
    hideOverlay();
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    await runUploadsForFiles(Array.from(e.dataTransfer.files));
  });

  // ── Open repo path with OS default app (same as /api/open-external) ───────
  async function openRepoFileExternally(repoPath) {
    const p = String(repoPath || "").trim();
    if (!p) return;
    const res = await fetch("/api/open-external", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({path: p}),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      let msg = text || res.statusText;
      try {
        const o = JSON.parse(text);
        if (o && o.error) msg = o.error;
      } catch (_) { /* keep raw */ }
      throw new Error(msg);
    }
  }

  window.openRepoFileExternally = openRepoFileExternally;

  // ── Attachments list ──────────────────────────────────────────────────────
  async function loadAttachments(kind, id) {
    const res = await fetch(`/api/attachments?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => ({files: []}));
    return data.files || [];
  }

  function attachmentNameIsImage(name) {
    const ext = String(name || "").split(".").pop().toLowerCase();
    return ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "heif", "avif"].includes(ext);
  }

  function renderAttachments(container, files) {
    if (!container) return;
    container.innerHTML = "";
    if (!files.length) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    for (const f of files) {
      const url = `/api/repo-file?path=${encodeURIComponent(f.path)}`;
      const ext = f.name.split(".").pop().toLowerCase();
      const isImage = attachmentNameIsImage(f.name);
      const item = document.createElement("div");
      item.className = "attachment-item attachment-item--openable";
      item.setAttribute("role", "button");
      item.tabIndex = 0;
      item.title = "Open with default app";
      const icon = isImage
        ? `<img class="attachment-thumb" src="${escHtml(url)}" alt="" loading="lazy">`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
      item.innerHTML = icon + `<span class="attachment-name">${escHtml(f.name)}</span>`;
      const open = () => {
        openRepoFileExternally(f.path).catch(err => console.error(err));
      };
      item.addEventListener("click", open);
      item.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
      container.appendChild(item);
    }
  }

  function escHtml(s) {
    return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  // ── Public API ────────────────────────────────────────────────────────────
  /** Run the same upload pipeline as a document drop (for page-local drop zones). */
  window.labRunDropUploads = function (files) {
    return runUploadsForFiles(Array.from(files || []));
  };

  window.initDropUpload = function ({getTarget, onUploaded, uploadFile}) {
    _getTarget = getTarget;
    _onUploaded = onUploaded;
    _uploadOne = typeof uploadFile === "function" ? uploadFile : null;
  };

  window.loadAndRenderAttachments = async function (container, kind, id, options) {
    if (!container || !kind || !id) { if (container) container.hidden = true; return; }
    let files = await loadAttachments(kind, id);
    if (options && options.hideUploadedImagesForSample && kind === "sample") {
      files = files.filter(f => !attachmentNameIsImage(f.name));
    }
    renderAttachments(container, files);
  };
})();
