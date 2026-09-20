// ============ IMPORTS ============
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WebIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import JSZip from 'jszip';

// ============ THREE.JS SETUP ============
const viewport = document.getElementById('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);
const camera = new THREE.PerspectiveCamera(45, viewport.clientWidth / viewport.clientHeight, 0.1, 1000);
camera.position.set(0, 1.5, 4);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 1, 0);

scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);
const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight2.position.set(-5, 5, -7);
scene.add(dirLight2);
scene.add(new THREE.GridHelper(10, 20, 0x2d3139, 0x1e2128));

// ============ STATE ============
let currentDocument = null;
let currentFileName = '';
let modelScene = null;
let mixer = null;
let currentAction = null;
let currentClip = null;
let animations = [];
let segments = [];
let isPlaying = false;
let isScrubbing = false;
let dragTarget = null; // 'start' | 'end' | 'playhead' | null
let zoom = 1;
let clock = new THREE.Clock();

// ============ DOM ELEMENTS ============
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const animationsEl = document.getElementById('animations');
const timelineEl = document.getElementById('timeline');
const timelineScroll = document.getElementById('timelineScroll');
const track = document.getElementById('track');
const rulerEl = document.getElementById('ruler');
const segmentsLayer = document.getElementById('segmentsLayer');
const selectionEl = document.getElementById('selection');
const handleStart = document.getElementById('handleStart');
const handleEnd = document.getElementById('handleEnd');
const playhead = document.getElementById('playhead');
const timeCurrent = document.getElementById('timeCurrent');
const timeDuration = document.getElementById('timeDuration');
const selDuration = document.getElementById('selDuration');
const playBtn = document.getElementById('playBtn');
const speedRange = document.getElementById('speedRange');
const speedValue = document.getElementById('speedValue');
const zoomRange = document.getElementById('zoomRange');
const zoomValue = document.getElementById('zoomValue');
const zoomIn = document.getElementById('zoomIn');
const zoomOut = document.getElementById('zoomOut');
const zoomFit = document.getElementById('zoomFit');
const segStart = document.getElementById('segStart');
const segEnd = document.getElementById('segEnd');
const segName = document.getElementById('segName');
const addSegmentBtn = document.getElementById('addSegmentBtn');
const segmentsList = document.getElementById('segmentsList');
const segmentsCount = document.getElementById('segmentsCount');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');
const sidebar = document.getElementById('sidebar');
const resizer = document.getElementById('resizer');

const exportSegmentsBtn = document.getElementById('exportSegmentsBtn');
const importSegmentsBtn = document.getElementById('importSegmentsBtn');
const clearSegmentsBtn = document.getElementById('clearSegmentsBtn');
const importSegmentsInput = document.getElementById('importSegmentsInput');

// ============ RESIZER ============
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizer.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const newWidth = window.innerWidth - e.clientX;
  const clampedWidth = Math.max(340, Math.min(newWidth, Math.min(720, window.innerWidth - 200)));
  sidebar.style.width = clampedWidth + 'px';
  onViewportResize();
});

window.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

function onViewportResize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

window.addEventListener('resize', onViewportResize);
if (window.ResizeObserver) {
  new ResizeObserver(() => onViewportResize()).observe(viewport);
}

// ============ ANIMATION LOOP ============
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  if (mixer && isPlaying && !isScrubbing && currentAction) {
    const delta = clock.getDelta();
    mixer.update(delta);

    const end = parseFloat(segEnd.value) || currentClip.duration;
    if (currentAction.time >= end) {
      currentAction.time = end;
      mixer.update(0);
      updatePlayhead(end);
      stopPlayback();
    } else {
      updatePlayheadUI();
    }
  } else {
    clock.getDelta();
  }

  renderer.render(scene, camera);
}
animate();

// ============ DRAG & DROP ============
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('active');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('active'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('active');
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
});

