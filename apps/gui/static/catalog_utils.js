/**
 * `.copy-path-btn` は既定で `pointer-events: none` のため、クリックが下の名前領域へ貫通することがある。
 * その場合でもコピーできるよう、行要素と座標からコピーアイコンの矩形内か判定する。
 */
function isLabCopyPathHit(rowEl, clientX, clientY) {
  if (!rowEl || typeof clientX !== "number" || typeof clientY !== "number") return false;
  const icon = rowEl.querySelector(".copy-path-btn");
  if (!icon) return false;
  const r = icon.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

async function copyTextToClipboard(text) {
  const t = String(text ?? "");
  if (!t) return;
  try {
    await navigator.clipboard.writeText(t);
    return;
  } catch {
    /* Clipboard API 不可時のフォールバック */
  }
  const ta = document.createElement("textarea");
  ta.value = t;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("Clipboard unavailable");
}

function flashLabCopyPathBtn(rowEl, ms = 1200) {
  const cb = rowEl?.querySelector?.(".copy-path-btn");
  if (!cb) return;
  cb.classList.add("success");
  setTimeout(() => cb.classList.remove("success"), ms);
}
