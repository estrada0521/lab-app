function plotExportCanvas(sourceCanvas, options = {}) {
  const infoLines = (options.infoLines || []).filter(Boolean);
  const background = options.background || null;
  const includeInfo = Boolean(options.includeInfo && infoLines.length);
  const infoWidth = includeInfo ? Math.max(180, options.infoWidth || 240) : 0;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = sourceCanvas.width + infoWidth;
  exportCanvas.height = sourceCanvas.height;
  const ctx = exportCanvas.getContext("2d");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  }
  if (includeInfo) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = options.textColor || "#e8eaed";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textBaseline = "top";
    let y = 16;
    const x = 14;
    const maxWidth = infoWidth / dpr - 24;
    for (const line of infoLines) {
      const text = String(line);
      ctx.fillText(text.length > 80 ? `${text.slice(0, 77)}...` : text, x, y, maxWidth);
      y += 18;
      if (y > sourceCanvas.height / dpr - 20) break;
    }
    ctx.restore();
  }
  ctx.drawImage(sourceCanvas, infoWidth, 0);
  return exportCanvas;
}
