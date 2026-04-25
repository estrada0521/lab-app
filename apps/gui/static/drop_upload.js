"use strict";

(function () {
  let _getTarget = null;
  let _onUploaded = null;
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
    if (hint) hint.textContent = target && target.id ? target.kind + "/" + target.id + "/uploaded/" : "no record selected";
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
  async function uploadFile(file, target) {
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

    const target = _getTarget ? _getTarget() : null;
    if (!target || !target.id) {
      showToast("No record selected", true);
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    let ok = 0, fail = 0;
    for (const file of files) {
      try {
        await uploadFile(file, target);
        ok++;
      } catch (err) {
        fail++;
        console.error("Upload failed:", file.name, err);
      }
    }

    if (fail === 0) showToast(`Uploaded ${ok} file${ok !== 1 ? "s" : ""}`, false);
    else showToast(`${ok} uploaded, ${fail} failed`, true);

    if (ok > 0 && _onUploaded) _onUploaded(target);
  });

  // ── Attachments list ──────────────────────────────────────────────────────
  async function loadAttachments(kind, id) {
    const res = await fetch(`/api/attachments?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => ({files: []}));
    return data.files || [];
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
      const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
      const item = document.createElement("div");
      item.className = "attachment-item";
      const icon = isImage
        ? `<img class="attachment-thumb" src="${escHtml(url)}" alt="" loading="lazy">`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
      item.innerHTML =
        `<a class="attachment-link" href="${escHtml(url)}" target="_blank">` +
        icon +
        `<span class="attachment-name">${escHtml(f.name)}</span>` +
        `</a>`;
      container.appendChild(item);
    }
  }

  function escHtml(s) {
    return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.initDropUpload = function ({getTarget, onUploaded}) {
    _getTarget = getTarget;
    _onUploaded = onUploaded;
  };

  window.loadAndRenderAttachments = async function (container, kind, id) {
    if (!container || !kind || !id) { if (container) container.hidden = true; return; }
    const files = await loadAttachments(kind, id);
    renderAttachments(container, files);
  };
})();
