(function () {
  // ── Modal HTML ────────────────────────────────────────────────────────
  const MODAL_HTML = `
<div class="ar-overlay" id="arOverlay" hidden role="dialog" aria-modal="true">
  <div class="ar-dialog" id="arDialog">
    <div class="ar-inner">
      <div class="ar-header">
        <div class="ar-tabs" role="tablist">
          <button class="ar-tab" role="tab" data-kind="rawdata" type="button">Rawdata</button>
          <button class="ar-tab" role="tab" data-kind="sample" type="button">Sample</button>
          <button class="ar-tab" role="tab" data-kind="exp" type="button">Experiment</button>
        </div>
      </div>
      <div class="ar-id-row">
        <span class="ar-id-label">ID</span>
        <span class="ar-id-value" id="arId">—</span>
      </div>
      <div class="ar-form-wrap">
        <div class="ar-form" id="arForm"></div>
      </div>
      <div class="ar-footer">
        <span class="ar-status" id="arStatus"></span>
        <button class="ar-submit" type="button" id="arSubmit">Add</button>
      </div>
    </div>
  </div>
</div>`;

  // ── Field definitions ─────────────────────────────────────────────────
  const RAWDATA_FIELDS = [
    { key: "display_name", label: "Display name", type: "text", required: true },
    { key: "kind", label: "Kind", type: "text", required: false, placeholder: "magnetization, strain, …" },
    { key: "sample_id", label: "Sample", type: "select-sample", required: false },
    { key: "exp_id", label: "Experiment", type: "select-exp", required: false },
    { key: "default_x", label: "Default X", type: "text", required: false },
    { key: "default_y", label: "Default Y", type: "text", required: false },
    { key: "__file__", label: "Data file", type: "file", required: true, accept: ".dat,.csv,.txt,.tsv", slot: "payload" },
    { key: "memo", label: "Memo", type: "textarea", required: false },
  ];

  const SAMPLE_FIELDS = [
    { key: "display_name", label: "Display name", type: "text", required: true, placeholder: "e.g. 250707" },
    { key: "material_id", label: "Material", type: "text", required: false, placeholder: "e.g. NiS2" },
    { key: "form", label: "Form", type: "select", required: false, options: ["", "single_crystal", "powder", "thin_film", "polycrystal", "other"] },
    { key: "orientation", label: "Orientation", type: "text", required: false, placeholder: "e.g. 001" },
    { key: "mass_mg", label: "Mass (mg)", type: "text", required: false, numeric: true },
    { key: "owner", label: "Owner", type: "text", required: false },
    { key: "synthesizer", label: "Synthesizer", type: "text", required: false },
    { key: "synthesis_date", label: "Synthesis date", type: "text", required: false, placeholder: "YYMMDD" },
    { key: "polish_date", label: "Polish date", type: "text", required: false, placeholder: "YYMMDD" },
    { key: "__file__", label: "Main image", type: "file", required: false, accept: "image/*", slot: "image" },
    { key: "memo", label: "Memo", type: "textarea", required: false },
  ];

  const EXP_FIELDS = [
    { key: "display_name", label: "Display name", type: "text", required: true },
    { key: "start_date", label: "Start date", type: "text", required: false, placeholder: "YYMMDD" },
    { key: "end_date", label: "End date", type: "text", required: false, placeholder: "YYMMDD" },
    { key: "__file__", label: "Main doc (.md)", type: "file", required: false, accept: ".md,.txt", slot: "doc" },
    { key: "memo", label: "Memo", type: "textarea", required: false },
  ];

  const FIELDS = { rawdata: RAWDATA_FIELDS, sample: SAMPLE_FIELDS, exp: EXP_FIELDS };

  // ── State ─────────────────────────────────────────────────────────────
  let _kind = "rawdata";
  let _nextId = null;
  let _selectedFile = null;
  let _samplesCache = null;
  let _expsCache = null;
  let _submitting = false;

  // ── API ───────────────────────────────────────────────────────────────
  async function apiJson(url, opts) {
    const res = await fetch(url, opts);
    const text = await res.text();
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = JSON.parse(text).error || msg; } catch { /**/ }
      throw new Error(msg);
    }
    return text ? JSON.parse(text) : {};
  }

  async function loadNextId(kind) {
    _nextId = null;
    const el = document.getElementById("arId");
    if (el) el.textContent = "…";
    try {
      const data = await apiJson(`/api/next-id?kind=${encodeURIComponent(kind)}`);
      _nextId = data.id;
      if (el) el.textContent = data.id;
    } catch {
      if (el) el.textContent = "—";
    }
  }

  async function getSamples() {
    if (_samplesCache) return _samplesCache;
    const data = await apiJson("/api/samples");
    _samplesCache = data.entries || [];
    return _samplesCache;
  }

  async function getExps() {
    if (_expsCache) return _expsCache;
    const data = await apiJson("/api/experiments");
    _expsCache = data.entries || [];
    return _expsCache;
  }

  // ── Form rendering ────────────────────────────────────────────────────
  function buildField(field) {
    const row = document.createElement("div");
    row.className = "ar-field";

    const label = document.createElement("label");
    label.className = "ar-label";
    label.textContent = field.label;
    if (field.required) {
      const req = document.createElement("span");
      req.className = "ar-req";
      req.textContent = " *";
      label.appendChild(req);
    }

    if (field.type === "file") {
      label.htmlFor = `arField_${field.key}`;
      const wrap = document.createElement("div");
      wrap.className = "ar-file-wrap";

      const input = document.createElement("input");
      input.type = "file";
      input.accept = field.accept || "*";
      input.className = "ar-file-input";
      input.id = `arField_${field.key}`;
      input.style.display = "none";
      input.dataset.slot = field.slot || "payload";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ar-file-btn";
      btn.textContent = "Choose…";

      const nameTxt = document.createElement("span");
      nameTxt.className = "ar-file-name";
      nameTxt.textContent = field.required ? "" : "None";

      btn.addEventListener("click", () => input.click());
      input.addEventListener("change", () => {
        const f = input.files[0];
        if (f) {
          _selectedFile = { file: f, slot: field.slot || "payload" };
          nameTxt.textContent = f.name;
          btn.textContent = "Change…";
        }
      });

      wrap.appendChild(input);
      wrap.appendChild(btn);
      wrap.appendChild(nameTxt);
      row.appendChild(label);
      row.appendChild(wrap);

    } else if (field.type === "select") {
      const select = document.createElement("select");
      select.className = "ar-input ar-select";
      select.id = `arField_${field.key}`;
      select.name = field.key;
      label.htmlFor = select.id;
      for (const opt of (field.options || [])) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt || "—";
        select.appendChild(o);
      }
      row.appendChild(label);
      row.appendChild(select);

    } else if (field.type === "select-sample" || field.type === "select-exp") {
      const select = document.createElement("select");
      select.className = "ar-input ar-select";
      select.id = `arField_${field.key}`;
      select.name = field.key;
      label.htmlFor = select.id;

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Loading…";
      select.appendChild(placeholder);
      row.appendChild(label);
      row.appendChild(select);

      const loader = field.type === "select-sample" ? getSamples : getExps;
      loader().then(entries => {
        select.innerHTML = "";
        if (!field.required) {
          const empty = document.createElement("option");
          empty.value = "";
          empty.textContent = "—";
          select.appendChild(empty);
        }
        for (const entry of entries) {
          const o = document.createElement("option");
          o.value = entry.id;
          o.textContent = `${entry.id}  ${entry.display_name || entry.id}`;
          select.appendChild(o);
        }
        if (!entries.length) {
          const none = document.createElement("option");
          none.value = "";
          none.textContent = "(none)";
          select.appendChild(none);
        }
      }).catch(() => {
        select.innerHTML = `<option value="">(error)</option>`;
      });

    } else if (field.type === "textarea") {
      const textarea = document.createElement("textarea");
      textarea.className = "ar-input ar-textarea";
      textarea.id = `arField_${field.key}`;
      textarea.name = field.key;
      textarea.rows = 3;
      if (field.placeholder) textarea.placeholder = field.placeholder;
      label.htmlFor = textarea.id;
      row.className = "ar-field ar-field-full";
      row.appendChild(label);
      row.appendChild(textarea);

    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "ar-input";
      input.id = `arField_${field.key}`;
      input.name = field.key;
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.required) input.required = true;
      label.htmlFor = input.id;
      row.appendChild(label);
      row.appendChild(input);
    }

    return row;
  }

  function renderForm(kind) {
    const container = document.getElementById("arForm");
    if (!container) return;
    container.innerHTML = "";
    _selectedFile = null;
    for (const field of (FIELDS[kind] || [])) {
      container.appendChild(buildField(field));
    }
  }

  // ── Kind switch ───────────────────────────────────────────────────────
  function switchKind(kind) {
    _kind = kind;
    document.querySelectorAll("#arDialog .ar-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.kind === kind);
      t.setAttribute("aria-selected", t.dataset.kind === kind ? "true" : "false");
    });
    renderForm(kind);
    loadNextId(kind);
    clearStatus();
  }

  // ── Submit ────────────────────────────────────────────────────────────
  function collectMeta() {
    const form = document.getElementById("arForm");
    if (!form) return {};
    const meta = {};
    for (const field of (FIELDS[_kind] || [])) {
      if (field.type === "file") continue;
      const el = form.querySelector(`[name="${field.key}"]`);
      if (!el) continue;
      const val = el.value.trim();
      if (!val) continue;
      if (field.numeric) {
        const n = parseFloat(val);
        if (!isNaN(n)) meta[field.key] = n;
      } else {
        meta[field.key] = val;
      }
    }
    return meta;
  }

  function validate() {
    const form = document.getElementById("arForm");
    for (const field of (FIELDS[_kind] || [])) {
      if (!field.required) continue;
      if (field.type === "file") {
        if (!_selectedFile) return `"${field.label}" is required`;
        continue;
      }
      const el = form ? form.querySelector(`[name="${field.key}"]`) : null;
      if (!el || !el.value.trim()) return `"${field.label}" is required`;
    }
    return null;
  }

  function setStatus(text, isErr) {
    const el = document.getElementById("arStatus");
    if (!el) return;
    el.textContent = text;
    el.className = `ar-status${isErr ? " ar-status-err" : " ar-status-ok"}`;
  }

  function clearStatus() {
    const el = document.getElementById("arStatus");
    if (el) { el.textContent = ""; el.className = "ar-status"; }
  }

  async function submit() {
    if (_submitting) return;
    const err = validate();
    if (err) { setStatus(err, true); return; }

    _submitting = true;
    const btn = document.getElementById("arSubmit");
    if (btn) btn.disabled = true;
    clearStatus();

    try {
      const meta = collectMeta();

      if (_kind === "rawdata" && _selectedFile) {
        meta.payload_file = _selectedFile.file.name;
        meta.uploaded_at = new Date().toISOString().slice(0, 19);
      }

      const res = await apiJson("/api/create-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: _kind, metadata: meta }),
      });

      const newId = res.id;

      if (_selectedFile) {
        const bytes = await _selectedFile.file.arrayBuffer();
        await fetch(
          `/api/upload-record-file?kind=${encodeURIComponent(_kind)}&id=${encodeURIComponent(newId)}&filename=${encodeURIComponent(_selectedFile.file.name)}&slot=${encodeURIComponent(_selectedFile.slot)}`,
          { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes }
        );
      }

      setStatus(`Created: ${newId}`, false);
      _nextId = null;

      setTimeout(() => {
        closeDialog();
        if (typeof reloadRecords === "function") reloadRecords();
        if (typeof loadAllFiles === "function") loadAllFiles();
      }, 900);

    } catch (e) {
      setStatus(e.message || "Error", true);
    } finally {
      _submitting = false;
      if (btn) btn.disabled = false;
    }
  }

  // ── Open / Close ──────────────────────────────────────────────────────
  function openDialog(kind) {
    _samplesCache = null;
    _expsCache = null;
    const overlay = document.getElementById("arOverlay");
    if (!overlay) return;
    switchKind(kind || "rawdata");
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeDialog() {
    const overlay = document.getElementById("arOverlay");
    if (overlay) overlay.hidden = true;
    document.body.style.overflow = "";
    _submitting = false;
    _selectedFile = null;
  }

  // ── Init ──────────────────────────────────────────────────────────────
  function init(options) {
    const opts = options || {};
    const defaultKind = opts.defaultKind || "rawdata";

    if (!document.getElementById("arOverlay")) {
      document.body.insertAdjacentHTML("beforeend", MODAL_HTML);

      document.querySelectorAll(".ar-tab").forEach(tab => {
        tab.addEventListener("click", () => switchKind(tab.dataset.kind));
      });

      document.getElementById("arOverlay").addEventListener("click", e => {
        if (e.target === e.currentTarget || e.target === document.getElementById("arDialog")) closeDialog();
      });

      document.addEventListener("keydown", e => {
        if (e.key === "Escape" && !document.getElementById("arOverlay").hidden) closeDialog();
      });

      const submitBtn = document.getElementById("arSubmit");
      if (submitBtn) submitBtn.addEventListener("click", submit);
    }

    // Add + button to the first topline found
    const topline = document.querySelector(".browser-topline, .catalog-pane-topline");
    if (topline && !topline.querySelector(".ar-nav-btn")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ar-nav-btn";
      btn.title = "Add new record";
      btn.setAttribute("aria-label", "Add new record");
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7.5 2.5V12.5"/><path d="M2.5 7.5H12.5"/></svg>`;
      btn.addEventListener("click", () => openDialog(defaultKind));
      topline.appendChild(btn);
    }
  }

  // Auto-init based on page context
  function autoInit() {
    const page = document.body.dataset.page || "";
    const kindMap = { viewer: "rawdata", samples: "sample", experiments: "exp" };
    const defaultKind = kindMap[page] || "rawdata";
    if (page === "viewer" || page === "samples" || page === "experiments") {
      init({ defaultKind });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }

  window.initAddRecordBtn = init;
  window.openAddRecordDialog = openDialog;
})();
