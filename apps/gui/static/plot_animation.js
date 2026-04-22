function createPlotAnimator(options) {
  let frameId = 0;
  let startedAt = 0;
  let durationMs = 2400;
  let playing = false;

  function stopFrame() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
  }

  function setPlaying(next) {
    playing = Boolean(next);
    options.onState?.(playing);
  }

  function tick(now) {
    if (!playing) return;
    const progress = Math.min(1, (now - startedAt) / durationMs);
    options.onProgress?.(progress);
    if (progress >= 1) {
      setPlaying(false);
      frameId = 0;
      return;
    }
    frameId = requestAnimationFrame(tick);
  }

  function play(duration = durationMs) {
    stopFrame();
    durationMs = Math.max(300, duration);
    startedAt = performance.now();
    setPlaying(true);
    options.onProgress?.(0);
    frameId = requestAnimationFrame(tick);
  }

  function stop() {
    stopFrame();
    setPlaying(false);
    options.onProgress?.(1);
  }

  function toggle(duration) {
    if (playing) stop();
    else play(duration);
  }

  return {play, stop, toggle, isPlaying: () => playing};
}
