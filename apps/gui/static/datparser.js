// Plain JavaScript for now; this file is separated so it can be replaced by a TypeScript build later.
    const browserTree = document.getElementById("browserTree");
    const workspaceMain = document.getElementById("workspaceMain");
    const browserSearch = document.getElementById("browserSearch");
    const browserTargetToggle = document.getElementById("browserTargetToggle");
    const measurementFilterSelect = document.getElementById("measurementFilterSelect");
    const timeFilterSelect = document.getElementById("timeFilterSelect");
    const browserAdvancedBtn = document.getElementById("browserAdvancedBtn");
    const browserAdvancedFilters = document.getElementById("browserAdvancedFilters");
    const sampleFilterSelect = document.getElementById("sampleFilterSelect");
    const expFilterSelect = document.getElementById("expFilterSelect");
    const rawMemoInput = document.getElementById("rawMemoInput");
    const rawMemoSaveBtn = document.getElementById("rawMemoSaveBtn");
    const rawMemoRevertBtn = document.getElementById("rawMemoRevertBtn");
    const rawMemoStatus = document.getElementById("rawMemoStatus");
    const xAxis = document.getElementById("xAxis");
    const yAxis = document.getElementById("yAxis");
    const dualPlotInput = document.getElementById("dualPlotInput");
    const yAxis2 = document.getElementById("yAxis2");
    const statusEl = document.getElementById("status");
    const columnsBody = document.getElementById("columnsBody");
    const outputColumnsPreview = document.getElementById("outputColumnsPreview");
    const canvas = document.getElementById("plot");
    const ctx = canvas.getContext("2d");

    const panBtn = document.getElementById("panBtn");
    const zoomBtn = document.getElementById("zoomBtn");
    const homeBtn = document.getElementById("homeBtn");
    const backBtn = document.getElementById("backBtn");
    const forwardBtn = document.getElementById("forwardBtn");
    const dataOutputName = document.getElementById("dataOutputName");
    const calculatorSelect = document.getElementById("calculatorSelect");
    const calculatorStatus = document.getElementById("calculatorStatus");
    const calculatorOptionBlock = document.getElementById("calculatorOptionBlock");
    const calculatorOptions = document.getElementById("calculatorOptions");
    const parameterBlock = document.getElementById("parameterBlock");
    const parameterToggle = document.getElementById("parameterToggle");
    const boundParameters = document.getElementById("boundParameters");
    const rangeHeadActions = document.getElementById("rangeHeadActions");
    const sidePanelSelect = document.getElementById("sidePanelSelect");
    const dataInfoPanelSelect = document.getElementById("dataInfoPanelSelect");
    const rawInfoGrid = document.getElementById("rawInfoGrid");
    const dataInfoGrid = document.getElementById("dataInfoGrid");
    const rawJsonPanel = document.getElementById("rawJsonPanel");
    const dataJsonPanel = document.getElementById("dataJsonPanel");
    const workspaceRelatedLinks = document.getElementById("workspaceRelatedLinks");
    const workspaceTitle = document.getElementById("workspaceTitle");
    const workspaceMeta = document.getElementById("workspaceMeta");
    const generateDataBtn = document.getElementById("generateDataBtn");
    const previewFilterBtn = document.getElementById("previewFilterBtn");
    const plotLineModeBtn = document.getElementById("plotLineModeBtn");
    const plotScatterModeBtn = document.getElementById("plotScatterModeBtn");
    const plotPlayBtn = document.getElementById("plotPlayBtn");
    const plotInfoExportBtn = document.getElementById("plotInfoExportBtn");
    const plotColorsBtn = document.getElementById("plotColorsBtn");
    const plotColorInput = document.getElementById("plotColorInput");
    const plotThemeToggleBtn = document.getElementById("plotThemeToggleBtn");
    const plotThemeToggleLabel = document.getElementById("plotThemeToggleLabel");
    const savePlotPngBtn = document.getElementById("savePlotPngBtn");
    const savePlotPdfBtn = document.getElementById("savePlotPdfBtn");
    const sideTabButtons = Array.from(document.querySelectorAll("[data-panel-tab]"));
    const sidePanels = Array.from(document.querySelectorAll("[data-panel]"));

    const DPR = Math.max(1, window.devicePixelRatio || 1);

    let currentPath = "";
    let columns = [];
    let currentPlot = null;
    let mode = "zoom";
    let drag = null;
    const viewHistory = [];
    let historyIndex = -1;
    let currentKind = "rawdata";
    let workspaceFiles = [];
    let samplesIndex = {};
    let sampleMaterialIndex = {};
    let expsIndex = {};
    let expsStartIndex = {};
    let rawFiles = [];
    let generatedDataFiles = [];
    let currentDataSummary = null;
    let allCalculators = [];
    let currentCalculatorOptions = {};
    let selectedRetainedDataColumns = new Set();
    let sidePanelTab = "info";
    let _loadSeq = 0; // monotonic counter to detect stale async loads

    // ── Context menu ──────────────────────────────────────────────────
    let _ctxMenu = null;
    function showContextMenu(x, y, items) {
      hideContextMenu();
      _ctxMenu = document.createElement("div");
      _ctxMenu.className = "ctx-menu";
      _ctxMenu.style.left = x + "px";
      _ctxMenu.style.top = y + "px";
      for (const {label, action, danger} of items) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ctx-menu-item" + (danger ? " danger" : "");
        btn.textContent = label;
        btn.addEventListener("click", () => { hideContextMenu(); action(); });
        _ctxMenu.appendChild(btn);
      }
      document.body.appendChild(_ctxMenu);
      // Reposition if menu overflows viewport
      const rect = _ctxMenu.getBoundingClientRect();
      if (rect.right > window.innerWidth) _ctxMenu.style.left = (x - rect.width) + "px";
      if (rect.bottom > window.innerHeight) _ctxMenu.style.top = (y - rect.height) + "px";
      setTimeout(() => document.addEventListener("click", hideContextMenu, {once: true}), 0);
    }
    function hideContextMenu() {
      if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
    }
    document.addEventListener("keydown", e => { if (e.key === "Escape") hideContextMenu(); });
    let browserTarget = localStorage.getItem("datparser-browser-target") || "rawdata";
    let plotColorTouched = false;
    let plotTheme = "light";
    let previewFiltersEnabled = false;
    let plotAnimationProgress = 1;
    let plotInfoExportEnabled = false;
    let plotAnimator = null;
    const plotAppearance = {
      style: "line",
      lineColor: plotColorInput?.value || "#111111",
      lineWidth: 1.4,
      tickFontSize: 19,
      labelFontSize: 24,
    };

    function setStatus(message, isError = false) {
      statusEl.textContent = message || "";
      statusEl.classList.toggle("error", isError);
    }

    async function apiJson(url, options = {}) {
      const response = await fetch(url, options);
      const text = await response.text();
      let payload = {};
      if (text) payload = JSON.parse(text);
      if (!response.ok) throw new Error(payload.error || response.statusText);
      return payload;
    }

    function cssVar(name) {
      return getComputedStyle(document.body).getPropertyValue(name).trim();
    }

    function optionList(select, names, selected) {
      select.innerHTML = "";
      if (!names.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "no numeric column";
        option.selected = true;
        select.appendChild(option);
        select.disabled = true;
        return;
      }
      select.disabled = false;
      const selectedValue = names.includes(selected) ? selected : names[0];
      for (const name of names) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        if (name === selectedValue) option.selected = true;
        select.appendChild(option);
      }
      select.value = selectedValue;
    }

    function secondaryAxisDefault(names, primary, fallback) {
      if (!names.length) return "";
      if (fallback && fallback !== primary && names.includes(fallback)) return fallback;
      return names.find(name => name !== primary) || names[0];
    }

    function dualPlotEnabled() {
      return Boolean(dualPlotInput && dualPlotInput.checked && yAxis2 && yAxis2.value && !yAxis2.disabled);
    }

    function updateDualPlotControls() {
      const names = numericColumnNames();
      if (dualPlotInput.checked && names.length > 1 && yAxis2.value === yAxis.value) {
        yAxis2.value = secondaryAxisDefault(names, yAxis.value, "");
      }
      if (yAxis2) yAxis2.disabled = !dualPlotInput.checked || !names.length;
      const enabled = dualPlotEnabled();
      document.body.classList.toggle("dual-plot", enabled);
      updateRangeButtons();
    }

    function numericColumnNames() {
      return columns
        .filter(column => Number(column.numeric_count || 0) > 0)
        .map(column => column.name);
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function kindLabel(kind) {
      if (kind === "rawdata") return "raw";
      if (kind === "data") return "data";
      return kind || "file";
    }

    function markerForKind(kind) {
      if (kind === "data") return "data";
      return "rawdata";
    }

    function pathParts(path, kind = inferKind(path), metadata = null) {
      if (metadata && (metadata.material || metadata.sample || metadata.measurement || metadata.exp || metadata.file || metadata.created)) {
        return {
          kind,
          material: metadata.material || "",
          sample: metadata.sample || "",
          measurement: metadata.measurement || "",
          dependance: metadata.dependance || "",
          fixed: metadata.fixed || "",
          exp: metadata.exp || "",
          time: metadata.created || "",
          file: metadata.file || (path.split("/").pop() || ""),
        };
      }
      const parts = path.split("/");
      const materialsIndex = parts.indexOf("Materials");
      const samplesIndex = parts.indexOf("samples");
      const markerIndex = parts.lastIndexOf(markerForKind(kind));
      return {
        kind,
        material: materialsIndex >= 0 ? (parts[materialsIndex + 1] || "") : "",
        sample: samplesIndex >= 0 ? (parts[samplesIndex + 1] || "") : "",
        measurement: samplesIndex >= 0 ? (parts[samplesIndex + 2] || "") : "",
        exp: markerIndex >= 1 ? (parts[markerIndex - 1] || "") : "",
        time: "",
        file: parts[parts.length - 1] || ""
      };
    }

    function inferKind(path) {
      const parts = path.split("/");
      if (parts.includes("data")) return "data";
      return "rawdata";
    }

    function conditionToken(parts) {
      return String(parts.dependance || "").trim();
    }

    const rawMemoPanel = createRawMemoPanel({
      input: rawMemoInput,
      saveBtn: rawMemoSaveBtn,
      revertBtn: rawMemoRevertBtn,
      statusEl: rawMemoStatus,
      mode: "direct",
    });

    function browserSearchText(item) {
      const parts = pathParts(item.path, item.kind, item);
      return [
        item.display_name || "",
        item.path,
        parts.file,
        parts.sample,
        parts.measurement,
        parts.dependance,
        parts.exp,
        parts.time,
        kindLabel(item.kind),
        item.raw_source || "",
      ].join(" ").toLowerCase();
    }

    function browserPrimaryLabel(item, entityId) {
      if (item.kind === "rawdata" || item.kind === "data") return item.display_name || entityId;
      return entityId;
    }

    function setWorkspaceHeader(path) {
      const item = workspaceFiles.find(entry => entry.path === path);
      const fallback = path ? pathStem(path) : "";
      if (workspaceTitle) workspaceTitle.textContent = item?.display_name || fallback;
      if (workspaceMeta) workspaceMeta.textContent = "";
    }

    function browserSort(a, b) {
      const aParts = pathParts(a.path, a.kind, a);
      const bParts = pathParts(b.path, b.kind, b);
      const aKey = [aParts.measurement, aParts.time, aParts.sample, aParts.exp, a.kind, aParts.file].join("\u0000");
      const bKey = [bParts.measurement, bParts.time, bParts.sample, bParts.exp, b.kind, bParts.file].join("\u0000");
      return aKey.localeCompare(bKey, undefined, {numeric: true});
    }

    function setBrowserTarget(kind, options = {}) {
      browserTarget = kind === "data" ? "data" : "rawdata";
      localStorage.setItem("datparser-browser-target", browserTarget);
      browserTargetToggle?.classList.toggle("is-data", browserTarget === "data");
      if (options.refresh !== false) {
        updateBrowserFiles({selectFirstIfCurrentHidden: options.selectFirstIfCurrentHidden !== false});
      }
    }

    function renderBrowserList() {
      if (!browserTree) return;
      const files = browserFilteredFiles().slice().sort(browserSort);
      browserTree.innerHTML = "";
      if (!files.length) {
        const empty = document.createElement("div");
        empty.className = "tree-empty";
        empty.textContent = workspaceFiles.length ? "No files match the current filters." : "No files discovered.";
        browserTree.appendChild(empty);
        return;
      }
      for (const item of files) {
        const parts = pathParts(item.path, item.kind, item);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "browser-file";
        if (item.path === currentPath) row.classList.add("current");
        row.dataset.kind = item.kind;
        row.dataset.path = item.path;
        const entityId = item.path.split("/")[1] || parts.file;
        const primaryLabel = browserPrimaryLabel(item, entityId);
        row.innerHTML = `
          <div class="browser-file-name" title="Click again to rename">${escapeHtml(primaryLabel)}</div>
        `;
        row.addEventListener("click", (e) => {
          if (row.classList.contains("current")) {
            const nameEl = row.querySelector(".browser-file-name");
            if (nameEl && !nameEl.querySelector("input")) {
              e.stopPropagation();
              startBrowserRename(row, item, entityId, nameEl, primaryLabel);
              return;
            }
          }
          loadTable(item.path, {kind: item.kind}).catch(err => setStatus(err.message, true));
        });
        if (item.kind === "data") {
          row.addEventListener("contextmenu", e => {
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY, [{
              label: "Delete",
              danger: true,
              action: async () => {
                if (!confirm(`Delete data "${entityId}"?\nThis cannot be undone.`)) return;
                try {
                  const result = await apiJson("/api/delete-data", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({id: entityId}),
                  });
                  if (currentPath === item.path) currentPath = "";
                  await loadWorkspaceFiles();
                  if (result?.stale_analysis_count) {
                    setStatus(`Deleted ${entityId}. ${result.stale_analysis_count} analysis project(s) now reference missing data.`);
                  }
                } catch (err) {
                  setStatus(err.message || "Delete failed", true);
                }
              },
            }]);
          });
        }
        browserTree.appendChild(row);
      }
      const current = browserTree.querySelector(".browser-file.current");
      if (current) current.scrollIntoView({block: "nearest"});
    }

    function startBrowserRename(row, item, oldId, nameEl, oldLabel) {
      const input = document.createElement("input");
      input.type = "text";
      input.value = oldLabel;
      input.className = "rename-input";
      input.addEventListener("click", e => e.stopPropagation());
      nameEl.textContent = "";
      nameEl.appendChild(input);
      input.focus();
      input.select();

      async function commit() {
        const newValue = input.value.trim();
        if (!newValue || newValue === oldLabel) { renderBrowserList(); return; }
        try {
          const body = (item.kind === "rawdata" || item.kind === "data")
            ? {kind: item.kind, old_id: oldId, new_name: newValue}
            : {kind: item.kind, old_id: oldId, new_id: newValue};
          await apiJson("/api/rename", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body),
          });
          await loadWorkspaceFiles(item.path);
        } catch (err) {
          setStatus(err.message, true);
          renderBrowserList();
        }
      }

      bindExplicitRenameInput(input, {
        onCommit: commit,
        onCancel: () => renderBrowserList(),
      });
    }

    function browserFilteredFiles() {
      const measurement = measurementFilterSelect.value;
      const dependance = timeFilterSelect.value;
      const sample = sampleFilterSelect?.value || "";
      const exp = expFilterSelect?.value || "";
      const query = (browserSearch.value || "").trim().toLowerCase();
      return workspaceFiles.filter(item => {
        const parts = pathParts(item.path, item.kind, item);
        return item.kind === browserTarget
          && (!measurement || parts.measurement === measurement)
          && (!dependance || conditionToken(parts) === dependance)
          && (!sample || parts.sample === sample)
          && (!exp || parts.exp === exp)
          && (!query || browserSearchText(item).includes(query));
      });
    }

    function setSelectOptions(select, values, selected = "") {
      const list = Array.from(values);
      const current = selected || select.value || "";
      const selectedValue = list.some(([value]) => value === current) ? current : (list[0]?.[0] || "");
      select.innerHTML = "";
      for (const [value, label] of list) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        if (value === selectedValue) option.selected = true;
        select.appendChild(option);
      }
      select.value = selectedValue;
    }

    function refreshBrowserFilters() {
      const measurements = Array.from(new Set(workspaceFiles.map(item => pathParts(item.path, item.kind, item).measurement).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
      const dependances = Array.from(new Set(workspaceFiles.map(item => conditionToken(pathParts(item.path, item.kind, item))).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
      const samples = Array.from(new Set(workspaceFiles.map(item => pathParts(item.path, item.kind, item).sample).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
      const exps = Array.from(new Set(workspaceFiles.map(item => pathParts(item.path, item.kind, item).exp).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
      setSelectOptions(measurementFilterSelect, [["", "all kinds"], ...measurements.map(value => [value, value])]);
      setSelectOptions(timeFilterSelect, [["", "all conditions"], ...dependances.map(value => [value, value])]);
      if (sampleFilterSelect) setSelectOptions(sampleFilterSelect, [["", "all samples"], ...samples.map(id => [id, samplesIndex[id] ? `${samplesIndex[id]} (${id})` : id])]);
      if (expFilterSelect) setSelectOptions(expFilterSelect, [["", "all exps"], ...exps.map(id => [id, expsIndex[id] ? `${expsIndex[id]} (${id})` : id])]);
    }

    function updateBrowserFiles(options = {}) {
      const files = browserFilteredFiles();
      renderBrowserList();
      if (options.selectFirstIfCurrentHidden && files.length && !files.some(item => item.path === currentPath)) {
        loadTable(files[0].path, {kind: files[0].kind}).catch(err => setStatus(err.message, true));
      }
    }

    async function loadWorkspaceFiles(preferredPath = currentPath) {
      const [rawPayload, dataPayload, calculatorsPayload] = await Promise.all([
        apiJson("/api/raw-files"),
        apiJson("/api/data-files"),
        apiJson("/api/calculators"),
      ]);
      rawFiles = rawPayload.files || [];
      generatedDataFiles = dataPayload.files || [];
      allCalculators = calculatorsPayload.calculators || [];
      samplesIndex = rawPayload.samples_index || dataPayload.samples_index || {};
      sampleMaterialIndex = rawPayload.sample_material_index || dataPayload.sample_material_index || {};
      expsIndex = rawPayload.exps_index || dataPayload.exps_index || {};
      expsStartIndex = rawPayload.exps_start_index || dataPayload.exps_start_index || {};
      const rawEntries = rawPayload.entries || rawFiles.map(path => ({path, file: path.split("/").pop() || ""}));
      const dataEntries = dataPayload.entries || generatedDataFiles.map(path => ({path, file: path.split("/").pop() || ""}));
      workspaceFiles = [
        ...rawEntries.map(item => ({kind: "rawdata", ...item})),
        ...dataEntries.map(item => ({kind: "data", ...item})),
      ];
      const previousTargetedFiles = workspaceFiles.filter(item => item.kind === browserTarget);
      const preferred = workspaceFiles.find(item => item.path === preferredPath)
        || workspaceFiles.find(item => item.path === currentPath)
        || workspaceFiles.find(item => item.kind === browserTarget)
        || previousTargetedFiles[0]
        || workspaceFiles[0];
      if (preferred) {
        setBrowserTarget(preferred.kind, {refresh: false});
      }
      refreshBrowserFilters();
      updateBrowserFiles();
      const targetedFiles = workspaceFiles.filter(item => item.kind === browserTarget);
      const resolvedPreferred = workspaceFiles.find(item => item.path === preferredPath)
        || workspaceFiles.find(item => item.path === currentPath)
        || targetedFiles[0]
        || workspaceFiles[0];
      if (resolvedPreferred) {
        await loadTable(resolvedPreferred.path, {kind: resolvedPreferred.kind});
      } else {
        currentPath = "";
        currentKind = "rawdata";
        setWorkspaceHeader("");
        columns = [];
        currentPlot = null;
        updateSelectedKindClass();
        optionList(xAxis, [], "");
        optionList(yAxis, [], "");
        optionList(yAxis2, [], "");
        updateDualPlotControls();
        buildColumnTable();
        rawMemoPanel.reset("No file loaded.");
        setGenerateDataEnabled(false);
        render();
        setStatus("No rawdata/data files found.", true);
      }
    }

    function pathStem(path) {
      const name = path.split("/").pop() || "";
      const dot = name.lastIndexOf(".");
      return dot > 0 ? name.slice(0, dot) : name;
    }

    function repoFileUrl(path) {
      return `/api/repo-file?path=${encodeURIComponent(path)}`;
    }

    function availableSideTabs() {
      if (currentKind === "rawdata") return ["make", "info", "json", "links"];
      if (currentKind === "data") return ["info", "json", "links"];
      return [];
    }

    function setSidePanelTab(next) {
      const allowed = new Set(availableSideTabs());
      sidePanelTab = allowed.has(next) ? next : (allowed.values().next().value || "");
      document.body.dataset.sidePanel = sidePanelTab;
      if (sidePanelSelect) sidePanelSelect.value = sidePanelTab;
      if (dataInfoPanelSelect) dataInfoPanelSelect.value = sidePanelTab;
      for (const button of sideTabButtons) {
        const visible = allowed.has(button.dataset.panelTab);
        button.hidden = !visible;
        button.classList.toggle("active", visible && button.dataset.panelTab === sidePanelTab);
      }
      for (const panel of sidePanels) {
        const visible = allowed.has(panel.dataset.panel);
        panel.hidden = !visible || panel.dataset.panel !== sidePanelTab;
        panel.classList.toggle("is-active", visible && panel.dataset.panel === sidePanelTab);
      }
    }

    function updateSelectedKindClass() {
      document.body.classList.toggle("selected-rawdata", currentKind === "rawdata");
      document.body.classList.toggle("selected-data", currentKind === "data");
      setSidePanelTab(sidePanelTab);
    }

    function currentWorkspaceItem() {
      return workspaceFiles.find(item => item.path === currentPath && item.kind === currentKind) || null;
    }

    function renderParameters(parameters) {
      if (!boundParameters) return;
      const entries = Object.entries(parameters || {});
      parameterBlock?.classList.toggle("is-empty", entries.length === 0);
      boundParameters.innerHTML = entries.length
        ? entries.map(([key, value]) => `<div class="param-key" title="${escapeHtml(key)}">${escapeHtml(key)}</div><div class="param-value">${escapeHtml(value)}</div>`).join("")
        : '<div class="param-key">—</div><div class="param-value">—</div>';
    }

    function collectCalculatorOptions() {
      const values = {};
      if (!calculatorOptions) return values;
      for (const el of calculatorOptions.querySelectorAll("[data-option-id]")) {
        const id = el.dataset.optionId;
        if (!id) continue;
        const value = String(el.value || "").trim();
        if (value) values[id] = value;
      }
      return values;
    }

    function renderCalculatorOptionControls(summary) {
      if (!calculatorOptions) return;
      const uiOptions = summary?.selected_calculator?.ui_options || [];
      currentCalculatorOptions = summary?.selected_calculator_options || currentCalculatorOptions || {};
      calculatorOptionBlock?.classList.toggle("is-empty", uiOptions.length === 0);
      if (!uiOptions.length) {
        calculatorOptions.innerHTML = '<div class="param-key">—</div><div class="param-value">—</div>';
        return;
      }
      calculatorOptions.innerHTML = uiOptions.map(option => {
        const id = String(option.id || "").trim();
        const label = String(option.label || id || "option");
        const choices = Array.isArray(option.choices) ? option.choices : [];
        const current = String(currentCalculatorOptions[id] || option.default || "").trim();
        const opts = ['<option value=""></option>', ...choices.map(choice => {
          const value = String(choice.value || "").trim();
          const text = String(choice.label || value).trim();
          const selected = value === current ? ' selected' : '';
          return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(text)}</option>`;
        })].join("");
        return `<div class="param-key">${escapeHtml(label)}</div><div class="param-value"><select data-option-id="${escapeHtml(id)}">${opts}</select></div>`;
      }).join("");
      for (const el of calculatorOptions.querySelectorAll("[data-option-id]")) {
        el.addEventListener("change", () => {
          currentCalculatorOptions = collectCalculatorOptions();
          if (currentKind === "rawdata") {
            renderSourceDataPanel(currentPath, dataOutputName.value.trim()).catch(err => setStatus(err.message, true));
          }
        });
      }
    }

    function calculatorIssues(summary) {
      const selected = summary?.selected_calculator || null;
      if (!selected) return [];
      return [
        ...(selected.missing_columns || summary?.missing_columns || []).map(item => `missing column: ${item}`),
        ...(selected.missing_metadata || summary?.missing_metadata || []).map(item => `missing metadata: ${item}`),
        ...(selected.errors || summary?.calculator_errors || []),
      ];
    }

    function renderCalculatorStatus(summary) {
      if (!calculatorStatus) return;
      const issues = calculatorIssues(summary);
      calculatorStatus.className = "calculator-status";
      calculatorStatus.textContent = issues.length ? issues.join(" · ") : "";
      calculatorStatus.hidden = issues.length === 0;
    }

    function renderOutputColumnsPreview(summary) {
      if (!outputColumnsPreview) return;
      const calc = summary?.selected_calculator;
      const cols = calc?.output_columns || [];
      const transformType = calc?.transform_type || "column";
      if (!cols.length) {
        outputColumnsPreview.hidden = true;
        outputColumnsPreview.innerHTML = "";
        return;
      }
      const tags = cols.map(c => `<span class="output-col-tag">${c}</span>`).join("");
      outputColumnsPreview.innerHTML = `<span class="output-col-label">outputs</span>${tags}`;
      outputColumnsPreview.hidden = false;
      // hide passthrough column selector when calc produces a structural transform
      const wrap = document.querySelector(".columns-table-wrap");
      if (wrap) wrap.hidden = transformType === "structural";
    }

    function selectedRetainedColumnsList(summary = currentDataSummary) {
      const sourceColumns = summary?.source_columns || [];
      return sourceColumns.filter(name => selectedRetainedDataColumns.has(name));
    }

    function renderDataColumnPicker(summary) {
      currentDataSummary = summary;
      const sourceColumns = summary?.source_columns || [];
      const required = new Set(summary?.required_source_columns || []);
      const selected = new Set(summary?.selected_passthrough_columns || []);
      const nextSelected = new Set();
      for (const name of sourceColumns) {
        if (required.has(name)) continue;
        if (selectedRetainedDataColumns.has(name) || selected.has(name)) nextSelected.add(name);
      }
      selectedRetainedDataColumns = nextSelected;
      buildColumnTable();
    }

    function setCalculatorOptions(calculators, selectedId = "") {
      const entries = calculators.map(item => [
        item.id,
        item.display_name || item.id,
      ]);
      setSelectOptions(calculatorSelect, entries.length ? entries : [["", "no calculator available"]], selectedId);
      calculatorSelect.disabled = entries.length === 0;
    }

    function setGenerateDataEnabled(enabled) {
      if (!generateDataBtn) return;
      generateDataBtn.disabled = !enabled;
    }

    function directDataDefaultName(path) {
      return pathStem(path).replace(/-filtered$/i, "");
    }

    function preferredAxisSelection(names, previous, fallback) {
      if (previous && names.includes(previous)) return previous;
      if (fallback && names.includes(fallback)) return fallback;
      return names[0] || "";
    }

    function preferredSecondaryAxisSelection(names, primary, previous, fallback) {
      if (previous && previous !== primary && names.includes(previous)) return previous;
      return secondaryAxisDefault(names, primary, fallback);
    }

    async function renderSourceDataPanel(path, requestedName = "") {
      const query = new URLSearchParams({path});
      const name = requestedName.trim();
      if (name) query.set("display_name", name);
      const calculatorOptionsValue = collectCalculatorOptions();
      if (Object.keys(calculatorOptionsValue).length) {
        query.set("calculator_options", JSON.stringify(calculatorOptionsValue));
      }
      const selectedCalculator = calculatorSelect.value;
      if (selectedCalculator) {
        const selectedEntry = allCalculators.find(item => item.id === selectedCalculator);
        if (selectedEntry) {
          query.set("calculator", selectedCalculator);
        }
      }
      let summary;
      try {
        summary = await apiJson(`/api/data-summary?${query.toString()}`);
      } catch (err) {
        if (query.has("calculator") && /calculator not available for this rawdata/i.test(err.message || "")) {
          query.delete("calculator");
          summary = await apiJson(`/api/data-summary?${query.toString()}`);
        } else {
          throw err;
        }
      }
      currentDataSummary = summary;
      dataOutputName.value = summary.selected_display_name || summary.default_display_name || directDataDefaultName(path);
      setCalculatorOptions(summary.available_calculators || [], summary.selected_calculator?.id || summary.calculator || "");
      renderCalculatorOptionControls(summary);
      renderCalculatorStatus(summary);
      renderOutputColumnsPreview(summary);
      renderParameters(summary.parameters || {});
      renderDataColumnPicker(summary);
      setGenerateDataEnabled(Boolean(summary.calculator_ready));
    }

    function renderInfoGrid(element, rows) {
      renderStructuredInfoGrid(element, rows, {
        keyClass: "data-info-key",
        valueClass: "data-info-val",
      });
    }

    const wsInfoOptions = {keyClass: "data-info-key", valueClass: "data-info-val"};

    function workspaceMetadataPath(path, kind = currentKind) {
      const parts = (path || "").split("/");
      const recordId = parts[1] || "";
      if (!recordId) return "";
      return `${kind}/${recordId}/metadata.json`;
    }

    async function renderRawInfoPanel(path) {
      if (!rawInfoGrid) return;
      rawInfoGrid.innerHTML = "";
      try {
        const meta = await fetchRepoJson(workspaceMetadataPath(path, "rawdata"));
        const rows = typeof buildRawdataInfoRows === "function"
          ? buildRawdataInfoRows(meta, {samplesIndex, sampleMaterialIndex, expsStartIndex, rawPath: path})
          : Object.entries(meta || {});
        renderInfoGrid(rawInfoGrid, rows.filter(([key]) => shouldRenderInfoKey(key)));
      } catch (_) {
        rawInfoGrid.innerHTML = '<div class="data-info-key muted">—</div><div></div>';
      }
    }

    async function renderRawJsonPanel(path) {
      if (!rawJsonPanel) return;
      await renderRepoJsonPanel(rawJsonPanel, workspaceMetadataPath(path, "rawdata"));
    }

    function wsLinkItem(href, text, sub = "") {
      if (!href || !text) return "";
      return `<a class="catalog-record-link" href="${escapeHtml(href)}">` +
        `<span class="catalog-record-link-label">${escapeHtml(text)}</span>` +
        (sub ? `<span class="catalog-record-link-sub">${escapeHtml(sub)}</span>` : "") +
        `</a>`;
    }

    function wsLinkBlock(label, items) {
      const rows = items.map(({href, text, sub}) => wsLinkItem(href, text, sub)).filter(Boolean);
      if (!rows.length) return "";
      return `<section class="link-section">` +
        `<div class="catalog-link-label">${escapeHtml(label)}</div>` +
        `<div class="link-section-list">${rows.join("")}</div>` +
        `</section>`;
    }

    function renderWorkspaceRelatedLinks(meta = null) {
      if (!workspaceRelatedLinks) return;
      if (currentKind === "rawdata") {
        const item = currentWorkspaceItem();
        const parts = pathParts(currentPath, "rawdata", item);
        const dataItems = workspaceFiles
          .filter(entry => entry.kind === "data" && entry.raw_source === currentPath)
          .map(entry => ({
            href: `/?path=${encodeURIComponent(entry.path)}`,
            text: entry.display_name || entry.file || entry.path.split("/").pop(),
            sub: entry.id || entry.path,
          }));
        const html = [
          parts.sample && wsLinkBlock("SAMPLE", [{href: `/samples/?id=${encodeURIComponent(parts.sample)}`, text: samplesIndex[parts.sample] || parts.sample, sub: parts.sample}]),
          parts.exp && wsLinkBlock("EXP", [{href: `/experiments/?id=${encodeURIComponent(parts.exp)}`, text: expsIndex[parts.exp] || parts.exp, sub: parts.exp}]),
          wsLinkBlock("DATA", dataItems),
        ].filter(Boolean).join("");
        workspaceRelatedLinks.innerHTML = html || '<div class="data-info-val">—</div>';
        return;
      }
      // data panel: derive rawdata path from raw_source in workspace list
      const dataEntry = workspaceFiles.find(e => e.path === currentPath);
      const rawSourcePath = dataEntry?.raw_source || "";
      const rawdataId = meta?.rawdata_id || "";
      const sampleId = meta?.sample_id || "";
      const expId = meta?.exp_id || "";
      const html = [
        sampleId && wsLinkBlock("SAMPLE", [{href: `/samples/?id=${encodeURIComponent(sampleId)}`, text: samplesIndex[sampleId] || sampleId, sub: sampleId}]),
        expId && wsLinkBlock("EXP", [{href: `/experiments/?id=${encodeURIComponent(expId)}`, text: expsIndex[expId] || expId, sub: expId}]),
        rawSourcePath && wsLinkBlock("RAWDATA", [{
          href: `/?path=${encodeURIComponent(rawSourcePath)}`,
          text: workspaceFiles.find(e => e.path === rawSourcePath)?.display_name || rawSourcePath.split("/").pop(),
          sub: rawSourcePath.split("/").slice(0, 2).join("/"),
        }]),
        !rawSourcePath && rawdataId && wsLinkBlock("RAWDATA", [{href: `/?path=${encodeURIComponent("rawdata/" + rawdataId)}`, text: rawdataId}]),
      ].filter(Boolean).join("");
      workspaceRelatedLinks.innerHTML = html || '<div class="data-info-val">—</div>';
    }

    async function renderGeneratedDataPanel(path) {
      if (!dataInfoGrid) return;
      dataInfoGrid.innerHTML = "";
      if (workspaceRelatedLinks) workspaceRelatedLinks.innerHTML = "";
      try {
        const meta = await fetchRepoJson(workspaceMetadataPath(path, "data"));
        const rawSourcePath = String(currentWorkspaceItem()?.raw_source || "").trim();
        const rawdataId = String(meta?.rawdata_id || "").trim();
        const rawEntry = workspaceFiles.find(entry =>
          entry.kind === "rawdata" && (
            (rawSourcePath && entry.path === rawSourcePath) ||
            (rawdataId && entry.id === rawdataId)
          )
        ) || null;
        const rows = typeof buildDataInfoRows === "function"
          ? buildDataInfoRows(meta, {
            rawEntry,
            rawSourcePath: rawSourcePath || rawEntry?.path || "",
            samplesIndex,
            sampleMaterialIndex,
            expsStartIndex,
          })
          : Object.entries(meta || {});
        renderInfoGrid(dataInfoGrid, rows.filter(([key]) => shouldRenderInfoKey(key)));
        renderWorkspaceRelatedLinks(meta);
      } catch (_) {
        dataInfoGrid.innerHTML = '<div class="data-info-key muted">—</div><div></div>';
        if (workspaceRelatedLinks) workspaceRelatedLinks.innerHTML = "";
      }
    }

    async function renderDataJsonPanel(path) {
      if (!dataJsonPanel) return;
      await renderRepoJsonPanel(dataJsonPanel, workspaceMetadataPath(path, "data"));
    }

    async function loadTable(path, options = {}) {
      const seq = ++_loadSeq;
      const previousAxes = {
        x: xAxis.value,
        y: yAxis.value,
        y2: yAxis2.value,
        dual: Boolean(dualPlotInput.checked),
      };
      currentPath = path;
      currentKind = options.kind || inferKind(path);
      setWorkspaceHeader(path);
      setBrowserTarget(currentKind, {refresh: false});
      currentDataSummary = null;
      selectedRetainedDataColumns = new Set();
      updateSelectedKindClass();
      setSidePanelTab(currentKind === "rawdata" ? "info" : currentKind === "data" ? "info" : "");
      renderBrowserList();
      setStatus("Loading " + path);
      const payload = await apiJson("/api/table?path=" + encodeURIComponent(path));
      if (_loadSeq !== seq) return;
      columns = payload.columns;
      const axisNames = numericColumnNames();
      optionList(xAxis, axisNames, preferredAxisSelection(axisNames, previousAxes.x, payload.suggested_x));
      optionList(yAxis, axisNames, preferredAxisSelection(axisNames, previousAxes.y, payload.suggested_y));
      optionList(yAxis2, axisNames, preferredSecondaryAxisSelection(axisNames, yAxis.value, previousAxes.y2, payload.suggested_y));
      dualPlotInput.checked = previousAxes.dual && axisNames.includes(yAxis2.value) && yAxis2.value !== yAxis.value;
      updateDualPlotControls();
      buildColumnTable();
      if (currentKind === "rawdata" || currentKind === "data") rawMemoPanel.load(path, currentKind === "data" ? "data" : "direct").catch(() => {});
      else rawMemoPanel.reset("");
      try {
        if (currentKind === "rawdata") {
          renderRawInfoPanel(path);
          renderRawJsonPanel(path);
          renderWorkspaceRelatedLinks();
          await renderSourceDataPanel(path);
        } else if (currentKind === "data") {
          await renderGeneratedDataPanel(path);
          await renderDataJsonPanel(path);
        }
      } catch (err) {
        renderCalculatorStatus(null);
        renderOutputColumnsPreview(null);
        renderParameters({});
        setGenerateDataEnabled(false);
        setStatus(err.message || "data panel failed", true);
      }
      if (_loadSeq !== seq) return;
      viewHistory.length = 0;
      historyIndex = -1;
      if (!axisNames.length) {
        currentPlot = null;
        render();
        updateRangeButtons();
        updatePlayBtnState();
        setStatus("No numeric data rows in this file.", true);
        return;
      }
      await drawPlot();
      if (_loadSeq !== seq) return;
      updatePlayBtnState();
      setStatus("");
    }

    function formatNumber(value, precision = 4) {
      if (value === null || value === undefined || !Number.isFinite(value)) return "";
      const abs = Math.abs(value);
      if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return value.toExponential(precision - 1);
      const str = Number(value).toPrecision(precision);
      if (str.indexOf(".") >= 0 && str.indexOf("e") < 0) return str.replace(/\.?0+$/, "");
      return str;
    }

    function updateAxisHighlight() {
      const xName = xAxis.value;
      const yName = yAxis.value;
      const y2Name = dualPlotEnabled() ? yAxis2.value : "";
      for (const row of columnsBody.querySelectorAll("tr")) {
        const isXAxis = row.dataset.column === xName;
        const isYAxis = row.dataset.column === yName;
        const isY2Axis = row.dataset.column === y2Name;
        row.classList.toggle("axis-x", isXAxis);
        row.classList.toggle("axis-y", isYAxis);
        row.classList.toggle("axis-y2", isY2Axis);
      }
    }

    function buildColumnTable() {
      const existingConditions = new Map(
        Array.from(columnsBody.querySelectorAll("tr")).map(row => [
          row.dataset.column,
          {
            min: row.querySelector('[data-role="min"]')?.value || "",
            max: row.querySelector('[data-role="max"]')?.value || "",
          }
        ])
      );
      columnsBody.innerHTML = "";
      const sourceColumns = new Set(
        currentKind === "rawdata"
          ? (currentDataSummary?.source_columns || columns.map(column => column.name))
          : columns.map(column => column.name)
      );
      const requiredColumns = new Set(currentDataSummary?.required_source_columns || []);

      const sortedColumns = [...columns].sort((a, b) => {
        const aScore = requiredColumns.has(a.name) ? 0
          : (selectedRetainedDataColumns.has(a.name) ? 1 : 2);
        const bScore = requiredColumns.has(b.name) ? 0
          : (selectedRetainedDataColumns.has(b.name) ? 1 : 2);
        return aScore - bScore;
      });

      for (const column of sortedColumns) {
        const row = document.createElement("tr");
        row.dataset.column = column.name;

        const isSourceColumn = sourceColumns.has(column.name);
        const isRequired = requiredColumns.has(column.name);
        const isRetained = selectedRetainedDataColumns.has(column.name);
        const isSelectable = !isRequired && isSourceColumn && currentKind === "rawdata";

        if (isRequired) row.classList.add("required-source");
        else if (isRetained) row.classList.add("retained-source");
        if (isSelectable) {
          row.classList.add("selectable-source");
          row.addEventListener("click", event => {
            if (event.target.tagName === "INPUT") return;
            if (selectedRetainedDataColumns.has(column.name)) {
              selectedRetainedDataColumns.delete(column.name);
            } else {
              selectedRetainedDataColumns.add(column.name);
            }
            buildColumnTable();
          });
        }

        const pinCell = document.createElement("td");
        pinCell.className = "col-pin";
        if (isRequired) {
          pinCell.innerHTML = '<svg class="pin-icon" width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5c0 .276-.224 1.5-.5 1.5s-.5-1.224-.5-1.5V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A5.921 5.921 0 0 1 5 6.708V2.277a2.77 2.77 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354z"/></svg>';
        }
        row.appendChild(pinCell);

        const nameCell = document.createElement("td");
        nameCell.className = "col-name";
        const nameText = document.createElement("span");
        nameText.className = "col-name-text";
        nameText.textContent = column.name;
        nameCell.appendChild(nameText);
        if (column.numeric) {
          nameCell.title = `${formatNumber(column.min)} … ${formatNumber(column.max)}`;
        }
        row.appendChild(nameCell);

        const rangeCell = document.createElement("td");
        rangeCell.className = "col-range";
        const rangeWrap = document.createElement("div");
        rangeWrap.className = "col-range-wrap";
        if (column.numeric) {
          const inputWrap = document.createElement("div");
          inputWrap.className = "col-range-inputs";
          const minInput = document.createElement("input");
          minInput.dataset.role = "min";
          minInput.placeholder = "min";
          minInput.value = existingConditions.get(column.name)?.min || "";
          const sep = document.createElement("span");
          sep.className = "col-range-sep";
          sep.textContent = "–";
          const maxInput = document.createElement("input");
          maxInput.dataset.role = "max";
          maxInput.placeholder = "max";
          maxInput.value = existingConditions.get(column.name)?.max || "";
          inputWrap.appendChild(minInput);
          inputWrap.appendChild(sep);
          inputWrap.appendChild(maxInput);
          rangeWrap.appendChild(inputWrap);
        } else {
          const empty = document.createElement("span");
          empty.className = "column-range-empty";
          empty.textContent = "—";
          rangeWrap.appendChild(empty);
        }
        rangeCell.appendChild(rangeWrap);
        row.appendChild(rangeCell);

        columnsBody.appendChild(row);
      }
      updateAxisHighlight();
      updateRangeButtons();
    }

    function collectConditions() {
      const conditions = [];
      if (!columnsBody) return conditions;
      for (const row of columnsBody.querySelectorAll("tr")) {
        const minInput = row.querySelector('[data-role="min"]');
        const maxInput = row.querySelector('[data-role="max"]');
        conditions.push({
          column: row.dataset.column,
          min: minInput ? minInput.value : "",
          max: maxInput ? maxInput.value : ""
        });
      }
      return conditions;
    }

    function columnRow(columnName) {
      for (const row of columnsBody.querySelectorAll("tr")) {
        if (row.dataset.column === columnName) return row;
      }
      return null;
    }

    function setColumnRange(columnName, minValue, maxValue) {
      const row = columnRow(columnName);
      if (!row) return;
      const minInput = row.querySelector('[data-role="min"]');
      const maxInput = row.querySelector('[data-role="max"]');
      if (minInput) minInput.value = formatNumber(minValue, 8);
      if (maxInput) maxInput.value = formatNumber(maxValue, 8);
    }

    function updateRangeButtons() {
      const enabled = currentKind === "rawdata" && Boolean(currentPlot && currentPlot.view);
      if (!rangeHeadActions) return;
      rangeHeadActions.innerHTML = "";
      const axes = [
        ["x", xAxis.value, "use visible x range"],
        ["y", yAxis.value, "use visible y range"],
      ];
      if (dualPlotEnabled()) axes.push(["y2", yAxis2.value, "use visible y2 range"]);
      for (const [axis, columnName, title] of axes) {
        if (!columnName) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "column-range-btn";
        button.dataset.axis = axis;
        button.textContent = axis;
        button.title = title;
        button.disabled = !enabled
          || (axis === "x" && !xAxis.value)
          || (axis === "y" && !yAxis.value)
          || (axis === "y2" && (!dualPlotEnabled() || !yAxis2.value));
        button.addEventListener("click", () => applyVisibleRange(axis));
        rangeHeadActions.appendChild(button);
      }
    }

    function applyVisibleRange(axis) {
      if (!currentPlot || !currentPlot.view) return;
      if (axis === "x") {
        setColumnRange(xAxis.value, currentPlot.view.xMin, currentPlot.view.xMax);
      } else if (axis === "y2" && dualPlotEnabled()) {
        const panel = currentPlot.view.panels[1];
        if (panel) setColumnRange(yAxis2.value, panel.yMin, panel.yMax);
      } else {
        const panel = currentPlot.view.panels[0];
        if (panel) setColumnRange(yAxis.value, panel.yMin, panel.yMax);
      }
    }

    function selectedYAxes() {
      const axes = [];
      if (yAxis.value) axes.push(yAxis.value);
      if (dualPlotEnabled() && yAxis2.value) axes.push(yAxis2.value);
      return axes;
    }

    async function fetchPoints(yColumn = yAxis.value) {
      const query = new URLSearchParams({path: currentPath, x: xAxis.value, y: yColumn});
      if (previewFiltersEnabled) {
        const conditions = collectConditions().filter(item => item.min || item.max);
        if (conditions.length) query.set("conditions", JSON.stringify(conditions));
      }
      const url = `/api/plot?${query.toString()}`;
      return await apiJson(url);
    }

    function timeColumnName() {
      const candidates = columns
        .filter(column => column.numeric)
        .map(column => column.name);
      // Exact match: standalone "t", "time", "timestamp", "elapsed", etc.
      return candidates.find(name => /^(t|time|timestamp|elapsed|elapsed_time|elapsed_sec)$/i.test(name))
        // Word-boundary match: column starts with or contains "time"/"timestamp"/"elapsed" as a word
        || candidates.find(name => /(^|[_\s(])(time|timestamp|elapsed)([_\s)-]|$)/i.test(name))
        || "";
    }

    function updatePlayBtnState() {
      if (!plotPlayBtn) return;
      const hasTime = Boolean(timeColumnName());
      plotPlayBtn.hidden = !hasTime;
      if (!hasTime && plotAnimator?.isPlaying()) plotAnimator.stop();
    }

    async function fetchTimeOrder() {
      const timeColumn = timeColumnName();
      if (!timeColumn || !xAxis.value || timeColumn === xAxis.value) return null;
      const query = new URLSearchParams({path: currentPath, x: timeColumn, y: xAxis.value});
      if (previewFiltersEnabled) {
        const conditions = collectConditions().filter(item => item.min || item.max);
        if (conditions.length) query.set("conditions", JSON.stringify(conditions));
      }
      const payload = await apiJson(`/api/plot?${query.toString()}`);
      return (payload.points || []).map((point, index) => ({time: point[0], index}))
        .sort((a, b) => a.time - b.time)
        .map(item => item.index);
    }

    function orderedPoints(points, order) {
      if (!order || !order.length || order.length !== points.length) return points;
      return order.map(index => points[index]).filter(Boolean);
    }

    function sortPointsByX(points) {
      return [...(points || [])].sort((a, b) => a[0] - b[0]);
    }

    function paddedRange(minValue, maxValue, ratio, fallback = 1) {
      if (minValue === maxValue) {
        minValue -= fallback;
        maxValue += fallback;
      }
      const pad = (maxValue - minValue) * ratio || fallback;
      return {min: minValue - pad, max: maxValue + pad};
    }

    function buildPlotBounds(panelBounds) {
      const valid = panelBounds.filter(Boolean);
      if (!valid.length) return null;
      let xMin = Infinity, xMax = -Infinity;
      for (const bounds of valid) {
        if (bounds.xMin < xMin) xMin = bounds.xMin;
        if (bounds.xMax > xMax) xMax = bounds.xMax;
      }
      if (xMin === xMax) { xMin -= 1; xMax += 1; }
      return {
        xMin,
        xMax,
        panels: panelBounds.map(bounds => {
          if (!bounds) return null;
          return {yMin: bounds.yMin, yMax: bounds.yMax};
        }),
      };
    }

    function defaultViewFromBounds(bounds) {
      if (!bounds) return null;
      const x = paddedRange(bounds.xMin, bounds.xMax, 0.04);
      const panels = bounds.panels.map(panel => {
        if (!panel) return {yMin: -1, yMax: 1};
        const y = paddedRange(panel.yMin, panel.yMax, 0.06);
        return {yMin: y.min, yMax: y.max};
      });
      const view = {xMin: x.min, xMax: x.max, panels};
      return syncLegacyView(view);
    }

    function syncLegacyView(view) {
      const first = view && view.panels && view.panels[0] ? view.panels[0] : null;
      if (first) {
        view.yMin = first.yMin;
        view.yMax = first.yMax;
      }
      return view;
    }

    function cloneView(view) {
      if (!view) return null;
      const panels = (view.panels || [{yMin: view.yMin, yMax: view.yMax}]).map(panel => ({
        yMin: panel.yMin,
        yMax: panel.yMax,
      }));
      return syncLegacyView({xMin: view.xMin, xMax: view.xMax, panels});
    }

    function panelView(plot, index) {
      const panel = plot.view.panels[index] || plot.view.panels[0] || {yMin: -1, yMax: 1};
      return {
        xMin: plot.view.xMin,
        xMax: plot.view.xMax,
        yMin: panel.yMin,
        yMax: panel.yMax,
      };
    }

    function applyPanelView(plot, index, panelRange) {
      if (!plot.view.panels[index]) plot.view.panels[index] = {yMin: panelRange.yMin, yMax: panelRange.yMax};
      plot.view.panels[index].yMin = panelRange.yMin;
      plot.view.panels[index].yMax = panelRange.yMax;
      syncLegacyView(plot.view);
    }

    async function drawPlot(options = {}) {
      const yNames = selectedYAxes();
      if (!currentPath || !xAxis.value || !yNames.length || xAxis.disabled || yAxis.disabled) {
        currentPlot = null;
        render();
        return;
      }
      const seq = _loadSeq;
      const keep = options.keep || null;
      const prevView = cloneView(currentPlot && currentPlot.view);
      const currentTimeColumn = timeColumnName();
      const [payloads, timeOrder] = await Promise.all([
        Promise.all(yNames.map(name => fetchPoints(name))),
        fetchTimeOrder().catch(() => null),
      ]);
      if (_loadSeq !== seq) return;
      const panels = payloads.map((payload, index) => {
        const panelPoints = currentTimeColumn === xAxis.value
          ? sortPointsByX(payload.points || [])
          : orderedPoints(payload.points || [], timeOrder);
        const series = payload.series || [{
          path: currentPath,
          label: pathStem(currentPath),
          points: panelPoints,
          total_points: payload.total_points,
          shown_points: payload.shown_points
        }];
        const orderedSeries = series.map(item => ({
          ...item,
          points: currentTimeColumn === xAxis.value
            ? sortPointsByX(item.points || [])
            : orderedPoints(item.points || [], timeOrder),
        }));
        return {
          yName: yNames[index],
          points: panelPoints,
          series: orderedSeries,
          totalPoints: payload.total_points,
          shownPoints: payload.shown_points,
          bounds: pointBounds(panelPoints),
        };
      });
      const bounds = buildPlotBounds(panels.map(panel => panel.bounds));
      let view = defaultViewFromBounds(bounds);
      if (view && prevView) {
        if (keep === "x") { view.xMin = prevView.xMin; view.xMax = prevView.xMax; }
        else if (keep === "y") {
          for (const [index, panel] of view.panels.entries()) {
            if (prevView.panels[index]) {
              panel.yMin = prevView.panels[index].yMin;
              panel.yMax = prevView.panels[index].yMax;
            }
          }
          syncLegacyView(view);
        }
      }
      const primary = panels[0] || {points: [], series: [], totalPoints: 0, shownPoints: 0, yName: yAxis.value, bounds: null};
      currentPlot = {
        panels,
        points: panels.flatMap(panel => panel.points),
        series: primary.series,
        totalPoints: panels.reduce((sum, panel) => sum + Number(panel.totalPoints || 0), 0),
        shownPoints: panels.reduce((sum, panel) => sum + Number(panel.shownPoints || 0), 0),
        xName: xAxis.value,
        yName: primary.yName,
        bounds,
        view,
        mode: currentKind,
        timeColumn: currentTimeColumn,
      };
      viewHistory.length = 0;
      historyIndex = -1;
      pushHistory();
      updateAxisHighlight();
      updateRangeButtons();
      if (!plotAnimator || !plotAnimator.isPlaying()) plotAnimationProgress = 1;
      render();
    }

    function pointBounds(points) {
      if (!points.length) return null;
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      for (const p of points) {
        if (p[0] < xMin) xMin = p[0];
        if (p[0] > xMax) xMax = p[0];
        if (p[1] < yMin) yMin = p[1];
        if (p[1] > yMax) yMax = p[1];
      }
      if (xMin === xMax) { xMin -= 1; xMax += 1; }
      if (yMin === yMax) { yMin -= 1; yMax += 1; }
      return {xMin, xMax, yMin, yMax};
    }

    function pushHistory() {
      if (!currentPlot || !currentPlot.view) return;
      viewHistory.splice(historyIndex + 1);
      viewHistory.push(cloneView(currentPlot.view));
      historyIndex = viewHistory.length - 1;
      updateHistoryButtons();
    }

    function updateHistoryButtons() {
      backBtn.disabled = historyIndex <= 0;
      forwardBtn.disabled = historyIndex >= viewHistory.length - 1;
    }

    function applyHistoryView() {
      if (!currentPlot) return;
      currentPlot.view = cloneView(viewHistory[historyIndex]);
      render();
      updateHistoryButtons();
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(200, Math.floor(rect.width));
      const h = Math.max(200, Math.floor(rect.height));
      if (canvas.width !== w * DPR || canvas.height !== h * DPR) {
        canvas.width = w * DPR;
        canvas.height = h * DPR;
      }
      return {w, h};
    }

    function plotAreas(cssW, cssH, count) {
      const panelCount = Math.max(1, count || 1);
      const left = 86;
      const right = 16;
      const top = 16;
      const bottom = 60;
      const gap = panelCount > 1 ? 34 : 0;
      const width = cssW - left - right;
      const height = (cssH - top - bottom - gap * (panelCount - 1)) / panelCount;
      const areas = [];
      for (let index = 0; index < panelCount; index++) {
        areas.push({
          left,
          right,
          top: top + index * (height + gap),
          bottom,
          width,
          height,
          cssW,
          cssH,
          index,
        });
      }
      return areas;
    }

    function panelAtPoint(x, y, areas) {
      for (const area of areas) {
        if (isInsidePlot(x, y, area)) return area;
      }
      return null;
    }

    function dataToCanvas(x, y, view, area) {
      return [
        area.left + (x - view.xMin) / (view.xMax - view.xMin) * area.width,
        area.top + (1 - (y - view.yMin) / (view.yMax - view.yMin)) * area.height
      ];
    }

    function canvasToData(cx, cy, view, area) {
      return [
        view.xMin + (cx - area.left) / area.width * (view.xMax - view.xMin),
        view.yMin + (1 - (cy - area.top) / area.height) * (view.yMax - view.yMin)
      ];
    }

    function eventCanvasPoint(event) {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    }

    function isInsidePlot(x, y, area) {
      return x >= area.left && x <= area.left + area.width &&
             y >= area.top && y <= area.top + area.height;
    }

    // matplotlib-style nice ticks (extended Wilkinson-lite)
    function niceTicks(minVal, maxVal, targetCount = 6) {
      if (minVal === maxVal) return [minVal];
      const range = maxVal - minVal;
      const roughStep = range / Math.max(1, targetCount);
      const exp = Math.floor(Math.log10(roughStep));
      const base = Math.pow(10, exp);
      const frac = roughStep / base;
      let step;
      if (frac < 1.5) step = 1 * base;
      else if (frac < 3) step = 2 * base;
      else if (frac < 7) step = 5 * base;
      else step = 10 * base;
      const first = Math.ceil(minVal / step) * step;
      const ticks = [];
      for (let v = first; v <= maxVal + step * 1e-9; v += step) {
        ticks.push(Number(v.toFixed(12)));
      }
      return ticks;
    }

    function isPlotThemeDark() {
      return plotTheme === "dark";
    }

    function defaultPlotLineColor(theme = plotTheme) {
      return theme === "dark" ? "#f2f2f2" : "#111111";
    }

    function plotLineColor(index, plotMode) {
      if (plotMode === "preview") return cssVar("--line-preview") || "#9a9a9a";
      if (index === 0 && plotAppearance.lineColor) return plotAppearance.lineColor;
      const dark = isPlotThemeDark();
      const palette = dark
        ? ["#f5f5f5", "#bdbdbd", "#8f8f8f", "#666666", "#4d4d4d", "#d9d9d9"]
        : ["#111111", "#5c5c5c", "#8a8a8a", "#2d2d2d", "#b0b0b0", "#d0d0d0"];
      return palette[index % palette.length];
    }

    function setPlotStyle(style) {
      plotAppearance.style = style === "scatter" ? "scatter" : "line";
      if (plotLineModeBtn) plotLineModeBtn.classList.toggle("active", plotAppearance.style === "line");
      if (plotScatterModeBtn) plotScatterModeBtn.classList.toggle("active", plotAppearance.style === "scatter");
      render();
    }

    function syncPlotColors() {
      plotAppearance.lineColor = plotColorInput?.value || "#111111";
    }

    function applyPlotTheme(theme) {
      const previousTheme = plotTheme;
      plotTheme = theme === "dark" ? "dark" : "light";
      document.body.classList.toggle("plot-theme-dark", plotTheme === "dark");
      document.body.classList.toggle("plot-theme-light", plotTheme === "light");
      if (plotThemeToggleBtn) {
        plotThemeToggleBtn.classList.toggle("active", plotTheme === "dark");
        plotThemeToggleBtn.setAttribute("aria-pressed", plotTheme === "dark" ? "true" : "false");
        plotThemeToggleBtn.title = `Graph theme: ${plotTheme === "dark" ? "dark" : "light"}`;
      }
      if (plotThemeToggleLabel) plotThemeToggleLabel.textContent = plotTheme === "dark" ? "Light" : "Dark";
      if (plotColorInput) {
        const previousDefault = defaultPlotLineColor(previousTheme);
        const nextDefault = defaultPlotLineColor(plotTheme);
        if (!plotColorTouched || plotColorInput.value === previousDefault) {
          plotColorInput.value = nextDefault;
          syncPlotColors();
        }
      }
      localStorage.setItem("datparser-plot-theme", plotTheme);
      render();
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function currentExportStem() {
      return pathStem(currentPath || "plot");
    }

    function exportInfoLines() {
      const item = currentWorkspaceItem();
      const parts = pathParts(currentPath, currentKind, item);
      return [
        parts.file || currentPath.split("/").pop(),
        `path: ${currentPath}`,
        parts.material ? `material: ${parts.material}` : "",
        parts.sample ? `sample: ${parts.sample}` : "",
        parts.measurement ? `kind: ${parts.measurement}` : "",
        parts.dependance ? `condition: ${parts.dependance}` : "",
        parts.exp ? `exp: ${parts.exp}` : "",
        currentPlot?.timeColumn ? `time: ${currentPlot.timeColumn}` : "",
        previewFiltersEnabled ? "filters: preview" : "",
      ];
    }

    function exportCanvas(background = null) {
      return plotExportCanvas(canvas, {
        includeInfo: plotInfoExportEnabled,
        infoLines: exportInfoLines(),
        background,
        textColor: plotTheme === "light" ? "#1a1c1e" : "#e8eaed",
      });
    }

    function savePlotAsPng() {
      exportCanvas(null).toBlob(blob => {
        if (!blob) {
          setStatus("PNG export failed.", true);
          return;
        }
        downloadBlob(blob, `${currentExportStem()}.png`);
      }, "image/png");
    }

    function canvasDataUrlWithBackground(type, quality, background) {
      return exportCanvas(background).toDataURL(type, quality);
    }

    function dataUrlToUint8Array(dataUrl) {
      const base64 = dataUrl.split(",")[1] || "";
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return bytes;
    }

    function jpegDimensions(bytes) {
      let offset = 2;
      while (offset + 8 < bytes.length) {
        if (bytes[offset] !== 0xff) break;
        const marker = bytes[offset + 1];
        const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
        if (marker >= 0xc0 && marker <= 0xc3) {
          return {
            height: (bytes[offset + 5] << 8) + bytes[offset + 6],
            width: (bytes[offset + 7] << 8) + bytes[offset + 8],
          };
        }
        offset += 2 + length;
      }
      return {width: canvas.width / DPR, height: canvas.height / DPR};
    }

    function buildSimplePdf(jpegBytes, width, height) {
      const pageWidth = 842;
      const pageHeight = 595;
      const scale = Math.min((pageWidth - 48) / width, (pageHeight - 48) / height);
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      const offsetX = (pageWidth - drawWidth) / 2;
      const offsetY = (pageHeight - drawHeight) / 2;
      const encoder = new TextEncoder();
      const objects = [];
      const addTextObject = text => objects.push(encoder.encode(text));
      addTextObject("<< /Type /Catalog /Pages 2 0 R >>");
      addTextObject("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
      addTextObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
      objects.push([
        encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${Math.round(width)} /Height ${Math.round(height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`),
        jpegBytes,
        encoder.encode("\nendstream"),
      ]);
      const contents = `q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${offsetX.toFixed(2)} ${offsetY.toFixed(2)} cm\n/Im0 Do\nQ`;
      addTextObject(`<< /Length ${contents.length} >>\nstream\n${contents}\nendstream`);
      const parts = [encoder.encode("%PDF-1.4\n")];
      const offsets = [0];
      for (let index = 0; index < objects.length; index++) {
        offsets.push(parts.reduce((sum, chunk) => sum + chunk.length, 0));
        parts.push(encoder.encode(`${index + 1} 0 obj\n`));
        const object = objects[index];
        if (Array.isArray(object)) parts.push(...object);
        else parts.push(object);
        parts.push(encoder.encode("\nendobj\n"));
      }
      const xrefOffset = parts.reduce((sum, chunk) => sum + chunk.length, 0);
      parts.push(encoder.encode(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
      for (let index = 1; index < offsets.length; index++) {
        parts.push(encoder.encode(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`));
      }
      parts.push(encoder.encode(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
      return new Blob(parts, {type: "application/pdf"});
    }

    function savePlotAsPdf() {
      const dataUrl = canvasDataUrlWithBackground("image/jpeg", 0.95, plotTheme === "light" ? "#ffffff" : null);
      const jpegBytes = dataUrlToUint8Array(dataUrl);
      const dimensions = jpegDimensions(jpegBytes);
      downloadBlob(buildSimplePdf(jpegBytes, dimensions.width, dimensions.height), `${currentExportStem()}.pdf`);
    }

    function render() {
      const {w, h} = resizeCanvas();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const plotBg = cssVar("--plot-bg");
      if (plotBg && plotBg !== "transparent") {
        ctx.fillStyle = plotBg;
        ctx.fillRect(0, 0, w, h);
      }

      const plot = currentPlot;
      if (!plot) return;
      const panels = plot.panels && plot.panels.length
        ? plot.panels
        : [{
          yName: plot.yName,
          points: plot.points || [],
          series: plot.series || [],
          totalPoints: plot.totalPoints || 0,
          shownPoints: plot.shownPoints || 0,
        }];
      const areas = plotAreas(w, h, panels.length);

      if (!plot.view || !plot.view.panels || !plot.points || !plot.points.length) {
        ctx.fillStyle = cssVar("--plot-muted") || "#888";
        ctx.font = `${Math.max(12, plotAppearance.labelFontSize)}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("No numeric data points found.", w / 2, h / 2);
        return;
      }

      for (const [panelIndex, panel] of panels.entries()) {
        const area = areas[panelIndex];
        const view = panelView(plot, panelIndex);
        const isBottomPanel = panelIndex === panels.length - 1;
        const xTicks = niceTicks(view.xMin, view.xMax, 8);
        const yTicks = niceTicks(view.yMin, view.yMax, panels.length > 1 ? 4 : 6);

        // grid
        ctx.strokeStyle = cssVar("--grid") || "#f0f0f0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const t of xTicks) {
          const [cx] = dataToCanvas(t, 0, view, area);
          if (cx < area.left - 0.5 || cx > area.left + area.width + 0.5) continue;
          ctx.moveTo(Math.round(cx) + 0.5, area.top);
          ctx.lineTo(Math.round(cx) + 0.5, area.top + area.height);
        }
        for (const t of yTicks) {
          const [, cy] = dataToCanvas(0, t, view, area);
          if (cy < area.top - 0.5 || cy > area.top + area.height + 0.5) continue;
          ctx.moveTo(area.left, Math.round(cy) + 0.5);
          ctx.lineTo(area.left + area.width, Math.round(cy) + 0.5);
        }
        ctx.stroke();

        // data lines (clipped to plot area)
        ctx.save();
        ctx.beginPath();
        ctx.rect(area.left, area.top, area.width, area.height);
        ctx.clip();
        ctx.lineWidth = plotAppearance.lineWidth;
        ctx.lineJoin = "round";
        const series = panel.series && panel.series.length ? panel.series : [{points: panel.points, label: ""}];
        for (const [seriesIndex, item] of series.entries()) {
          const color = plotLineColor(seriesIndex, plot.mode);
          const drawCount = Math.max(1, Math.ceil((item.points || []).length * plotAnimationProgress));
          const drawPoints = (item.points || []).slice(0, drawCount);
          if (plotAppearance.style === "scatter") {
            ctx.fillStyle = color;
            const radius = Math.max(1.8, plotAppearance.lineWidth * 1.7);
            for (const p of drawPoints) {
              const [cx, cy] = dataToCanvas(p[0], p[1], view, area);
              ctx.beginPath();
              ctx.arc(cx, cy, radius, 0, Math.PI * 2);
              ctx.fill();
            }
          } else {
            ctx.strokeStyle = color;
            ctx.beginPath();
            let started = false;
            for (const p of drawPoints) {
              const [cx, cy] = dataToCanvas(p[0], p[1], view, area);
              if (!started) { ctx.moveTo(cx, cy); started = true; }
              else ctx.lineTo(cx, cy);
            }
            ctx.stroke();
          }
        }
        ctx.restore();

        // frame
        ctx.strokeStyle = cssVar("--axis") || "#5f6368";
        ctx.lineWidth = 1;
        ctx.strokeRect(area.left + 0.5, area.top + 0.5, area.width, area.height);

        // tick marks + labels
        ctx.fillStyle = cssVar("--plot-text") || cssVar("--text") || "#3c4043";
        ctx.strokeStyle = cssVar("--axis") || "#5f6368";
        ctx.font = `500 ${plotAppearance.tickFontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.beginPath();
        for (const t of xTicks) {
          const [cx] = dataToCanvas(t, 0, view, area);
          if (cx < area.left - 0.5 || cx > area.left + area.width + 0.5) continue;
          ctx.moveTo(Math.round(cx) + 0.5, area.top + area.height);
          ctx.lineTo(Math.round(cx) + 0.5, area.top + area.height + 4);
          if (isBottomPanel) ctx.fillText(formatNumber(t, 5), cx, area.top + area.height + 6);
        }
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (const t of yTicks) {
          const [, cy] = dataToCanvas(0, t, view, area);
          if (cy < area.top - 0.5 || cy > area.top + area.height + 0.5) continue;
          ctx.moveTo(area.left, Math.round(cy) + 0.5);
          ctx.lineTo(area.left - 4, Math.round(cy) + 0.5);
          ctx.fillText(formatNumber(t, 5), area.left - 6, cy);
        }
        ctx.stroke();

        // axis labels
        ctx.fillStyle = cssVar("--plot-text") || cssVar("--text") || "#1a1c1e";
        ctx.font = `bold ${plotAppearance.labelFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        if (isBottomPanel) ctx.fillText(plot.xName, area.left + area.width / 2, area.top + area.height + Math.max(30, plotAppearance.tickFontSize + 26));
        ctx.save();
        ctx.translate(18, area.top + area.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(panel.yName, 0, 0);
        ctx.restore();

      }

      // interaction overlay: zoom rectangle
      if (drag && drag.kind === "zoom" && drag.current && drag.area) {
        const area = drag.area;
        const x1 = Math.min(drag.start[0], drag.current[0]);
        const x2 = Math.max(drag.start[0], drag.current[0]);
        const y1 = Math.min(drag.start[1], drag.current[1]);
        const y2 = Math.max(drag.start[1], drag.current[1]);
        ctx.save();
        ctx.beginPath();
        ctx.rect(area.left, area.top, area.width, area.height);
        ctx.clip();
        ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
        ctx.strokeStyle = cssVar("--selected-edge") || "#f2f2f2";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1, y2 - y1);
        ctx.restore();
      }
    }

    function setMode(newMode) {
      mode = newMode;
      panBtn.classList.toggle("active", mode === "pan");
      zoomBtn.classList.toggle("active", mode === "zoom");
      canvas.classList.toggle("mode-pan", mode === "pan");
      canvas.classList.toggle("mode-zoom", mode === "zoom");
    }

    function goHome() {
      if (!currentPlot || !currentPlot.bounds) return;
      currentPlot.view = defaultViewFromBounds(currentPlot.bounds);
      pushHistory();
      updateRangeButtons();
      render();
    }

    async function generateData() {
      if (!currentPath || currentKind !== "rawdata") return;
      const payload = await apiJson("/api/data-create", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          path: currentPath,
          calculator: calculatorSelect.value,
          calculator_options: collectCalculatorOptions(),
          display_name: dataOutputName.value.trim(),
          overwrite: true,
          retained_source_columns: selectedRetainedColumnsList(),
          conditions: collectConditions(),
        })
      });
      const csv = payload.csv_path || (payload.data_id ? `data/${payload.data_id}/${payload.data_id}.csv` : "");
      const generatedLabel = payload.display_name
        ? `${payload.display_name}${payload.data_id ? ` (${payload.data_id})` : ""}`
        : (payload.data_id || csv || payload.name || "");
      setStatus(`Generated ${generatedLabel}`);
      const continuous = document.getElementById("continuousModeInput")?.checked;
      if (csv && !continuous) await loadWorkspaceFiles(csv);
    }

    // --- canvas interactions ---
    canvas.addEventListener("mousemove", event => {
      const [cx, cy] = eventCanvasPoint(event);
      const rect = canvas.getBoundingClientRect();
      const areas = plotAreas(rect.width, rect.height, currentPlot?.panels?.length || 1);
      const hoverArea = panelAtPoint(cx, cy, areas);
      if (!drag) return;
      if (drag.kind === "pan") {
        const area = drag.area;
        const start = drag.viewStart;
        const panelStart = start.panels[drag.panelIndex] || start.panels[0];
        const xRange = start.xMax - start.xMin;
        const yRange = panelStart.yMax - panelStart.yMin;
        const dxCss = cx - drag.start[0];
        const dyCss = cy - drag.start[1];
        currentPlot.view = cloneView(start);
        currentPlot.view.xMin = start.xMin - dxCss / area.width * xRange;
        currentPlot.view.xMax = start.xMax - dxCss / area.width * xRange;
        applyPanelView(currentPlot, drag.panelIndex, {
          yMin: panelStart.yMin + dyCss / area.height * yRange,
          yMax: panelStart.yMax + dyCss / area.height * yRange,
        });
        render();
      } else if (drag.kind === "zoom") {
        drag.current = [cx, cy];
        render();
      }
    });

    canvas.addEventListener("mousedown", event => {
      if (event.button !== 0) return;
      if (!currentPlot || !currentPlot.view) return;
      const [cx, cy] = eventCanvasPoint(event);
      const rect = canvas.getBoundingClientRect();
      const areas = plotAreas(rect.width, rect.height, currentPlot.panels?.length || 1);
      const area = panelAtPoint(cx, cy, areas);
      if (!area) return;
      event.preventDefault();
      if (mode === "pan") {
        drag = {kind: "pan", start: [cx, cy], area, panelIndex: area.index, viewStart: cloneView(currentPlot.view)};
        canvas.classList.add("active");
      } else {
        drag = {kind: "zoom", start: [cx, cy], current: [cx, cy], area, panelIndex: area.index};
      }
    });

    window.addEventListener("mouseup", event => {
      if (!drag) return;
      if (drag.kind === "zoom" && drag.current && currentPlot) {
        const area = drag.area;
        const x1 = Math.min(drag.start[0], drag.current[0]);
        const x2 = Math.max(drag.start[0], drag.current[0]);
        const y1 = Math.min(drag.start[1], drag.current[1]);
        const y2 = Math.max(drag.start[1], drag.current[1]);
        if (x2 - x1 > 4 && y2 - y1 > 4) {
          const view = panelView(currentPlot, drag.panelIndex);
          const [dxMin, dyMax] = canvasToData(x1, y1, view, area);
          const [dxMax, dyMin] = canvasToData(x2, y2, view, area);
          currentPlot.view.xMin = dxMin;
          currentPlot.view.xMax = dxMax;
          applyPanelView(currentPlot, drag.panelIndex, {yMin: dyMin, yMax: dyMax});
          pushHistory();
        }
      } else if (drag.kind === "pan") {
        pushHistory();
      }
      drag = null;
      canvas.classList.remove("active");
      render();
    });

    canvas.addEventListener("dblclick", () => {
      goHome();
    });

    canvas.addEventListener("wheel", event => {
      if (!currentPlot || !currentPlot.view) return;
      const [cx, cy] = eventCanvasPoint(event);
      const rect = canvas.getBoundingClientRect();
      const areas = plotAreas(rect.width, rect.height, currentPlot.panels?.length || 1);
      const area = panelAtPoint(cx, cy, areas);
      if (!area) return;
      event.preventDefault();
      const view = panelView(currentPlot, area.index);
      const [dataX, dataY] = canvasToData(cx, cy, view, area);
      const factor = event.deltaY < 0 ? 0.82 : 1.22;
      currentPlot.view.xMin = dataX - (dataX - view.xMin) * factor;
      currentPlot.view.xMax = dataX + (view.xMax - dataX) * factor;
      applyPanelView(currentPlot, area.index, {
        yMin: dataY - (dataY - view.yMin) * factor,
        yMax: dataY + (view.yMax - dataY) * factor,
      });
      render();
      // debounce history push on wheel
      clearTimeout(canvas._wheelTimer);
      canvas._wheelTimer = setTimeout(pushHistory, 250);
    }, {passive: false});

    // --- toolbar ---
    panBtn.addEventListener("click", () => setMode("pan"));
    zoomBtn.addEventListener("click", () => setMode("zoom"));
    homeBtn.addEventListener("click", goHome);
    backBtn.addEventListener("click", () => {
      if (historyIndex <= 0) return;
      historyIndex--;
      applyHistoryView();
    });
    forwardBtn.addEventListener("click", () => {
      if (historyIndex >= viewHistory.length - 1) return;
      historyIndex++;
      applyHistoryView();
    });
    for (const button of sideTabButtons) {
      button.addEventListener("click", () => setSidePanelTab(button.dataset.panelTab));
    }
    browserTargetToggle?.addEventListener("click", () => setBrowserTarget(browserTarget === "rawdata" ? "data" : "rawdata"));
    if (browserSearch) {
      browserSearch.addEventListener("input", () => updateBrowserFiles({selectFirstIfCurrentHidden: false}));
    }
    for (const element of [measurementFilterSelect, timeFilterSelect]) {
      element?.addEventListener("change", () => updateBrowserFiles({selectFirstIfCurrentHidden: true}));
    }
    if (sampleFilterSelect) sampleFilterSelect.addEventListener("change", () => updateBrowserFiles({selectFirstIfCurrentHidden: true}));
    if (expFilterSelect) expFilterSelect.addEventListener("change", () => updateBrowserFiles({selectFirstIfCurrentHidden: true}));
    if (browserAdvancedBtn && browserAdvancedFilters) {
      browserAdvancedBtn.addEventListener("click", () => {
        const open = browserAdvancedFilters.classList.toggle("is-open");
        browserAdvancedBtn.classList.toggle("active", open);
        browserAdvancedBtn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
    generateDataBtn.addEventListener("click",
      () => generateData().catch(err => setStatus(err.message, true)));
    if (plotLineModeBtn) plotLineModeBtn.addEventListener("click", () => setPlotStyle("line"));
    if (plotScatterModeBtn) plotScatterModeBtn.addEventListener("click", () => setPlotStyle("scatter"));
    if (plotPlayBtn) {
      plotAnimator = createPlotAnimator({
        onState: playing => {
          plotPlayBtn.classList.toggle("active", playing);
          plotPlayBtn.title = playing ? "Stop animation" : "Animate by timestamp";
        },
        onProgress: progress => {
          plotAnimationProgress = progress;
          render();
        },
      });
      plotPlayBtn.addEventListener("click", () => {
        if (!currentPlot) return;
        plotAnimator.toggle(Math.max(900, Math.min(5000, Number(currentPlot.shownPoints || currentPlot.points?.length || 100) * 18)));
      });
    }
    if (plotInfoExportBtn) {
      plotInfoExportBtn.addEventListener("click", () => {
        plotInfoExportEnabled = !plotInfoExportEnabled;
        plotInfoExportBtn.classList.toggle("active", plotInfoExportEnabled);
        plotInfoExportBtn.setAttribute("aria-pressed", plotInfoExportEnabled ? "true" : "false");
      });
    }
    if (previewFilterBtn) {
      previewFilterBtn.addEventListener("click", () => {
        previewFiltersEnabled = !previewFiltersEnabled;
        previewFilterBtn.classList.toggle("active", previewFiltersEnabled);
        plotAnimationProgress = 1;
        drawPlot({keep: "x"}).catch(err => setStatus(err.message, true));
      });
    }
    if (plotColorsBtn) {
      plotColorsBtn.addEventListener("click", event => {
        event.preventDefault();
        plotColorInput?.click();
      });
    }
    if (plotThemeToggleBtn) {
      plotThemeToggleBtn.addEventListener("click", () => {
        applyPlotTheme(isPlotThemeDark() ? "light" : "dark");
      });
    }
    if (parameterToggle) {
      parameterToggle.addEventListener("click", () => {
        const expanded = parameterToggle.getAttribute("aria-expanded") === "true";
        parameterToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
        parameterBlock?.classList.toggle("is-collapsed", expanded);
      });
    }
    sidePanelSelect?.addEventListener("change", () => setSidePanelTab(sidePanelSelect.value));
    dataInfoPanelSelect?.addEventListener("change", () => setSidePanelTab(dataInfoPanelSelect.value));
    calculatorSelect.addEventListener("change", () => {
      if (currentKind === "rawdata") {
        renderSourceDataPanel(currentPath, dataOutputName.value.trim()).catch(err => setStatus(err.message, true));
      }
    });
    dataOutputName.addEventListener("change", () => {
      if (currentKind === "rawdata") {
        renderSourceDataPanel(currentPath, dataOutputName.value.trim()).catch(err => setStatus(err.message, true));
      }
    });
    dualPlotInput.addEventListener("change", () => {
      updateDualPlotControls();
      buildColumnTable();
      drawPlot({keep: "x"}).catch(err => setStatus(err.message, true));
    });
    yAxis2.addEventListener("change",
      () => {
        buildColumnTable();
        drawPlot({keep: "x"}).catch(err => setStatus(err.message, true));
      });
    xAxis.addEventListener("change", () => {
      buildColumnTable();
      drawPlot({keep: "y"}).catch(err => setStatus(err.message, true));
    });
    yAxis.addEventListener("change", () => {
      updateDualPlotControls();
      buildColumnTable();
      drawPlot({keep: "x"}).catch(err => setStatus(err.message, true));
    });
    columnsBody.addEventListener("change", event => {
      const role = event.target && event.target.dataset ? event.target.dataset.role : null;
      if (previewFiltersEnabled && (role === "min" || role === "max")) {
        drawPlot({keep: "x"}).catch(err => setStatus(err.message, true));
      }
    });
    [plotColorInput].filter(Boolean).forEach(element => {
      element.addEventListener("input", () => {
        plotColorTouched = true;
        syncPlotColors();
        render();
      });
      element.addEventListener("change", () => {
        plotColorTouched = true;
        syncPlotColors();
        render();
      });
    });
    if (savePlotPngBtn) savePlotPngBtn.addEventListener("click", savePlotAsPng);
    if (savePlotPdfBtn) savePlotPdfBtn.addEventListener("click", savePlotAsPdf);
    window.addEventListener("resize", () => render());
    window.addEventListener("keydown", event => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) return;
      if (event.key === "p") setMode("pan");
      else if (event.key === "z") setMode("zoom");
      else if (event.key === "h" || event.key === "Home") goHome();
    });

    setMode("zoom");
    setSidePanelTab("make");
    setBrowserTarget(browserTarget, {refresh: false, selectFirstIfCurrentHidden: false});
    updateDualPlotControls();
    initPaneResize({
      root: workspaceMain,
      container: workspaceMain,
      storagePrefix: "datparser",
      left: {min: 220, max: 560, reserve: 420},
      right: {min: 260, max: 620, reserve: 420},
    });
    syncPlotColors();
    setPlotStyle(plotAppearance.style);
    applyPlotTheme(localStorage.getItem("datparser-plot-theme") || localStorage.getItem("datparser-plot-bg") || "light");
    loadWorkspaceFiles(new URLSearchParams(window.location.search).get("path") || "").catch(err => setStatus(err.message, true));
