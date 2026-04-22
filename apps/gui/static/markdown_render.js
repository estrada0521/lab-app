// Shared markdown + KaTeX rendering module.
// Loaded before page-specific JS. Exports renderMarkdown, renderMathInScope,
// renderMarkdownFallback, mathRenderOptions to window scope.
"use strict";

(function () {
  function _escHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function _renderInline(text) {
    return _escHtml(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  }

  function renderMarkdownFallback(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let paragraph = [];
    let listType = "";
    let inCode = false;
    let codeLines = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      html.push(`<p>${paragraph.map(_renderInline).join("<br>")}</p>`);
      paragraph = [];
    }
    function closeList() {
      if (!listType) return;
      html.push(listType === "ol" ? "</ol>" : "</ul>");
      listType = "";
    }
    function closeCode() {
      if (!inCode) return;
      html.push(`<pre><code>${_escHtml(codeLines.join("\n"))}</code></pre>`);
      inCode = false;
      codeLines = [];
    }

    for (const rawLine of lines) {
      const line = rawLine.replace(/\t/g, "    ");
      const trimmed = line.trim();
      if (inCode) {
        if (trimmed.startsWith("```")) closeCode();
        else codeLines.push(rawLine);
        continue;
      }
      if (trimmed.startsWith("```")) { flushParagraph(); closeList(); inCode = true; codeLines = []; continue; }
      if (!trimmed) { flushParagraph(); closeList(); continue; }
      const hm = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (hm) { flushParagraph(); closeList(); html.push(`<h${hm[1].length}>${_renderInline(hm[2])}</h${hm[1].length}>`); continue; }
      const ulm = trimmed.match(/^[-*]\s+(.*)$/);
      if (ulm) { flushParagraph(); if (listType !== "ul") { closeList(); html.push("<ul>"); listType = "ul"; } html.push(`<li>${_renderInline(ulm[1])}</li>`); continue; }
      const olm = trimmed.match(/^\d+\.\s+(.*)$/);
      if (olm) { flushParagraph(); if (listType !== "ol") { closeList(); html.push("<ol>"); listType = "ol"; } html.push(`<li>${_renderInline(olm[1])}</li>`); continue; }
      closeList();
      paragraph.push(trimmed);
    }
    flushParagraph(); closeList(); closeCode();
    return html.join("");
  }

  const mathRenderOptions = {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
    ],
    ignoredClasses: ["no-math"],
    throwOnError: false,
  };

  function renderMarkdown(markdown) {
    const text = String(markdown || "");
    if (typeof marked !== "undefined") {
      try {
        const mathBlocks = [];
        const codeBlocks = [];
        let mathCount = 0;
        let codeCount = 0;
        // Phase 1: protect code blocks
        let processedText = text.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
          const id = `code-placeholder-${codeCount++}`;
          codeBlocks.push({ id, content: match });
          return `\x00CODE:${id}\x00`;
        });
        // Phase 2: protect shell variables from KaTeX
        processedText = processedText.replace(/(?<!\$)\$([A-Z_][A-Z0-9_]+)/g, '<span class="no-math">&#36;$1</span>');
        processedText = processedText.replace(/\$([{(][^})\n]*[})])/g, '<span class="no-math">&#36;$1</span>');
        // Phase 3: extract math blocks before marked adds <br>
        processedText = processedText.replace(
          /(\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g,
          (match) => {
            const id = `math-placeholder-${mathCount++}`;
            mathBlocks.push({ id, content: match });
            return `<span class="MATH_SAFE_BLOCK" data-id="${id}"></span>`;
          }
        );
        // Phase 4: restore code blocks for marked
        processedText = processedText.replace(/\x00CODE:(code-placeholder-\d+)\x00/g, (_, id) => {
          const block = codeBlocks.find((e) => e.id === id);
          return block ? block.content : "";
        });
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = marked.parse(processedText, { breaks: true, gfm: true });
        // Restore math placeholders
        tempDiv.querySelectorAll(".MATH_SAFE_BLOCK").forEach((span) => {
          const block = mathBlocks.find((e) => e.id === span.dataset.id);
          if (block) span.outerHTML = block.content;
        });
        if (mathBlocks.length) {
          const marker = document.createElement("span");
          marker.className = "math-render-needed";
          marker.hidden = true;
          tempDiv.prepend(marker);
        }
        return tempDiv.innerHTML;
      } catch (_) {
        return renderMarkdownFallback(text);
      }
    }
    return renderMarkdownFallback(text);
  }

  function renderMathInScope(node) {
    if (!node || !node.querySelector(".math-render-needed")) return;
    if (typeof renderMathInElement !== "function") return;
    renderMathInElement(node, mathRenderOptions);
    node.querySelectorAll(".math-render-needed").forEach((m) => m.remove());
  }

  window.renderMarkdown = renderMarkdown;
  window.renderMathInScope = renderMathInScope;
  window.renderMarkdownFallback = renderMarkdownFallback;
  window.mathRenderOptions = mathRenderOptions;
})();
