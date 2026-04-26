// Plain JavaScript for now; this file is separated so it can be replaced by a TypeScript build later.
    const browserTree = document.getElementById("browserTree");
    const viewerMain = document.getElementById("viewerMain");

    const browserTargetToggle = document.getElementById("browserTargetToggle");
    const measurementFilterSelect = document.getElementById("measurementFilterSelect");
    const timeFilterSelect = document.getElementById("timeFilterSelect");

    const sampleFilterSelect = document.getElementById("sampleFilterSelect");

    const rawMemoInput = document.getElementById("rawMemoInput");
    const rawMemoSaveBtn = document.getElementById("rawMemoSaveBtn");
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
    const viewerRelatedLinks = document.getElementById("viewerRelatedLinks");
    const viewerTitle = document.getElementById("viewerTitle");
    const viewerMeta = document.getElementById("viewerMeta");
    const generateDataBtn = document.getElementById("generateDataBtn");
    const previewFilterBtn = document.getElementById("previewFilterBtn");
    const plotLineModeBtn = document.getElementById("plotLineModeBtn");
    const plotScatterModeBtn = document.getElementById("plotScatterModeBtn");
    const plotPlayBtn = document.getElementById("plotPlayBtn");
    const plotInfoExportBtn = document.getElementById("plotInfoExportBtn");
    const plotColorsBtn = document.getElementById("plotColorsBtn");
    const plotColorInput = document.getElementById("plotColorInput");
    const plotThemeToggleBtn = document.getElementById("plotThemeToggleBtn");
    const plotGridToggleBtn = document.getElementById("plotGridToggleBtn");
    const plotSquareToggleBtn = document.getElementById("plotSquareToggleBtn");
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
    let viewerFiles = [];
    let samplesIndex = {};
    let sampleMaterialIndex = {};
    let expsIndex = {};
    let expsStartIndex = {};
    let rawFiles = [];
    let generatedDataFiles = [];
    let currentDataSummary = null;
    let allCalculators = [];
    let currentCalculatorOptions = {};
    let _lastDataPanelPath = "";
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
    let dbRoot = "";
    let browserTarget = localStorage.getItem("lab-browser-target") || "rawdata";
    let plotColorTouched = false;
    let plotTheme = "light";
    let plotGridVisible = true;
    let plotSquareAspect = true;
    let previewFiltersEnabled = false;
    let plotAnimationProgress = 1;
    let plotInfoExportEnabled = false;
    let plotAnimator = null;
    const plotAppearance = {
      style: "line",
      lineColor: plotColorInput?.value || "#111111",
      lineWidth: 1.4,
      tickFontSize: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--theme-text-size")) || 13,
      labelFontSize: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--theme-text-size")) || 13,
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
      return Boolean(dualPlotInput && dualPlotInput.checked && yAxis2 && yAxis2.value);
    }

    function updateDualPlotControls() {
      const names = numericColumnNames();
      if (dualPlotInput.checked && names.length > 1 && yAxis2.value === yAxis.value) {
        yAxis2.value = secondaryAxisDefault(names, yAxis.value, "");
      }
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
      mode: "direct",
    });
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
      return viewerFiles.find(item => item.path === currentPath && item.kind === currentKind) || null;
    }
