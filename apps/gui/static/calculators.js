const calculatorList = document.getElementById("calculatorList");
const calculatorTitle = document.getElementById("calculatorTitle");
const calculatorSubtitle = document.getElementById("calculatorSubtitle");
const calculatorReadme = document.getElementById("calculatorReadme");
const calculatorInfo = document.getElementById("calculatorInfo");
const calculatorLinks = document.getElementById("calculatorLinks");
const calculatorInfoPanel = document.getElementById("calculatorInfoPanel");
const calculatorJsonPanel = document.getElementById("calculatorJsonPanel");
const calculatorLinksPanel = document.getElementById("calculatorLinksPanel");
const calculatorSidePanelSelect = document.getElementById("calculatorSidePanelSelect");
const calculatorJson = document.getElementById("calculatorJson");
const statusEl = document.getElementById("status");

let calculators = [];
let selectedCalculatorId = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message, isError = false) {
  statusEl.textContent = message || "";
  statusEl.classList.toggle("error", Boolean(isError));
}

async function apiJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function renderKeyGrid(container, rows) {
  renderStructuredInfoGrid(container, rows, {
    keyClass: "catalog-key",
    valueClass: "catalog-value",
  });
}

function renderLinkList(container, items) {
  if (!container) return;
  const links = items.filter(item => item.href && item.label);
  container.innerHTML = links.length
    ? links.map(item =>
      `<a class="catalog-record-link" href="${escapeHtml(item.href)}">`
      + `<span class="catalog-record-link-label">${escapeHtml(item.label)}</span>`
      + (item.sub ? `<span class="catalog-record-link-sub">${escapeHtml(item.sub)}</span>` : "")
      + `</a>`
    ).join("")
    : '<div class="catalog-path muted">—</div>';
}

function repoFileLink(path) {
  return path ? `/api/repo-file?path=${encodeURIComponent(path)}` : "";
}

function setSidePanel(panelName) {
  if (calculatorInfoPanel) calculatorInfoPanel.hidden = panelName !== "info";
  if (calculatorJsonPanel) calculatorJsonPanel.hidden = panelName !== "json";
  if (calculatorLinksPanel) calculatorLinksPanel.hidden = panelName !== "links";
  if (calculatorSidePanelSelect) calculatorSidePanelSelect.value = panelName;
}

function selectCalculator(id) {
  selectedCalculatorId = id;
  for (const button of calculatorList.querySelectorAll(".catalog-list-item")) {
    button.classList.toggle("current", button.dataset.id === id);
  }
  const calculator = calculators.find(item => item.id === id) || calculators[0] || null;
  if (!calculator) {
    calculatorTitle.textContent = "";
    calculatorSubtitle.textContent = "";
    calculatorReadme.innerHTML = "";
    renderKeyGrid(calculatorInfo, []);
    renderLinkList(calculatorLinks, []);
    return;
  }
  calculatorTitle.textContent = calculator.display_name || calculator.id;
  calculatorSubtitle.textContent = calculator.id || "";
  calculatorReadme.innerHTML = renderMarkdown(calculator.readme || "");
  renderMathInScope(calculatorReadme);
  renderKeyGrid(calculatorInfo, [
    ["id", calculator.id || "—"],
    ["display_name", calculator.display_name || "—"],
    ["description", calculator.description || "—"],
    ["required columns detail", calculator.required_columns_detail || []],
    ["required parameters", calculator.required_parameters || []],
    ["data metadata policy", calculator.data_metadata_policy || {}],
    ["transform", calculator.transform_type || "—"],
    ["output columns", calculator.output_columns || []],
  ]);
  renderRepoJsonPanel(calculatorJson, calculator.manifest_path);
  renderLinkList(calculatorLinks, [
    {href: repoFileLink(calculator.readme_path), label: "README", sub: calculator.readme_path},
    {href: repoFileLink(calculator.manifest_path), label: "Manifest", sub: calculator.manifest_path},
    {href: repoFileLink(calculator.handler_path), label: "Handler", sub: calculator.handler_path},
  ]);
}

function renderList(items) {
  calculatorList.innerHTML = "";
  for (const calculator of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "catalog-list-item";
    button.dataset.id = calculator.id;
    button.innerHTML = `
      <div class="catalog-list-name" title="Click again to rename">${escapeHtml(calculator.display_name || calculator.id)}</div>
      <div class="catalog-list-meta">${escapeHtml(calculator.id)}</div>
    `;
    button.addEventListener("click", () => {
      if (button.classList.contains("current")) {
        const nameEl = button.querySelector(".catalog-list-name");
        if (nameEl && !nameEl.querySelector("input")) {
          startRename(button, calculator, nameEl);
          return;
        }
      }
      selectCalculator(calculator.id);
    });
    button.addEventListener("contextmenu", event => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, [{
        label: "Delete",
        danger: true,
        action: async () => {
          if (!confirm(`Delete calculator "${calculator.id}"?\nThis cannot be undone.`)) return;
          try {
            await postJson("/api/delete-entity", {kind: "calc", id: calculator.id});
            const payload = await apiJson("/api/calculators");
            calculators = payload.calculators || [];
            renderList(calculators);
            selectCalculator(calculators[0]?.id || "");
          } catch (err) {
            setStatus(err.message || "Delete failed", true);
          }
        },
      }]);
    });
    calculatorList.appendChild(button);
  }
}

function startRename(btn, calculator, nameEl) {
  const oldId = calculator.id;
  const oldName = calculator.display_name || oldId;
  const input = document.createElement("input");
  input.type = "text";
  input.value = oldName;
  input.className = "rename-input";
  input.addEventListener("click", e => e.stopPropagation());
  nameEl.textContent = "";
  nameEl.appendChild(input);
  input.focus();
  input.select();

  async function commit() {
    const newName = input.value.trim();
    if (!newName || newName === oldName) { renderList(calculators); selectCalculator(oldId); return; }
    try {
      await postJson("/api/rename", {kind: "calc", old_id: oldId, new_name: newName});
      const idx = calculators.findIndex(c => c.id === oldId);
      if (idx >= 0) calculators[idx] = {...calculators[idx], display_name: newName};
      renderList(calculators);
      selectCalculator(oldId);
    } catch (err) {
      setStatus(err.message, true);
      renderList(calculators);
      selectCalculator(oldId);
    }
  }

  bindExplicitRenameInput(input, {
    onCommit: commit,
    onCancel: () => {
      renderList(calculators);
      selectCalculator(oldId);
    },
  });
}

async function loadCalculators() {
  setStatus("Loading calculators…");
  const payload = await apiJson("/api/calculators");
  calculators = payload.calculators || [];
  renderList(calculators);
  selectCalculator(calculators[0]?.id || "");
  setStatus("");
}

calculatorSidePanelSelect?.addEventListener("change", () => setSidePanel(calculatorSidePanelSelect.value));

setSidePanel("info");
initPaneResize({
  root: document.querySelector(".catalog-main"),
  container: document.querySelector(".catalog-main"),
  leftSplitterId: "catalogLeftSplitter",
  rightSplitterId: "catalogRightSplitter",
  storagePrefix: "datparser-calculators",
  left: {min: 220, max: 520, reserve: 460},
  right: {min: 260, max: 560, reserve: 440},
});
loadCalculators().catch(err => setStatus(err.message, true));
