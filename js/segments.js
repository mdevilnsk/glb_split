// ============================================================================
// segments.js — список фрагментов, добавление, импорт/экспорт пресетов
// ============================================================================

import { state, dom } from './state.js';
import { updateSelectionUI } from './timeline-core.js';
import { escapeHtml, sanitize, uniqueName, downloadBlob, setStatus } from './utils.js';

export function setupSegments() {
  dom.addSegmentBtn.addEventListener('click', addSegment);
  dom.exportSegmentsBtn.addEventListener('click', exportPreset);
  dom.importSegmentsBtn.addEventListener('click', () => {
    if (!state.currentClip) return setStatus('error', 'Сначала загрузите модель и выберите анимацию');
    dom.importSegmentsInput.click();
  });
  dom.importSegmentsInput.addEventListener('change', importPreset);
  dom.clearSegmentsBtn.addEventListener('click', clearAllSegments);
}

// ---------------------------------------------------------------------------
// Добавление
// ---------------------------------------------------------------------------
function addSegment() {
  if (!state.currentClip) return;

  const start = parseFloat(dom.segStart.value);
  const end = parseFloat(dom.segEnd.value);
  const name = dom.segName.value.trim() || `Segment_${state.segments.length + 1}`;

  if (isNaN(start) || isNaN(end) || start >= end) return setStatus('error', 'Некорректные Start/End');
  if (start < 0 || end > state.currentClip.duration) {
    return setStatus('error', `Диапазон 0 - ${state.currentClip.duration.toFixed(2)}s`);
  }

  state.segments.push({ id: Date.now(), name, start, end });
  renderSegments();
  dom.segName.value = '';
  setStatus('success', `Фрагмент "${name}" добавлен`);
}

