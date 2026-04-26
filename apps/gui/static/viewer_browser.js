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
      const item = viewerFiles.find(entry => entry.path === path);
      const fallback = path ? pathStem(path) : "";
      if (viewerTitle) viewerTitle.textContent = item?.display_name || fallback;
      if (viewerMeta) viewerMeta.textContent = "";
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
      localStorage.setItem("lab-browser-target", browserTarget);
      browserTargetToggle?.classList.toggle("is-data", browserTarget === "data");
      if (options.refresh !== false) {
        updateBrowserFiles({selectFirstIfCurrentHidden: options.selectFirstIfCurrentHidden !== false});
      }
    }

    const BROWSER_LIST_SCROLL_PAD = 4;
    /**
     * Scroll only `#browserTree`. Rebuilds reset `scrollTop` to 0; we restore a saved value first, then
     * if the current row is still not visible, nudge by aligning its top to the list (never by minimal
     * "show bottom" scroll, which pins the row to the bottom of the list).
     */
    function scrollBrowserCurrentRowIntoList() {
      if (!browserTree) return;
      const current = browserTree.querySelector(".browser-file.current");
      if (!current) return;
      const list = browserTree;
      const pad = BROWSER_LIST_SCROLL_PAD;
      const cr = current.getBoundingClientRect();
      const lr = list.getBoundingClientRect();
      if (cr.top >= lr.top + pad && cr.bottom <= lr.bottom - pad) return;
      list.scrollTop += cr.top - lr.top - pad;
    }

    function renderBrowserList() {
      if (!browserTree) return;
      const savedListScroll = browserTree.scrollTop;
      const files = browserFilteredFiles().slice().sort(browserSort);
      browserTree.innerHTML = "";
      if (!files.length) {
        const empty = document.createElement("div");
        empty.className = "tree-empty";
        empty.textContent = viewerFiles.length ? "No files match the current filters." : "No files discovered.";
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
          <span class="copy-path-btn" role="button" title="Copy absolute path" tabindex="-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </span>
        `;
        row.addEventListener("click", (e) => {
          if (isLabCopyPathHit(row, e.clientX, e.clientY)) {
            e.stopPropagation();
            const absPath = dbRoot ? dbRoot.replace(/\/$/, "") + "/" + item.path.replace(/^\//, "") : item.path;
            copyTextToClipboard(absPath).then(() => flashLabCopyPathBtn(row, 1000)).catch(err => setStatus(err.message || "Copy failed", true));
            return;
          }
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
      {
        const maxT = Math.max(0, browserTree.scrollHeight - browserTree.clientHeight);
        browserTree.scrollTop = Math.min(Math.max(0, savedListScroll), maxT);
      }
      scrollBrowserCurrentRowIntoList();
    }

    /** Update selection highlight only (no list rebuild). Falls back to full render if DOM is empty or has no row for `currentPath`. */
    function updateBrowserListSelectionOnly() {
      if (!browserTree) return;
      const rows = browserTree.querySelectorAll(".browser-file");
      if (!rows.length) {
        renderBrowserList();
        return;
      }
      let matched = false;
      for (const row of rows) {
        const isCurrent = row.dataset.path === currentPath;
        if (isCurrent) matched = true;
        row.classList.toggle("current", isCurrent);
      }
      if (currentPath && !matched) {
        renderBrowserList();
      }
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
      return viewerFiles.filter(item => {
        const parts = pathParts(item.path, item.kind, item);
        return item.kind === browserTarget
          && (!measurement || parts.measurement === measurement)
          && (!dependance || conditionToken(parts) === dependance)
          && (!sample || parts.sample === sample);
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
      const measurements = Array.from(new Set(viewerFiles.map(item => pathParts(item.path, item.kind, item).measurement).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
      const dependances = Array.from(new Set(viewerFiles.map(item => conditionToken(pathParts(item.path, item.kind, item))).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
      const samples = Array.from(new Set(viewerFiles.map(item => pathParts(item.path, item.kind, item).sample).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
      const exps = Array.from(new Set(viewerFiles.map(item => pathParts(item.path, item.kind, item).exp).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
      setSelectOptions(measurementFilterSelect, [["", "all kinds"], ...measurements.map(value => [value, value])]);
      setSelectOptions(timeFilterSelect, [["", "all conditions"], ...dependances.map(value => [value, value])]);
      if (sampleFilterSelect) setSelectOptions(sampleFilterSelect, [["", "all samples"], ...samples.map(id => [id, samplesIndex[id] || id])]);
    }

    function updateBrowserFiles(options = {}) {
      const files = browserFilteredFiles();
      renderBrowserList();
      if (options.selectFirstIfCurrentHidden && files.length && !files.some(item => item.path === currentPath)) {
        loadTable(files[0].path, {kind: files[0].kind}).catch(err => setStatus(err.message, true));
      }
    }

    async function loadWorkspaceFiles(preferredPath = currentPath) {
      const [rawPayload, dataPayload, calculatorsPayload, configPayload] = await Promise.all([
        apiJson("/api/raw-files"),
        apiJson("/api/data-files"),
        apiJson("/api/calculators"),
        apiJson("/api/config"),
      ]);
      dbRoot = configPayload.db_root || "";
      rawFiles = rawPayload.files || [];
      generatedDataFiles = dataPayload.files || [];
      allCalculators = calculatorsPayload.calculators || [];
      samplesIndex = rawPayload.samples_index || dataPayload.samples_index || {};
      sampleMaterialIndex = rawPayload.sample_material_index || dataPayload.sample_material_index || {};
      expsIndex = rawPayload.exps_index || dataPayload.exps_index || {};
      expsStartIndex = rawPayload.exps_start_index || dataPayload.exps_start_index || {};
      const rawEntries = rawPayload.entries || rawFiles.map(path => ({path, file: path.split("/").pop() || ""}));
      const dataEntries = dataPayload.entries || generatedDataFiles.map(path => ({path, file: path.split("/").pop() || ""}));
      viewerFiles = [
        ...rawEntries.map(item => ({kind: "rawdata", ...item})),
        ...dataEntries.map(item => ({kind: "data", ...item})),
      ];
      const previousTargetedFiles = viewerFiles.filter(item => item.kind === browserTarget);
      const preferred = viewerFiles.find(item => item.path === preferredPath)
        || viewerFiles.find(item => item.path === currentPath)
        || viewerFiles.find(item => item.kind === browserTarget)
        || previousTargetedFiles[0]
        || viewerFiles[0];
      if (preferred) {
        setBrowserTarget(preferred.kind, {refresh: false});
      }
      refreshBrowserFilters();
      updateBrowserFiles();
      const targetedFiles = viewerFiles.filter(item => item.kind === browserTarget);
      const resolvedPreferred = viewerFiles.find(item => item.path === preferredPath)
        || viewerFiles.find(item => item.path === currentPath)
        || targetedFiles[0]
        || viewerFiles[0];
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
