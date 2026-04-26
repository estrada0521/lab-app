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

    const PLOT_MARGIN = { left: 86, right: 16, top: 16, bottom: 60 };

    function resizeCanvas() {
      let w, h;
      if (plotSquareAspect) {
        canvas.style.width = "";
        canvas.style.height = "";
        const figRect = canvas.parentElement.getBoundingClientRect();
        const wFig = Math.floor(figRect.width);
        const hFig = Math.floor(figRect.height);
        const side = Math.max(100, Math.min(
          wFig - PLOT_MARGIN.left - PLOT_MARGIN.right,
          hFig - PLOT_MARGIN.top - PLOT_MARGIN.bottom
        ));
        w = side + PLOT_MARGIN.left + PLOT_MARGIN.right;
        h = side + PLOT_MARGIN.top + PLOT_MARGIN.bottom;
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
      } else {
        canvas.style.width = "";
        canvas.style.height = "";
        const rect = canvas.getBoundingClientRect();
        w = Math.max(200, Math.floor(rect.width));
        h = Math.max(200, Math.floor(rect.height));
      }
      if (canvas.width !== w * DPR || canvas.height !== h * DPR) {
        canvas.width = w * DPR;
        canvas.height = h * DPR;
      }
      return {w, h};
    }

    function plotAreas(cssW, cssH, count) {
      const panelCount = Math.max(1, count || 1);
      const { left, right, top, bottom } = PLOT_MARGIN;
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
        plotThemeToggleBtn.title = plotTheme === "dark" ? "Switch to light theme" : "Switch to dark theme";
        plotThemeToggleBtn.querySelector(".plot-theme-icon-dark")?.style.setProperty("display", plotTheme === "dark" ? "block" : "none");
        plotThemeToggleBtn.querySelector(".plot-theme-icon-light")?.style.setProperty("display", plotTheme === "light" ? "block" : "none");
      }
      if (plotColorInput) {
        const previousDefault = defaultPlotLineColor(previousTheme);
        const nextDefault = defaultPlotLineColor(plotTheme);
        if (!plotColorTouched || plotColorInput.value === previousDefault) {
          plotColorInput.value = nextDefault;
          syncPlotColors();
        }
      }
      localStorage.setItem("lab-plot-theme", plotTheme);
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
      const grid = currentKind === "data" ? dataInfoGrid : rawInfoGrid;
      if (!grid) return [];
      const lines = [];
      const children = Array.from(grid.children);
      let i = 0;
      while (i < children.length) {
        const el = children[i];
        if (el.classList.contains("info-group") || el.classList.contains("info-calc-group")) {
          const key = el.querySelector(".data-info-key")?.textContent?.trim() || "";
          const val = el.querySelector(".data-info-val")?.textContent?.trim() || "";
          if (key && val && val !== "—") lines.push(`${key}: ${val}`);
          i++;
        } else if (el.classList.contains("data-info-key")) {
          const key = el.textContent?.trim() || "";
          const next = children[i + 1];
          const val = next?.classList.contains("data-info-val") ? next.textContent?.trim() : "";
          if (key && val && val !== "—") lines.push(`${key}: ${val}`);
          i += 2;
        } else {
          i++;
        }
      }
      return lines;
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

        // grid (dashed)
        if (plotGridVisible) {
          ctx.strokeStyle = cssVar("--line") || "#3e3e3e";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
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
          ctx.setLineDash([]);
        }

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
        ctx.fillStyle = "rgba(128, 128, 128, 0.12)";
        ctx.strokeStyle = cssVar("--axis") || "#888";
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
