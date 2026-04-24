// Reusable rawdata memo panel. The panel can load/save the memo either for a
// direct rawdata path, for a derived path whose memo lives on the upstream
// rawdata, or for a generated data file using its own metadata.

function createRawMemoPanel(options) {
  const input = options.input;
  const saveBtn = options.saveBtn;
  const revertBtn = options.revertBtn;
  const statusEl = options.statusEl;
  const mode = options.mode || "direct"; // "direct" | "upstream" | "data"

  let currentPath = "";
  let currentMode = mode;
  let resolvedRawPath = null;
  let original = "";
  let updatedAt = null;
  let saving = false;

  async function apiJson(url, init) {
    const response = await fetch(url, init);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(payload.error || response.statusText);
    return payload;
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = "memo-status";
    if (kind) statusEl.classList.add(kind);
  }

  function buttonsState() {
    if (!input) return;
    const hasPath = Boolean(currentPath) && (currentMode !== "upstream" || resolvedRawPath);
    const dirty = hasPath && input.value !== original;
    input.disabled = !hasPath;
    if (saveBtn) saveBtn.disabled = !hasPath || !dirty || saving;
    if (revertBtn) revertBtn.disabled = !hasPath || !dirty || saving;
    if (!currentPath) {
      setStatus("");
    } else if (currentMode === "upstream" && !resolvedRawPath) {
      setStatus("no rawdata source linked", "info");
    } else if (dirty) {
      setStatus("unsaved changes", "dirty");
    } else if (updatedAt) {
      const suffix = currentMode === "upstream" && resolvedRawPath ? ` · ${resolvedRawPath.split("/").pop()}` : "";
      setStatus(`saved · ${updatedAt}${suffix}`, "saved");
    } else if (currentMode === "upstream" && resolvedRawPath) {
      const suffix = resolvedRawPath.split("/").pop();
      setStatus(`no memo yet · ${suffix}`, "info");
    } else {
      setStatus("no memo yet");
    }
  }

  function reset(message) {
    original = "";
    updatedAt = null;
    resolvedRawPath = null;
    if (input) input.value = "";
    buttonsState();
    if (message) setStatus(message);
  }

  async function load(path, modeOverride) {
    currentPath = path || "";
    currentMode = modeOverride || mode;
    if (!currentPath || !input) { reset(""); return; }
    const kind = currentMode === "data" ? "data" : currentMode === "upstream" ? "rawdata-for" : "rawdata";
    const url = `/api/memo?kind=${encodeURIComponent(kind)}&path=${encodeURIComponent(currentPath)}`;
    try {
      const payload = await apiJson(url);
      original = payload.memo || "";
      updatedAt = payload.updated_at || null;
      resolvedRawPath = payload.raw_path || null;
      if (currentMode === "upstream" && payload.resolved === false) {
        resolvedRawPath = null;
      }
      input.value = original;
      buttonsState();
    } catch (err) {
      original = "";
      updatedAt = null;
      resolvedRawPath = null;
      input.value = "";
      buttonsState();
      setStatus(err.message || "memo load failed", "error");
    }
  }

  async function save() {
    if (!input || !currentPath) return;
    if (currentMode === "upstream" && !resolvedRawPath) return;
    saving = true;
    buttonsState();
    setStatus("saving…", "info");
    try {
      const kind = currentMode === "data" ? "data" : currentMode === "upstream" ? "rawdata-for" : "rawdata";
      const payload = await apiJson("/api/memo", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({kind, path: currentPath, memo: input.value}),
      });
      original = payload.memo || "";
      updatedAt = payload.updated_at || null;
      resolvedRawPath = payload.raw_path || resolvedRawPath;
      input.value = original;
    } catch (err) {
      setStatus(err.message || "save failed", "error");
    } finally {
      saving = false;
      buttonsState();
    }
  }

  function revert() {
    if (!input) return;
    input.value = original;
    buttonsState();
  }

  if (input) input.addEventListener("input", buttonsState);
  if (input) input.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      save();
    }
  });
  if (saveBtn) saveBtn.addEventListener("click", () => { save(); });
  if (revertBtn) revertBtn.addEventListener("click", revert);

  buttonsState();

  return {load, save, revert, reset};
}