// ============ LOAD FILE ============
async function loadFile(file) {
  if (!file.name.match(/\.(glb|gltf)$/i)) {
    return setStatus('error', 'Только .glb или .gltf');
  }
  currentFileName = file.name;
  setStatus('info', 'Загружаю...');

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS);
    currentDocument = await io.readBinary(buffer);

    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(buffer.buffer, '');
    if (modelScene) scene.remove(modelScene);
    modelScene = gltf.scene;
    scene.add(modelScene);

    const box = new THREE.Box3().setFromObject(modelScene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(0, size.y, size.z * 2));
    controls.update();

    animations = gltf.animations;
    mixer = new THREE.AnimationMixer(modelScene);
    segments = [];

    if (animations.length === 0) return setStatus('error', 'Нет анимаций.');

    renderAnimations();
    timelineEl.classList.add('visible');
    exportBtn.disabled = false;
    dropzone.style.display = 'none';
    setStatus('success', `Загружено: ${file.name}`);
  } catch (err) {
    console.error(err);
    setStatus('error', 'Ошибка: ' + err.message);
  }
}

// ============ ANIMATIONS LIST ============
function renderAnimations() {
  animationsEl.innerHTML = '';
  animations.forEach((clip, idx) => {
    const item = document.createElement('div');
    item.className = 'anim-item';
    item.innerHTML = `
      <input type="radio" name="anim" id="anim_${idx}" value="${idx}" ${idx === 0 ? 'checked' : ''} />
      <label for="anim_${idx}">${escapeHtml(clip.name)}</label>
      <span class="index">#${idx}</span>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        document.getElementById(`anim_${idx}`).checked = true;
      }
      selectAnimation(idx);
      document.querySelectorAll('.anim-item').forEach((el) => el.classList.remove('active'));
      item.classList.add('active');
    });
    animationsEl.appendChild(item);
  });
  selectAnimation(0);
  document.querySelector('.anim-item').classList.add('active');
}

function selectAnimation(index) {
  currentClip = animations[index];
  if (currentAction) currentAction.stop();
  currentAction = mixer.clipAction(currentClip);
  currentAction.setLoop(THREE.LoopOnce, 1);
  currentAction.clampWhenFinished = true;
  currentAction.play();
  currentAction.paused = true;
  currentAction.timeScale = parseFloat(speedRange.value);
  isPlaying = false;
  playBtn.textContent = '▶';

  const duration = currentClip.duration;
  timeDuration.textContent = `${duration.toFixed(2)}s`;
  segStart.value = '0';
  segEnd.value = duration.toFixed(3);

  segments = [];
  zoom = 1;
  zoomRange.value = 1;
  updateZoomUI();

  renderSegments();
  updateSelectionUI();
  updatePlayhead(0);
  redrawRuler();
}

// ============ PLAYBACK ============
function startPlayback() {
  if (!currentAction || !currentClip) return;
  const start = parseFloat(segStart.value) || 0;
  const end = parseFloat(segEnd.value) || currentClip.duration;

  if (currentAction.time < start || currentAction.time >= end - 0.001) {
    currentAction.time = start;
    mixer.update(0);
    updatePlayhead(start);
  }

  isPlaying = true;
  currentAction.paused = false;
  playBtn.textContent = '⏸';
  clock.getDelta();
}

function stopPlayback() {
  if (!currentAction) return;
  isPlaying = false;
  currentAction.paused = true;
  playBtn.textContent = '▶';
}

function togglePlayback() {
  if (!currentClip) return;
  if (isPlaying) stopPlayback();
  else startPlayback();
}

playBtn.addEventListener('click', togglePlayback);

speedRange.addEventListener('input', () => {
  const speed = parseFloat(speedRange.value);
  speedValue.textContent = `${speed.toFixed(1)}x`;
  if (currentAction) currentAction.timeScale = speed;
});

// Spacebar toggle
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (currentClip) togglePlayback();
  }
});

// ============ TIME HELPERS ============
function timeToPercent(time) {
  if (!currentClip || currentClip.duration === 0) return 0;
  return (time / currentClip.duration) * 100;
}

function xToTime(clientX) {
  const rect = track.getBoundingClientRect();
  const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
  return (x / rect.width) * currentClip.duration;
}

// ============ PLAYHEAD ============
function updatePlayhead(time) {
  if (!currentClip) return;
  time = Math.max(0, Math.min(time, currentClip.duration));
  if (currentAction) currentAction.time = time;
  mixer.update(0);
  timeCurrent.textContent = `${time.toFixed(2)}s`;
  playhead.style.left = `${timeToPercent(time)}%`;
}

function updatePlayheadUI() {
  if (!currentAction || !currentClip) return;
  const time = currentAction.time % currentClip.duration;
  timeCurrent.textContent = `${time.toFixed(2)}s`;
  playhead.style.left = `${timeToPercent(time)}%`;
  if (isPlaying && zoom > 1.05) {
    const px = (timeToPercent(time) / 100) * track.clientWidth;
    const sl = timelineScroll.scrollLeft;
    const sr = sl + timelineScroll.clientWidth;
    if (px < sl + 30 || px > sr - 30) {
      timelineScroll.scrollLeft = px - timelineScroll.clientWidth / 2;
    }
  }
}

// ============ DRAG LOGIC ============
handleStart.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  dragTarget = 'start';
  document.body.style.cursor = 'ew-resize';
  document.body.style.userSelect = 'none';
});

handleEnd.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  dragTarget = 'end';
  document.body.style.cursor = 'ew-resize';
  document.body.style.userSelect = 'none';
});

playhead.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  dragTarget = 'playhead';
  isScrubbing = true;
  if (isPlaying) playBtn.click();
});

track.addEventListener('mousedown', (e) => {
  if (dragTarget) return;
  if (!currentClip) return;
  dragTarget = 'playhead';
  isScrubbing = true;
  if (isPlaying) playBtn.click();
  updatePlayhead(xToTime(e.clientX));
});

window.addEventListener('mousemove', (e) => {
  if (!dragTarget) return;

  const scrollRect = timelineScroll.getBoundingClientRect();
  if (e.clientX > scrollRect.right - 30) timelineScroll.scrollLeft += 12;
  else if (e.clientX < scrollRect.left + 30) timelineScroll.scrollLeft -= 12;

  const t = xToTime(e.clientX);

  if (dragTarget === 'start') {
    const maxT = parseFloat(segEnd.value);
    const newStart = Math.max(0, Math.min(t, maxT - 0.001));
    segStart.value = newStart.toFixed(3);
    updateSelectionUI();
  } else if (dragTarget === 'end') {
    const minT = parseFloat(segStart.value);
    const newEnd = Math.min(currentClip.duration, Math.max(t, minT + 0.001));
    segEnd.value = newEnd.toFixed(3);
    updateSelectionUI();
  } else if (dragTarget === 'playhead') {
    updatePlayhead(t);
  }
});

window.addEventListener('mouseup', () => {
  if (dragTarget) {
    dragTarget = null;
    isScrubbing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// ============ SELECTION UI ============
function updateSelectionUI() {
  if (!currentClip) return;
  const duration = currentClip.duration;
  let s = parseFloat(segStart.value) || 0;
  let e2 = parseFloat(segEnd.value) || duration;

  s = Math.max(0, Math.min(s, duration));
  e2 = Math.max(s + 0.001, Math.min(e2, duration));

  const sPct = (s / duration) * 100;
  const ePct = (e2 / duration) * 100;

  handleStart.style.left = `${sPct}%`;
  handleEnd.style.left = `${ePct}%`;

  selectionEl.style.left = `${sPct}%`;
  selectionEl.style.width = `${ePct - sPct}%`;

  selDuration.textContent = `${(e2 - s).toFixed(2)}s`;
}

segStart.addEventListener('input', () => {
  if (!currentClip) return;
  let v = parseFloat(segStart.value);
  if (isNaN(v)) return;
  const maxEnd = parseFloat(segEnd.value) || currentClip.duration;
  if (v >= maxEnd) v = maxEnd - 0.001;
  if (v < 0) v = 0;
  updateSelectionUI();
});

segEnd.addEventListener('input', () => {
  if (!currentClip) return;
  let v = parseFloat(segEnd.value);
  if (isNaN(v)) return;
  const minStart = parseFloat(segStart.value) || 0;
  if (v <= minStart) v = minStart + 0.001;
  if (v > currentClip.duration) v = currentClip.duration;
  updateSelectionUI();
});

// ============ ZOOM ============
function applyZoom(newZoom) {
  zoom = Math.max(1, Math.min(20, newZoom));
  zoomRange.value = zoom;
  track.style.width = `${zoom * 100}%`;
  updateZoomUI();
  redrawRuler();
  updateSelectionUI();
  if (currentAction && currentClip) {
    playhead.style.left = `${timeToPercent(currentAction.time)}%`;
  }
}

function updateZoomUI() {
  zoomValue.textContent = `${zoom.toFixed(1)}x`;
}

zoomRange.addEventListener('input', () => applyZoom(parseFloat(zoomRange.value)));
zoomIn.addEventListener('click', () => applyZoom(zoom * 1.5));
zoomOut.addEventListener('click', () => applyZoom(zoom / 1.5));
zoomFit.addEventListener('click', () => {
  applyZoom(1);
  timelineScroll.scrollLeft = 0;
});

timelineScroll.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const rect = timelineScroll.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + timelineScroll.scrollLeft;
    const timeBefore = (mouseX / track.clientWidth) * currentClip.duration;
    applyZoom(zoom * factor);
    const newMouseX = (timeBefore / currentClip.duration) * track.clientWidth;
    timelineScroll.scrollLeft = newMouseX - (e.clientX - rect.left);
  },
  { passive: false }
);

// ============ RULER ============
function redrawRuler() {
  if (!currentClip) return;
  rulerEl.innerHTML = '';
  const duration = currentClip.duration;
  const trackWidthPx = track.clientWidth || timelineScroll.clientWidth * zoom;
  const targetTicks = Math.max(4, Math.floor(trackWidthPx / 70));
  const rawStep = duration / targetTicks;
  const step = niceStep(rawStep);

  for (let t = 0; t <= duration + 1e-6; t += step) {
    const pct = (t / duration) * 100;
    const tick = document.createElement('div');
    tick.className = 'tick major';
    tick.style.left = `${pct}%`;
    rulerEl.appendChild(tick);

    const label = document.createElement('div');
    label.className = 'tick-label';
    label.style.left = `${pct}%`;
    label.textContent = formatTime(t);
    rulerEl.appendChild(label);
  }

  const endTick = document.createElement('div');
  endTick.className = 'tick major';
  endTick.style.left = '100%';
  rulerEl.appendChild(endTick);
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

if (window.ResizeObserver) {
  new ResizeObserver(() => {
    if (currentClip) redrawRuler();
  }).observe(timelineScroll);
}

// ============ SEGMENTS ============
addSegmentBtn.addEventListener('click', () => {
  if (!currentClip) return;
  const start = parseFloat(segStart.value);
  const end = parseFloat(segEnd.value);
  const name = segName.value.trim() || `Segment_${segments.length + 1}`;

  if (isNaN(start) || isNaN(end) || start >= end) {
    return setStatus('error', 'Некорректные Start/End');
  }
  if (start < 0 || end > currentClip.duration) {
    return setStatus('error', `Диапазон 0 - ${currentClip.duration.toFixed(2)}s`);
  }

  segments.push({ id: Date.now(), name, start, end });
  renderSegments();
  segName.value = '';
  setStatus('success', `Фрагмент "${name}" добавлен`);
});

function renderSegments() {
  segmentsList.innerHTML = '';
  segmentsLayer.innerHTML = '';
  segmentsCount.textContent = segments.length;

  if (segments.length === 0) {
    segmentsList.innerHTML = '<div class="empty-hint">Нет добавленных фрагментов</div>';
    return;
  }

  const duration = currentClip ? currentClip.duration : 1;

  segments.forEach((seg) => {
    const block = document.createElement('div');
    block.className = 'segment-block';
    block.style.left = `${(seg.start / duration) * 100}%`;
    block.style.width = `${((seg.end - seg.start) / duration) * 100}%`;
    const label = document.createElement('div');
    label.className = 'segment-block-label';
    label.textContent = seg.name;
    block.appendChild(label);
    segmentsLayer.appendChild(block);

    const item = document.createElement('div');
    item.className = 'segment-item' + (seg._imported ? ' imported' : '');
    item.innerHTML = `
      <span class="name" title="${escapeHtml(seg.name)}">${escapeHtml(seg.name)}</span>
      <span class="time">${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s</span>
      <button class="delete" title="Удалить">✕</button>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete')) return;
      segStart.value = seg.start.toFixed(3);
      segEnd.value = seg.end.toFixed(3);
      segName.value = seg.name;
      updateSelectionUI();
    });
    item.querySelector('.delete').addEventListener('click', (e) => {
      e.stopPropagation();
      segments = segments.filter((s) => s.id !== seg.id);
      renderSegments();
    });
    segmentsList.appendChild(item);
  });
}