// ---------------------------------------------------------------------------
// Рендер
// ---------------------------------------------------------------------------
export function renderSegments() {
  dom.segmentsList.innerHTML = '';
  dom.segmentsLayer.innerHTML = '';
  dom.segmentsCount.textContent = state.segments.length;

  if (state.segments.length === 0) {
    dom.segmentsList.innerHTML = '<div class="empty-hint">Нет добавленных фрагментов</div>';
    return;
  }

  const duration = state.currentClip ? state.currentClip.duration : 1;

  state.segments.forEach((seg) => {
    // Блок на таймлайне
    const block = document.createElement('div');
    block.className = 'segment-block';
    block.style.left = `${(seg.start / duration) * 100}%`;
    block.style.width = `${((seg.end - seg.start) / duration) * 100}%`;
    const label = document.createElement('div');
    label.className = 'segment-block-label';
    label.textContent = seg.name;
    block.appendChild(label);
    dom.segmentsLayer.appendChild(block);

    // Строка списка
    const item = document.createElement('div');
    item.className = 'segment-item' + (seg._imported ? ' imported' : '');
    item.innerHTML = `
      <span class="name" title="${escapeHtml(seg.name)}">${escapeHtml(seg.name)}</span>
      <span class="time">${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s</span>
      <button class="delete" title="Удалить">✕</button>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete')) return;
      dom.segStart.value = seg.start.toFixed(3);
      dom.segEnd.value = seg.end.toFixed(3);
      dom.segName.value = seg.name;
      updateSelectionUI();
    });
    item.querySelector('.delete').addEventListener('click', (e) => {
      e.stopPropagation();
      state.segments = state.segments.filter((s) => s.id !== seg.id);
      renderSegments();
    });
    dom.segmentsList.appendChild(item);
  });
}

// ---------------------------------------------------------------------------
// Экспорт пресета
// ---------------------------------------------------------------------------
function exportPreset() {
  if (state.segments.length === 0) return setStatus('error', 'Нет фрагментов для экспорта');
  if (!state.currentClip) return setStatus('error', 'Сначала загрузите модель');

  const preset = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: state.currentFileName || 'unknown',
    animationName: state.currentClip.name || '',
    animationDuration: +state.currentClip.duration.toFixed(4),
    segments: state.segments.map((s) => ({
      name: s.name,
      start: +s.start.toFixed(4),
      end: +s.end.toFixed(4),
      duration: +(s.end - s.start).toFixed(4),
    })),
  };

  const json = JSON.stringify(preset, null, 2);
  const baseName = (state.currentFileName || 'segments').replace(/\.(glb|gltf)$/i, '');
  const animSuffix = (state.currentClip.name || 'anim').replace(/[\\/:*?"<>|]/g, '_');
  const filename = `${baseName}_${animSuffix}_segments.json`;

  downloadBlob(new Blob([json], { type: 'application/json' }), filename);
  setStatus('success', `Экспортировано ${state.segments.length} фрагментов в JSON`);
}

// ---------------------------------------------------------------------------
// Импорт пресета
// ---------------------------------------------------------------------------
async function importPreset(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const preset = JSON.parse(text);

    if (!preset || !Array.isArray(preset.segments)) {
      throw new Error('Некорректный формат JSON: отсутствует массив "segments"');
    }
    if (preset.segments.length === 0) throw new Error('В файле нет фрагментов');

    const clipDuration = state.currentClip.duration;
    const warnings = [];
    const imported = [];
    const existingIds = new Set(state.segments.map((s) => s.id));
    let nextId = Date.now();

    preset.segments.forEach((seg, idx) => {
      const rawName = (seg.name || `Segment_${idx + 1}`).toString().trim() || `Segment_${idx + 1}`;
      let start = Number(seg.start);
      let end = Number(seg.end);

      if (!isFinite(start) || !isFinite(end)) {
        warnings.push(`#${idx + 1} "${rawName}": некорректные start/end, пропущен`);
        return;
      }
      if (start >= end) {
        warnings.push(`#${idx + 1} "${rawName}": start >= end, пропущен`);
        return;
      }
      if (start < 0) start = 0;
      if (end > clipDuration) {
        warnings.push(`#${idx + 1} "${rawName}": end обрезан до ${clipDuration.toFixed(2)}s`);
        end = clipDuration;
      }
      if (start >= clipDuration) {
        warnings.push(`#${idx + 1} "${rawName}": start вне диапазона, пропущен`);
        return;
      }
      if (end - start < 0.001) {
        warnings.push(`#${idx + 1} "${rawName}": слишком короткий, пропущен`);
        return;
      }

      let finalName = rawName;
      let suffix = 2;
      while (
        state.segments.some((s) => s.name === finalName) ||
        imported.some((s) => s.name === finalName)
      ) {
        finalName = `${rawName}_${suffix++}`;
      }

      while (existingIds.has(nextId)) nextId++;
      existingIds.add(nextId);

      imported.push({
        id: nextId++,
        name: finalName,
        start: +start.toFixed(4),
        end: +end.toFixed(4),
        _imported: true,
      });
    });

    if (imported.length === 0) {
      throw new Error('Не удалось импортировать ни одного фрагмента:\n' + warnings.join('\n'));
    }

    const replaceMode = state.segments.length === 0
      ? true
      : confirm(
          `Найдено ${imported.length} фрагментов.\n\n` +
          `OK — ЗАМЕНИТЬ существующие (${state.segments.length})\n` +
          `Отмена — ДОБАВИТЬ к существующим`
        );

    if (replaceMode) state.segments = imported;
    else state.segments = state.segments.concat(imported);

    renderSegments();

    let msg = `Импортировано ${imported.length} фрагментов`;
    if (preset.animationName && preset.animationName !== state.currentClip.name) {
      msg += ` (пресет для "${preset.animationName}", применён к "${state.currentClip.name}")`;
    }
    if (warnings.length > 0) msg += `. Предупреждений: ${warnings.length}`;
    setStatus(warnings.length > 0 ? 'info' : 'success', msg);
  } catch (err) {
    console.error(err);
    setStatus('error', 'Ошибка импорта: ' + err.message);
  } finally {
    dom.importSegmentsInput.value = '';
  }
}

// ---------------------------------------------------------------------------
// Очистка
// ---------------------------------------------------------------------------
function clearAllSegments() {
  if (state.segments.length === 0) return;
  if (!confirm(`Удалить все ${state.segments.length} фрагментов?`)) return;
  state.segments = [];
  renderSegments();
  setStatus('info', 'Все фрагменты удалены');
}