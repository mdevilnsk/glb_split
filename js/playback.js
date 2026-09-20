// ============================================================================
// playback.js — воспроизведение, скорость, пробел
// ============================================================================

import { state, dom } from './state.js';
import { updatePlayhead, updatePlayheadUI } from './timeline-core.js';

export function startPlayback() {
  if (!state.currentAction || !state.currentClip) return;

  const start = parseFloat(dom.segStart.value) || 0;
  const end = parseFloat(dom.segEnd.value) || state.currentClip.duration;

  // Если Playhead вне выделенного диапазона — прыгаем в начало
  if (state.currentAction.time < start || state.currentAction.time >= end - 0.001) {
    state.currentAction.time = start;
    state.mixer.update(0);
    updatePlayhead(start);
  }

  state.isPlaying = true;
  state.currentAction.paused = false;
  dom.playBtn.textContent = '⏸';
  state.clockDeltaReset = true;
}

export function stopPlayback() {
  if (!state.currentAction) return;
  state.isPlaying = false;
  state.currentAction.paused = true;
  dom.playBtn.textContent = '▶';
}

export function togglePlayback() {
  if (!state.currentClip) return;
  if (state.isPlaying) stopPlayback();
  else startPlayback();
}

// Вызывается из главного animate-цикла
export function tickPlayback(delta) {
  if (!state.mixer || !state.isPlaying || state.isScrubbing || !state.currentAction || !state.currentClip) {
    return;
  }

  state.mixer.update(delta);

  const end = parseFloat(dom.segEnd.value) || state.currentClip.duration;
  if (state.currentAction.time >= end) {
    state.currentAction.time = end;
    state.mixer.update(0);
    updatePlayhead(end);
    stopPlayback();
  } else {
    updatePlayheadUI();
  }
}

export function setupPlayback() {
  dom.playBtn.addEventListener('click', togglePlayback);

  dom.speedRange.addEventListener('input', () => {
    const speed = parseFloat(dom.speedRange.value);
    dom.speedValue.textContent = `${speed.toFixed(1)}x`;
    if (state.currentAction) state.currentAction.timeScale = speed;
  });

  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.currentClip) togglePlayback();
    }
  });
}