// ============ SEGMENT PRESETS (EXPORT / IMPORT) ============
exportSegmentsBtn.addEventListener('click', () => {
  if (segments.length === 0) return setStatus('error', 'Нет фрагментов для экспорта');
  if (!currentClip) return setStatus('error', 'Сначала загрузите модель и выберите анимацию');

  const preset = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: currentFileName || 'unknown',
    animationName: currentClip.name || '',
    animationDuration: +currentClip.duration.toFixed(4),
    segments: segments.map((s) => ({
      name: s.name,
      start: +s.start.toFixed(4),
      end: +s.end.toFixed(4),
      duration: +(s.end - s.start).toFixed(4),
    })),
  };

  const json = JSON.stringify(preset, null, 2);
  const baseName = (currentFileName || 'segments').replace(/\.(glb|gltf)$/i, '');
  const animSuffix = (currentClip.name || 'anim').replace(/[\\/:*?"<>|]/g, '_');
  const filename = `${baseName}_${animSuffix}_segments.json`;

  downloadBlob(new Blob([json], { type: 'application/json' }), filename);
  setStatus('success', `Экспортировано ${segments.length} фрагментов в JSON`);
});

importSegmentsBtn.addEventListener('click', () => {
  if (!currentClip) return setStatus('error', 'Сначала загрузите модель и выберите анимацию');
  importSegmentsInput.click();
});

importSegmentsInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const preset = JSON.parse(text);

    if (!preset || !Array.isArray(preset.segments)) {
      throw new Error('Некорректный формат JSON: отсутствует массив "segments"');
    }
    if (preset.segments.length === 0) throw new Error('В файле нет фрагментов');

    const clipDuration = currentClip.duration;
    const warnings = [];
    const imported = [];
    const existingIds = new Set(segments.map((s) => s.id));
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
        warnings.push(
          `#${idx + 1} "${rawName}": end ${end.toFixed(2)}s обрезан до ${clipDuration.toFixed(2)}s`
        );
        end = clipDuration;
      }
      if (start >= clipDuration) {
        warnings.push(`#${idx + 1} "${rawName}": start вне диапазона анимации, пропущен`);
        return;
      }
      if (end - start < 0.001) {
        warnings.push(`#${idx + 1} "${rawName}": слишком короткий, пропущен`);
        return;
      }

      let finalName = rawName;
      let suffix = 2;
      while (
        segments.some((s) => s.name === finalName) ||
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

    const replaceMode =
      segments.length === 0
        ? true
        : confirm(
            `Найдено ${imported.length} фрагментов.\n\n` +
              `OK — ЗАМЕНИТЬ существующие (${segments.length})\n` +
              `Отмена — ДОБАВИТЬ к существующим`
          );

    if (replaceMode) segments = imported;
    else segments = segments.concat(imported);

    renderSegments();

    let msg = `Импортировано ${imported.length} фрагментов`;
    if (preset.animationName && preset.animationName !== currentClip.name) {
      msg += ` (пресет для "${preset.animationName}", применён к "${currentClip.name}")`;
    }
    if (warnings.length > 0) {
      msg += `. Предупреждений: ${warnings.length}`;
      console.warn('Warnings при импорте:\n' + warnings.join('\n'));
    }
    setStatus(warnings.length > 0 ? 'info' : 'success', msg);
  } catch (err) {
    console.error(err);
    setStatus('error', 'Ошибка импорта: ' + err.message);
  } finally {
    importSegmentsInput.value = '';
  }
});

