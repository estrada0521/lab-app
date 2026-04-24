function initPaneResize(options = {}) {
  const root = options.root || document.documentElement;
  const container = options.container || document.querySelector(options.containerSelector);
  const leftSplitter = options.leftSplitter || document.getElementById(options.leftSplitterId || "leftSplitter");
  const rightSplitter = options.rightSplitter || document.getElementById(options.rightSplitterId || "rightSplitter");
  const storagePrefix = options.storagePrefix || "lab";
  const breakpoint = options.breakpoint || 1100;
  const left = Object.assign({min: 220, max: 560, reserve: 420}, options.left || {});
  const right = Object.assign({min: 260, max: 620, reserve: 420}, options.right || {});

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function applySizes(leftWidth, rightWidth) {
    if (Number.isFinite(leftWidth)) {
      root.style.setProperty("--left-pane-size", `${Math.round(leftWidth)}px`);
      document.body.style.setProperty("--left-pane-size", `${Math.round(leftWidth)}px`);
    }
    if (Number.isFinite(rightWidth)) {
      root.style.setProperty("--right-pane-size", `${Math.round(rightWidth)}px`);
      document.body.style.setProperty("--right-pane-size", `${Math.round(rightWidth)}px`);
    }
  }

  function restore() {
    applySizes(
      Number(localStorage.getItem(`${storagePrefix}-left-pane-width`) || ""),
      Number(localStorage.getItem(`${storagePrefix}-right-pane-width`) || "")
    );
  }

  function start(side, event) {
    if (!container || window.matchMedia(`(max-width: ${breakpoint}px)`).matches) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    document.body.classList.add("is-resizing");
    function update(clientX) {
      if (side === "left") {
        const width = clamp(clientX - rect.left, left.min, Math.min(left.max, rect.width - left.reserve));
        applySizes(width, NaN);
        localStorage.setItem(`${storagePrefix}-left-pane-width`, String(Math.round(width)));
      } else {
        const width = clamp(rect.right - clientX, right.min, Math.min(right.max, rect.width - right.reserve));
        applySizes(NaN, width);
        localStorage.setItem(`${storagePrefix}-right-pane-width`, String(Math.round(width)));
      }
    }
    function handleMove(moveEvent) {
      update(moveEvent.clientX);
    }
    function handleUp() {
      document.body.classList.remove("is-resizing");
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  leftSplitter?.addEventListener("mousedown", event => start("left", event));
  rightSplitter?.addEventListener("mousedown", event => start("right", event));
  restore();

  return {applySizes, restore, start};
}
