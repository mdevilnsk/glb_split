// ============================================================================
// file-loader.js — drag&drop, загрузка, preflight-валидация, reset
// ============================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WebIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';

import { state, dom } from './state.js';
import { scene, camera, controls } from './three-scene.js';
import { setStatus, validateClip, parseWithTimeout, disposeScene3D } from './utils.js';
import { renderAnimations, applyZoom } from './timeline-core.js';
import { onFileLoaded } from './tutorial.js';

// ---------------------------------------------------------------------------
// Очистка текущей модели
// ---------------------------------------------------------------------------
export function cleanupCurrentModel() {
  if (state.mixer) {
    try {
      state.mixer.stopAllAction();
      if (state.modelScene) state.mixer.uncacheRoot(state.modelScene);
    } catch (_) {}
    state.mixer = null;
  }
  if (state.currentAction) {
    try { state.currentAction.stop(); } catch (_) {}
    state.currentAction = null;
  }
  state.currentClip = null;

  if (state.modelScene) {
    scene.remove(state.modelScene);
    disposeScene3D(state.modelScene);
    state.modelScene = null;
  }

  state.currentDocument = null;
  state.animations = [];

  if (window.gc) { try { window.gc(); } catch (_) {} }
}

// ---------------------------------------------------------------------------
// Preflight-валидация через gltf-transform
// ---------------------------------------------------------------------------
function preflightValidateDocument(doc) {
  const root = doc.getRoot();
  const anims = root.listAnimations();
  if (anims.length === 0) throw new Error('В файле нет анимаций');

  for (const anim of anims) {
    const name = anim.getName() || 'unnamed';
    const channels = anim.listChannels();
    if (channels.length === 0) throw new Error(`Анимация "${name}" не содержит каналов`);

    for (let ci = 0; ci < channels.length; ci++) {
      const channel = channels[ci];
      const sampler = channel.getSampler();
      if (!sampler) continue;

      const interp = sampler.getInterpolation() || 'LINEAR';
      const input = sampler.getInput();
      const output = sampler.getOutput();
      if (!input || !output) throw new Error(`"${name}", канал #${ci}: нет input/output`);

      const times = input.getArray();
      const values = output.getArray();
      const tCount = input.getCount();
      const vCount = output.getCount();

      if (!times || tCount < 1) throw new Error(`"${name}", канал #${ci}: пустой input`);
      if (!values) throw new Error(`"${name}", канал #${ci}: нет значений`);

      const expected = tCount * (interp === 'CUBICSPLINE' ? 3 : 1);
      if (vCount !== expected) {
        throw new Error(
          `"${name}", канал #${ci}: несоответствие. Интерполяция: ${interp}, ` +
          `keyframes: ${tCount}, ожидалось ${expected}, получено ${vCount}`
        );
      }

      const tStep = Math.max(1, Math.floor(tCount / 100));
      for (let i = 0; i < tCount; i += tStep) {
        if (!isFinite(times[i])) throw new Error(`"${name}", канал #${ci}: NaN в times[${i}]`);
      }
      const vStep = Math.max(1, Math.floor(vCount / 200));
      for (let i = 0; i < vCount; i += vStep) {
        if (!isFinite(values[i])) throw new Error(`"${name}", канал #${ci}: NaN в values[${i}]`);
      }

      let lastT = -Infinity;
      for (let i = 0; i < tCount; i++) {
        if (times[i] < lastT) throw new Error(`"${name}", канал #${ci}: times не монотонны на ${i}`);
        lastT = times[i];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Загрузка файла
// ---------------------------------------------------------------------------
export async function loadFile(file) {
  if (state.isLoading) return setStatus('info', 'Уже загружается другой файл...');
  if (!file.name.match(/\.(glb|gltf)$/i)) return setStatus('error', 'Только .glb или .gltf');

  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > 80) {
    const ok = confirm(`Файл весит ${sizeMB.toFixed(0)} МБ.\n\nПродолжить?`);
    if (!ok) return;
  }

  state.isLoading = true;
  state.currentFileName = file.name;

  cleanupCurrentModel();
  state.segments = [];
  dom.animationsEl.innerHTML = '';
  dom.timelineEl.classList.remove('visible');
  dom.segmentsList.innerHTML = '';
  dom.segmentsLayer.innerHTML = '';
  dom.segmentsCount.textContent = '0';
  dom.exportBtn.disabled = true;

  setStatus('info', `Читаю файл (${sizeMB.toFixed(1)} МБ)...`);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // Этап 1: gltf-transform
    setStatus('info', 'Анализ структуры...');
    const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS);
    state.currentDocument = await io.readBinary(buffer);

    // Этап 2: preflight
    setStatus('info', 'Проверка анимаций...');
    preflightValidateDocument(state.currentDocument);

    // Этап 3: Three.js (с таймаутом)
    setStatus('info', 'Парсинг геометрии (до 30 сек)...');
    const loader = new GLTFLoader();
    const gltf = await parseWithTimeout(loader, arrayBuffer, '', 30000);

    // Этап 4: в сцену
    state.modelScene = gltf.scene;
    scene.add(state.modelScene);

    const box = new THREE.Box3().setFromObject(state.modelScene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(0, size.y, size.z * 2));
    controls.update();

    // Этап 5: валидация клипов Three.js
    state.animations = [];
    const skipped = [];
    for (const clip of gltf.animations) {
      try {
        validateClip(clip);
        state.animations.push(clip);
      } catch (err) {
        console.warn(`Пропущена "${clip.name}":`, err.message);
        skipped.push(`${clip.name}: ${err.message}`);
      }
    }

    if (state.animations.length === 0) {
      throw new Error('Все анимации невалидны. ' + (skipped[0] || ''));
    }

    state.mixer = new THREE.AnimationMixer(state.modelScene);

    renderAnimations();
    dom.timelineEl.classList.add('visible');
    dom.exportBtn.disabled = false;
    dom.exportModelBtn.disabled = false;
    dom.dropzone.style.display = 'none';

    let msg = `Загружено: ${file.name} · анимаций: ${state.animations.length}`;
    if (skipped.length > 0) msg += ` · пропущено: ${skipped.length}`;
    setStatus(skipped.length > 0 ? 'info' : 'success', msg);
    
    onFileLoaded(); // ← НОВОЕ: триггерим часть 2 туториала
  } catch (err) {
    console.error('Load error:', err);
    cleanupCurrentModel();
    state.segments = [];
    dom.animationsEl.innerHTML = '';
    dom.timelineEl.classList.remove('visible');
    dom.segmentsList.innerHTML = '';
    dom.segmentsLayer.innerHTML = '';
    dom.segmentsCount.textContent = '0';
    dom.exportBtn.disabled = true;
    dom.exportModelBtn.disabled = true;
    dom.dropzone.style.display = 'flex';
    setStatus('error', `Ошибка загрузки: ${err.message}`);
  } finally {
    state.isLoading = false;
  }
}

// ---------------------------------------------------------------------------
// Reset (кнопка "Сбросить файл")
// ---------------------------------------------------------------------------
function resetApp() {
  cleanupCurrentModel();
  state.segments = [];
  state.currentFileName = '';
  dom.fileInput.value = '';
  dom.animationsEl.innerHTML = '';
  dom.timelineEl.classList.remove('visible');
  dom.segmentsList.innerHTML = '';
  dom.segmentsLayer.innerHTML = '';
  dom.segmentsCount.textContent = '0';
  state.zoom = 1;
  applyZoom(1);
  dom.exportBtn.disabled = true;
  dom.exportModelBtn.disabled = true;
  dom.dropzone.style.display = 'flex';
  dom.statusEl.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
export function setupFileLoader() {
  dom.dropzone.addEventListener('click', () => dom.fileInput.click());

  dom.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dom.dropzone.classList.add('active');
  });
  dom.dropzone.addEventListener('dragleave', () => dom.dropzone.classList.remove('active'));
  dom.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dom.dropzone.classList.remove('active');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });

  dom.fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
  });

  dom.clearBtn.addEventListener('click', resetApp);
}