clearSegmentsBtn.addEventListener('click', () => {
  if (segments.length === 0) return;
  if (!confirm(`Удалить все ${segments.length} фрагментов?`)) return;
  segments = [];
  renderSegments();
  setStatus('info', 'Все фрагменты удалены');
});

// ============ EXPORT ZIP ============
exportBtn.addEventListener('click', async () => {
  if (!currentDocument || segments.length === 0) return;
  exportBtn.disabled = true;
  exportBtn.textContent = 'Обрабатываю...';
  setStatus(
    'info',
    'Клонирую и нарезаю...<div class="progress"><div class="progress-bar" id="progressBar"></div></div>'
  );

  try {
    const zip = new JSZip();
    const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS);
    const baseName = currentFileName.replace(/\.(glb|gltf)$/i, '');
    const targetAnimIndex = parseInt(document.querySelector('input[name="anim"]:checked').value);

    const originalAnims = currentDocument.getRoot().listAnimations();
    if (!originalAnims[targetAnimIndex]) {
      throw new Error('Выбранная анимация не найдена в документе');
    }
    const targetAnimName = originalAnims[targetAnimIndex].getName() || '';

    const originalBuffer = await io.writeBinary(currentDocument);
    const usedNames = new Set();

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      const cloned = await io.readBinary(originalBuffer);
      const root = cloned.getRoot();

      const clonedAnims = root.listAnimations();
      let animToKeep = clonedAnims[targetAnimIndex];
      if (!animToKeep && targetAnimName) {
        animToKeep = clonedAnims.find((a) => a.getName() === targetAnimName);
      }
      if (!animToKeep && clonedAnims.length > 0) {
        animToKeep = clonedAnims[0];
      }
      if (!animToKeep) throw new Error(`Анимация не найдена для сегмента "${seg.name}"`);

      for (const anim of clonedAnims) {
        if (anim !== animToKeep) anim.dispose();
      }

      await trimAnimation(animToKeep, seg.start, seg.end);

      const glbBuffer = await io.writeBinary(cloned);
      const fileName = uniqueName(sanitize(seg.name), usedNames);
      zip.file(`${fileName}.glb`, glbBuffer);

      const bar = document.getElementById('progressBar');
      if (bar) bar.style.width = `${((i + 1) / segments.length) * 100}%`;
    }

    setStatus('info', 'Упаковываю в ZIP...');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `${baseName}_segments.zip`);
    setStatus('success', `Готово! Экспортировано ${segments.length} файл(ов).`);
  } catch (err) {
    console.error(err);
    setStatus('error', 'Ошибка: ' + err.message);
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = 'Экспортировать все в ZIP';
  }
});

