// ============================================================================
// timeline.js — UI-обработчики таймлайна (drag, zoom, snap)
// ============================================================================

import { state, dom } from './state.js';
import { stopPlayback } from './playback.js';
import {
  updatePlayhead,
  updateSelectionUI,
  applyZoom,
  redrawRuler,
  xToTime,
} from './timeline-core.js';

const SNAP_THRESHOLD_PX = 10;

export function setupTimeline() {
  setupDragHandlers();
  setupInputHandlers();
  setupZoomHandlers();
  setupRulerResize();
}

// ---------------------------------------------------------------------------
// Перетаскивание ползунков и playhead
// ---------------------------------------------------------------------------
function setupDragHandlers() {
  dom.handleStart.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    state.dragTarget = 'start';
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  });

  dom.handleEnd.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    state.dragTarget = 'end';
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  });

  dom.playhead.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    state.dragTarget = 'playhead';
    state.isScrubbing = true;
    if (state.isPlaying) stopPlayback();
  });

  dom.track.addEventListener('mousedown', (e) => {
    if (state.dragTarget) return;
    if (!state.currentClip) return;
    state.dragTarget = 'playhead';
    state.isScrubbing = true;
    if (state.isPlaying) stopPlayback();
    updatePlayhead(xToTime(e.clientX));
  });

  window.addEventListener('mousemove', handleDragMove);
  window.addEventListener('mouseup', handleDragEnd);
}

function handleDragMove(e) {
  if (!state.dragTarget) return;

  // Авто-скролл у краёв
  const rect = dom.timelineScroll.getBoundingClientRect();
  if (e.clientX > rect.right - 30) dom.timelineScroll.scrollLeft += 12;
  else if (e.clientX < rect.left + 30) dom.timelineScroll.scrollLeft -= 12;

  const rawTime = xToTime(e.clientX);

  if (state.dragTarget === 'start') {
    const maxT = parseFloat(dom.segEnd.value);
    const snap = snapTime(rawTime, getSnapCandidates());
    const snapped = Math.max(0, Math.min(snap.time, maxT - 0.001));
    dom.segStart.value = snapped.toFixed(3);
    updateSelectionUI();
    showSnapLine(snap.snapped, snapped);
  } else if (state.dragTarget === 'end') {
    const minT = parseFloat(dom.segStart.value);
    const snap = snapTime(rawTime, getSnapCandidates());
    const snapped = Math.min(state.currentClip.duration, Math.max(snap.time, minT + 0.001));
    dom.segEnd.value = snapped.toFixed(3);
    updateSelectionUI();
    showSnapLine(snap.snapped, snapped);
  } else if (state.dragTarget === 'playhead') {
    updatePlayhead(rawTime);
    hideSnapLine();
  }
}

function handleDragEnd() {
  if (!state.dragTarget) return;
  state.dragTarget = null;
  state.isScrubbing = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  hideSnapLine();
}

// ---------------------------------------------------------------------------
// Снап
// ---------------------------------------------------------------------------
function getSnapCandidates() {
  const out = [];
  if (!state.currentClip) return out;

  if (state.currentAction) out.push(state.currentAction.time);
  out.push(0);
  out.push(state.currentClip.duration);

  for (const seg of state.segments) {
    out.push(seg.start);
    out.push(seg.end);
  }
  return out;
}

function snapTime(time, candidates) {
  if (!state.currentClip || candidates.length === 0) return { time, snapped: false };

  const pxPerSecond = dom.track.clientWidth / state.currentClip.duration;
  const threshold = SNAP_THRESHOLD_PX / pxPerSecond;

  let bestTime = time;
  let bestDist = threshold;
  let snapped = false;

  for (const c of candidates) {
    const d = Math.abs(c - time);
    if (d < bestDist) { bestDist = d; bestTime = c; snapped = true; }
  }
  return { time: bestTime, snapped };
}

function showSnapLine(visible, time) {
  if (!visible || !state.currentClip) return hideSnapLine();
  dom.snapLine.style.left = `${(time / state.currentClip.duration) * 100}%`;
  dom.snapLine.classList.add('visible');
}

function hideSnapLine() {
  dom.snapLine.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Ручной ввод Start/End
// ---------------------------------------------------------------------------
function setupInputHandlers() {
  dom.segStart.addEventListener('input', () => {
    if (!state.currentClip) return;
    let v = parseFloat(dom.segStart.value);
    if (isNaN(v)) return;
    const maxEnd = parseFloat(dom.segEnd.value) || state.currentClip.duration;
    if (v >= maxEnd) v = maxEnd - 0.001;
    if (v < 0) v = 0;
    updateSelectionUI();
  });

  dom.segEnd.addEventListener('input', () => {
    if (!state.currentClip) return;
    let v = parseFloat(dom.segEnd.value);
    if (isNaN(v)) return;
    const minStart = parseFloat(dom.segStart.value) || 0;
    if (v <= minStart) v = minStart + 0.001;
    if (v > state.currentClip.duration) v = state.currentClip.duration;
    updateSelectionUI();
  });
}

// ---------------------------------------------------------------------------
// Зум и скролл колесом
// ---------------------------------------------------------------------------
function setupZoomHandlers() {
  dom.zoomRange.addEventListener('input', () => applyZoom(parseFloat(dom.zoomRange.value)));
  dom.zoomIn.addEventListener('click', () => applyZoom(state.zoom * 1.5));
  dom.zoomOut.addEventListener('click', () => applyZoom(state.zoom / 1.5));
  dom.zoomFit.addEventListener('click', () => {
    applyZoom(1);
    dom.timelineScroll.scrollLeft = 0;
  });

  dom.timelineScroll.addEventListener('wheel', (e) => {
    const absX = Math.abs(e.deltaX);
    const absY = Math.abs(e.deltaY);

    // Горизонтальный свайп / Shift+колесо → скролл (отдаём браузеру)
    if (e.shiftKey || absX > absY * 1.5) return;

    if (!state.currentClip) return;

    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newZoom = Math.max(1, Math.min(20, state.zoom * factor));
    if (Math.abs(newZoom - state.zoom) < 0.0001) return;

    e.preventDefault();

    const rect = dom.timelineScroll.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + dom.timelineScroll.scrollLeft;
    const timeBefore = (mouseX / dom.track.clientWidth) * state.currentClip.duration;

    applyZoom(newZoom);

    const newMouseX = (timeBefore / state.currentClip.duration) * dom.track.clientWidth;
    dom.timelineScroll.scrollLeft = newMouseX - (e.clientX - rect.left);
  }, { passive: false });
}

// ---------------------------------------------------------------------------
// Перерисовка линейки при ресайзе контейнера
// ---------------------------------------------------------------------------
function setupRulerResize() {
  if (!window.ResizeObserver) return;
  new ResizeObserver(() => {
    if (state.currentClip) redrawRuler();
  }).observe(dom.timelineScroll);
}