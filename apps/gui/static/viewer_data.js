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
      if (calculatorOptionBlock) calculatorOptionBlock.hidden = uiOptions.length === 0;
      calculatorOptionBlock?.classList.toggle("is-empty", uiOptions.length === 0);
      if (!uiOptions.length) {
        calculatorOptions.innerHTML = "";
        return;
      }
      calculatorOptions.innerHTML = uiOptions.map(option => {
        const id = String(option.id || "").trim();
        const label = String(option.label || id || "option");
        const choices = Array.isArray(option.choices) ? option.choices : [];
        const defaultVal = String(choices[0]?.value || option.default || "").trim();
        const current = String(currentCalculatorOptions[id] || option.default || defaultVal).trim();
        const opts = choices.map(choice => {
          const value = String(choice.value || "").trim();
          const text = String(choice.label || value).trim();
          const selected = value === current ? ' selected' : '';
          return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(text)}</option>`;
        }).join("");
        return `<div class="param-option-full"><div class="param-key">${escapeHtml(label)}</div><select data-option-id="${escapeHtml(id)}">${opts}</select></div>`;
      }).join("");
      for (const el of calculatorOptions.querySelectorAll("[data-option-id]")) {
        el.addEventListener("change", () => {
          currentCalculatorOptions = collectCalculatorOptions();
          if (currentKind === "rawdata") {
            renderSourceDataPanel(currentPath, dataOutputName.value.trim()).catch(err => setStatus(err.message, true));
          }
        });
      }
      // Capture rendered defaults and re-fetch if they differ from what the backend received
      const sentOptions = summary?.selected_calculator_options || {};
      const renderedOptions = collectCalculatorOptions();
      currentCalculatorOptions = renderedOptions;
      const hasNewDefaults = Object.entries(renderedOptions).some(
        ([key, val]) => val && String(sentOptions[key] || "") !== val
      );
      if (hasNewDefaults && currentKind === "rawdata" && currentPath) {
        renderSourceDataPanel(currentPath, dataOutputName.value.trim(), {autoPick: true}).catch(err => setStatus(err.message, true));
      }
    }

    function calculatorIssues(summary) {
      const selected = summary?.selected_calculator || null;
      if (!selected) return [];
      const hasMode = (selected.ui_options || []).some(opt => String(opt.id || "") === "mode");
      const modeSelected = hasMode && Boolean(currentCalculatorOptions["mode"]);
      const missingMeta = (selected.missing_metadata || summary?.missing_metadata || [])
        .filter(item => !(modeSelected && /mode is required/i.test(item)));
      return [
        ...(selected.missing_columns || summary?.missing_columns || []).map(item => `missing column: ${item}`),
        ...missingMeta.map(item => `missing metadata: ${item}`),
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

    /** If `fallback` (suggested from server / default_x|y in metadata) exists in the file, use it; else keep `previous` when still valid. */
    function preferredAxisSelection(names, previous, fallback) {
      if (fallback && names.includes(fallback)) return fallback;
      if (previous && names.includes(previous)) return previous;
      return names[0] || "";
    }

    function preferredSecondaryAxisSelection(names, primary, previous, fallback) {
      if (fallback && fallback !== primary && names.includes(fallback)) return fallback;
      if (previous && previous !== primary && names.includes(previous)) return previous;
      return secondaryAxisDefault(names, primary, "");
    }

    async function renderSourceDataPanel(path, requestedName = "", {autoPick = false} = {}) {
      const isFreshPath = path !== _lastDataPanelPath;
      if (isFreshPath) {
        currentCalculatorOptions = {};
        _lastDataPanelPath = path;
      }
      const query = new URLSearchParams({path});
      const name = requestedName.trim();
      if (name) query.set("display_name", name);
      const calculatorOptionsValue = isFreshPath ? {} : collectCalculatorOptions();
      if (Object.keys(calculatorOptionsValue).length) {
        query.set("calculator_options", JSON.stringify(calculatorOptionsValue));
      }
      // autoPick: let backend re-select the best calculator using current options (no fixed calc)
      const selectedCalculator = (isFreshPath || autoPick) ? "" : calculatorSelect.value;
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
      setCalculatorOptions(allCalculators, summary.selected_calculator?.id || summary.calculator || "");
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

    function viewerMetadataPath(path, kind = currentKind) {
      const parts = (path || "").split("/");
      const recordId = parts[1] || "";
      if (!recordId) return "";
      return `${kind}/${recordId}/metadata.json`;
    }

    async function renderRawInfoPanel(path) {
      if (!rawInfoGrid) return;
      rawInfoGrid.innerHTML = "";
      try {
        const meta = await fetchRepoJson(viewerMetadataPath(path, "rawdata"));
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
      await renderRepoJsonPanel(rawJsonPanel, viewerMetadataPath(path, "rawdata"));
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
      if (!viewerRelatedLinks) return;
      if (currentKind === "rawdata") {
        const item = currentWorkspaceItem();
        const parts = pathParts(currentPath, "rawdata", item);
        const dataItems = viewerFiles
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
        viewerRelatedLinks.innerHTML = html || '<div class="data-info-val">—</div>';
        return;
      }
      // data panel: derive rawdata path from raw_source in workspace list
      const dataEntry = viewerFiles.find(e => e.path === currentPath);
      const rawSourcePath = dataEntry?.raw_source || "";
      const rawdataId = meta?.rawdata_id || "";
      const sampleId = meta?.sample_id || "";
      const expId = meta?.exp_id || "";
      const html = [
        sampleId && wsLinkBlock("SAMPLE", [{href: `/samples/?id=${encodeURIComponent(sampleId)}`, text: samplesIndex[sampleId] || sampleId, sub: sampleId}]),
        expId && wsLinkBlock("EXP", [{href: `/experiments/?id=${encodeURIComponent(expId)}`, text: expsIndex[expId] || expId, sub: expId}]),
        rawSourcePath && wsLinkBlock("RAWDATA", [{
          href: `/?path=${encodeURIComponent(rawSourcePath)}`,
          text: viewerFiles.find(e => e.path === rawSourcePath)?.display_name || rawSourcePath.split("/").pop(),
          sub: rawSourcePath.split("/").slice(0, 2).join("/"),
        }]),
        !rawSourcePath && rawdataId && wsLinkBlock("RAWDATA", [{href: `/?path=${encodeURIComponent("rawdata/" + rawdataId)}`, text: rawdataId}]),
      ].filter(Boolean).join("");
      viewerRelatedLinks.innerHTML = html || '<div class="data-info-val">—</div>';
    }

    async function renderGeneratedDataPanel(path) {
      if (!dataInfoGrid) return;
      dataInfoGrid.innerHTML = "";
      if (viewerRelatedLinks) viewerRelatedLinks.innerHTML = "";
      try {
        const meta = await fetchRepoJson(viewerMetadataPath(path, "data"));
        const rawSourcePath = String(currentWorkspaceItem()?.raw_source || "").trim();
        const rawdataId = String(meta?.rawdata_id || "").trim();
        const rawEntry = viewerFiles.find(entry =>
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
        if (viewerRelatedLinks) viewerRelatedLinks.innerHTML = "";
      }
    }

    async function renderDataJsonPanel(path) {
      if (!dataJsonPanel) return;
      await renderRepoJsonPanel(dataJsonPanel, viewerMetadataPath(path, "data"));
    }

    async function loadTable(path, options = {}) {
      const nextKind = options.kind || inferKind(path);
      if (path === currentPath && nextKind === currentKind) {
        return;
      }
      const previousBrowserTarget = browserTarget;
      const seq = ++_loadSeq;
      const previousAxes = {
        x: xAxis.value,
        y: yAxis.value,
        y2: yAxis2.value,
        dual: Boolean(dualPlotInput.checked),
      };
      currentPath = path;
      currentKind = nextKind;
      setWorkspaceHeader(path);
      setBrowserTarget(currentKind, {refresh: false});
      currentDataSummary = null;
      selectedRetainedDataColumns = new Set();
      updateSelectedKindClass();
      setSidePanelTab(currentKind === "rawdata" ? "info" : currentKind === "data" ? "info" : "");
      if (previousBrowserTarget !== browserTarget) {
        renderBrowserList();
      } else {
        updateBrowserListSelectionOnly();
      }
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
      if (currentKind === "rawdata" || currentKind === "data") {
        const recordId = path.split("/")[1] || "";
        loadAndRenderAttachments(document.getElementById("attachmentsSection"), currentKind, recordId);
      }
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
