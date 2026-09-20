// ============================================================================
// timeline-core.js — низкоуровневые функции таймлайна (без UI-обработчиков)
// ============================================================================

import * as THREE from 'three';
import { state, dom } from './state.js';

// ---------------------------------------------------------------------------
// Время ↔ пиксели
// ---------------------------------------------------------------------------
export function timeToPercent(time) {
  if (!state.currentClip || state.currentClip.duration === 0) return 0;
  return (time / state.currentClip.duration) * 100;
}

export function xToTime(clientX) {
  const rect = dom.track.getBoundingClientRect();
  const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
  return (x / rect.width) * state.currentClip.duration;
}

// ---------------------------------------------------------------------------
// Playhead
// ---------------------------------------------------------------------------
export function updatePlayhead(time) {
  if (!state.currentClip) return;
  time = Math.max(0, Math.min(time, state.currentClip.duration));
  if (state.currentAction) state.currentAction.time = time;
  if (state.mixer) state.mixer.update(0);
  dom.timeCurrent.textContent = `${time.toFixed(2)}s`;
  dom.playhead.style.left = `${timeToPercent(time)}%`;
}

export function updatePlayheadUI() {
  if (!state.currentAction || !state.currentClip) return;
  const time = state.currentAction.time % state.currentClip.duration;
  dom.timeCurrent.textContent = `${time.toFixed(2)}s`;
  dom.playhead.style.left = `${timeToPercent(time)}%`;

  // Авто-скролл при воспроизведении с зумом
  if (state.isPlaying && state.zoom > 1.05) {
    const px = (timeToPercent(time) / 100) * dom.track.clientWidth;
    const sl = dom.timelineScroll.scrollLeft;
    const sr = sl + dom.timelineScroll.clientWidth;
    if (px < sl + 30 || px > sr - 30) {
      dom.timelineScroll.scrollLeft = px - dom.timelineScroll.clientWidth / 2;
    }
  }
}

// ---------------------------------------------------------------------------
// Область выделения
// ---------------------------------------------------------------------------
export function updateSelectionUI() {
  if (!state.currentClip) return;
  const duration = state.currentClip.duration;
  let s = parseFloat(dom.segStart.value) || 0;
  let e2 = parseFloat(dom.segEnd.value) || duration;

  s = Math.max(0, Math.min(s, duration));
  e2 = Math.max(s + 0.001, Math.min(e2, duration));

  const sPct = (s / duration) * 100;
  const ePct = (e2 / duration) * 100;

  dom.handleStart.style.left = `${sPct}%`;
  dom.handleEnd.style.left = `${ePct}%`;
  dom.selectionEl.style.left = `${sPct}%`;
  dom.selectionEl.style.width = `${ePct - sPct}%`;
  dom.selDuration.textContent = `${(e2 - s).toFixed(2)}s`;
}

// ---------------------------------------------------------------------------
// Зум
// ---------------------------------------------------------------------------
export function applyZoom(newZoom) {
  state.zoom = Math.max(1, Math.min(20, newZoom));
  dom.zoomRange.value = state.zoom;
  dom.track.style.width = `${state.zoom * 100}%`;
  dom.zoomValue.textContent = `${state.zoom.toFixed(1)}x`;
  redrawRuler();
  updateSelectionUI();
  if (state.currentAction && state.currentClip) {
    dom.playhead.style.left = `${timeToPercent(state.currentAction.time)}%`;
  }
}

// ---------------------------------------------------------------------------
// Линейка
// ---------------------------------------------------------------------------
export function redrawRuler() {
  if (!state.currentClip) return;
  dom.rulerEl.innerHTML = '';

  const duration = state.currentClip.duration;
  const trackWidthPx = dom.track.clientWidth || dom.timelineScroll.clientWidth * state.zoom;
  const targetTicks = Math.max(4, Math.floor(trackWidthPx / 70));
  const step = niceStep(duration / targetTicks);

  for (let t = 0; t <= duration + 1e-6; t += step) {
    const pct = (t / duration) * 100;
    const tick = document.createElement('div');
    tick.className = 'tick major';
    tick.style.left = `${pct}%`;
    dom.rulerEl.appendChild(tick);

    const label = document.createElement('div');
    label.className = 'tick-label';
    label.style.left = `${pct}%`;
    label.textContent = formatTime(t);
    dom.rulerEl.appendChild(label);
  }

  const endTick = document.createElement('div');
  endTick.className = 'tick major';
  endTick.style.left = '100%';
  dom.rulerEl.appendChild(endTick);
}

function niceStep(raw) {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  let nice;
  if (norm < 1.5) nice = 1;
  else if (norm < 3) nice = 2;
  else if (norm < 7) nice = 5;
  else nice = 10;
  return nice * pow;
}

function formatTime(t) {
  if (t < 10) return t.toFixed(2) + 's';
  if (t < 100) return t.toFixed(1) + 's';
  return t.toFixed(0) + 's';
}

// ---------------------------------------------------------------------------
// Выбор анимации (сброс состояния таймлайна)
// ---------------------------------------------------------------------------
export function selectAnimation(index) {
  if (!state.animations[index]) {
    dom.statusEl.textContent = 'Анимация не найдена';
    return;
  }

  state.currentClip = state.animations[index];
  if (state.currentAction) state.currentAction.stop();

  state.currentAction = state.mixer.clipAction(state.currentClip);
  state.currentAction.setLoop(THREE.LoopOnce, 1);
  state.currentAction.clampWhenFinished = true;
  state.currentAction.play();
  state.currentAction.paused = true;
  state.currentAction.timeScale = parseFloat(dom.speedRange.value);
  state.isPlaying = false;
  dom.playBtn.textContent = '▶';

  const duration = state.currentClip.duration;
  dom.timeDuration.textContent = `${duration.toFixed(2)}s`;
  dom.segStart.value = '0';
  dom.segEnd.value = duration.toFixed(3);

  // Сброс сегментов
  state.segments = [];
  dom.segmentsList.innerHTML = '<div class="empty-hint">Нет добавленных фрагментов</div>';
  dom.segmentsLayer.innerHTML = '';
  dom.segmentsCount.textContent = '0';

  // Сброс зума
  state.zoom = 1;
  dom.zoomRange.value = 1;
  applyZoom(1);

  updateSelectionUI();
  updatePlayhead(0);
}

// ---------------------------------------------------------------------------
// Рендер списка анимаций
// ---------------------------------------------------------------------------
export function renderAnimations() {
  dom.animationsEl.innerHTML = '';

  state.animations.forEach((clip, idx) => {
    const item = document.createElement('div');
    item.className = 'anim-item';
    item.innerHTML = `
      <input type="radio" name="anim" id="anim_${idx}" value="${idx}" ${idx === 0 ? 'checked' : ''} />
      <label for="anim_${idx}">${escapeHtmlLocal(clip.name)}</label>
      <span class="index">#${idx}</span>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') document.getElementById(`anim_${idx}`).checked = true;
      selectAnimation(idx);
      document.querySelectorAll('.anim-item').forEach((el) => el.classList.remove('active'));
      item.classList.add('active');
    });
    dom.animationsEl.appendChild(item);
  });

  selectAnimation(0);
  document.querySelector('.anim-item')?.classList.add('active');
}

// Локальная копия escapeHtml, чтобы не тянуть utils.js (во избежание цикла)
function escapeHtmlLocal(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