async function trimAnimation(gltfAnim, startTime, endTime) {
  if (!gltfAnim) throw new Error('trimAnimation: анимация не передана');
  const channels = gltfAnim.listChannels();
  if (channels.length === 0) throw new Error('trimAnimation: у анимации нет каналов');

  for (const channel of channels) {
    const sampler = channel.getSampler();
    if (!sampler) continue;

    const inputAccessor = sampler.getInput();
    const outputAccessor = sampler.getOutput();
    if (!inputAccessor || !outputAccessor) continue;

    const times = inputAccessor.getArray();
    const values = outputAccessor.getArray();
    if (!times || !values || times.length === 0) continue;

    const stride = outputAccessor.getElementSize();
    const newTimes = [];
    const newValues = [];

    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (t >= startTime && t <= endTime) {
        newTimes.push(t - startTime);
        for (let j = 0; j < stride; j++) {
          newValues.push(values[i * stride + j]);
        }
      }
    }

    if (newTimes.length === 0) {
      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < times.length; i++) {
        const diff = Math.min(Math.abs(times[i] - startTime), Math.abs(times[i] - endTime));
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }
      newTimes.push(0);
      for (let j = 0; j < stride; j++) {
        newValues.push(values[closestIdx * stride + j]);
      }
    }

    inputAccessor.setArray(new Float32Array(newTimes));
    outputAccessor.setArray(new Float32Array(newValues));
  }
}

// ============ RESET ============
clearBtn.addEventListener('click', () => {
  if (modelScene) scene.remove(modelScene);
  modelScene = null;
  mixer = null;
  currentAction = null;
  currentClip = null;
  animations = [];
  segments = [];
  currentDocument = null;
  currentFileName = '';
  fileInput.value = '';
  animationsEl.innerHTML = '';
  timelineEl.classList.remove('visible');
  segmentsList.innerHTML = '';
  segmentsLayer.innerHTML = '';
  segmentsCount.textContent = '0';
  zoom = 1;
  applyZoom(1);
  exportBtn.disabled = true;
  dropzone.style.display = 'flex';
  statusEl.classList.remove('visible');
});

// ============ HELPERS ============
function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function sanitize(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'segment';
}

function uniqueName(name, used) {
  let n = name;
  let i = 1;
  while (used.has(n)) n = `${name}_${i++}`;
  used.add(n);
  return n;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setStatus(type, message) {
  statusEl.className = `visible ${type}`;
  statusEl.innerHTML = message;
}