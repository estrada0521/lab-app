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
    for (const element of [measurementFilterSelect, timeFilterSelect, sampleFilterSelect]) {
      element?.addEventListener("change", () => updateBrowserFiles({selectFirstIfCurrentHidden: true}));
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
    if (plotGridToggleBtn) {
      plotGridToggleBtn.addEventListener("click", () => {
        plotGridVisible = !plotGridVisible;
        plotGridToggleBtn.classList.toggle("active", plotGridVisible);
        plotGridToggleBtn.setAttribute("aria-pressed", plotGridVisible ? "true" : "false");
        render();
      });
    }
    if (plotSquareToggleBtn) {
      plotSquareToggleBtn.addEventListener("click", () => {
        plotSquareAspect = !plotSquareAspect;
        plotSquareToggleBtn.classList.toggle("active", plotSquareAspect);
        plotSquareToggleBtn.setAttribute("aria-pressed", plotSquareAspect ? "true" : "false");
        if (!plotSquareAspect) {
          canvas.style.width = "";
          canvas.style.height = "";
        }
        render();
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
    setSidePanelTab("info");
    setBrowserTarget(browserTarget, {refresh: false, selectFirstIfCurrentHidden: false});
    updateDualPlotControls();
    initPaneResize({
      root: viewerMain,
      container: viewerMain,
      storagePrefix: "lab",
      left: {min: 140, max: 560, reserve: 420},
      right: {min: 160, max: 620, reserve: 420},
    });
    syncPlotColors();
    setPlotStyle(plotAppearance.style);
    applyPlotTheme(localStorage.getItem("lab-plot-theme") || localStorage.getItem("lab-plot-bg") || "light");
    loadWorkspaceFiles(new URLSearchParams(window.location.search).get("path") || "").catch(err => setStatus(err.message, true));
    initDropUpload({
      getTarget: () => {
        if (!currentPath || (currentKind !== "rawdata" && currentKind !== "data")) return null;
        const recordId = currentPath.split("/")[1] || "";
        return recordId ? {kind: currentKind, id: recordId} : null;
      },
      onUploaded: (target) => {
        loadAndRenderAttachments(document.getElementById("attachmentsSection"), target.kind, target.id);
      },
    });
