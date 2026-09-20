// ============================================================================
// exporter.js — экспорт ZIP + trimAnimation
// ============================================================================

import JSZip from 'jszip';
import { WebIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';

import { state, dom } from './state.js';
import { sanitize, uniqueName, downloadBlob, setStatus } from './utils.js';

// ---------------------------------------------------------------------------
// Обрезка анимации (создаём новые accessors, мутируем существующий sampler)
// ---------------------------------------------------------------------------
async function trimAnimation(doc, gltfAnim, startTime, endTime) {
  if (!doc || !gltfAnim) throw new Error('trimAnimation: нет документа или анимации');

  const channels = gltfAnim.listChannels();
  if (channels.length === 0) throw new Error('trimAnimation: у анимации нет каналов');

  const newDuration = Math.max(1e-3, endTime - startTime);
  const root = doc.getRoot();

  let buffer = root.listBuffers()[0];
  if (!buffer) buffer = doc.createBuffer();

  const processedSamplers = new Set();

  for (const channel of channels) {
    const sampler = channel.getSampler();
    if (!sampler) continue;
    if (processedSamplers.has(sampler)) continue;
    processedSamplers.add(sampler);

    const interp = sampler.getInterpolation() || 'LINEAR';
    const inputAcc = sampler.getInput();
    const outputAcc = sampler.getOutput();
    if (!inputAcc || !outputAcc) continue;

    const times = Array.from(inputAcc.getArray());
    const values = Array.from(outputAcc.getArray());
    const components = outputAcc.getElementSize();
    const isCubic = interp === 'CUBICSPLINE';
    const valuesPerKey = isCubic ? components * 3 : components;
    const valueOffset = isCubic ? components : 0;

    // 1. Отбираем keyframes в диапазон
    const kept = [];
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= startTime && times[i] <= endTime) kept.push(i);
    }

    // 2. Fallback — ближайший keyframe
    if (kept.length === 0) {
      let closest = 0, minD = Infinity;
      for (let i = 0; i < times.length; i++) {
        const d = Math.min(Math.abs(times[i] - startTime), Math.abs(times[i] - endTime));
        if (d < minD) { minD = d; closest = i; }
      }
      kept.push(closest);
    }
    // 3. Минимум 2 keyframe
    if (kept.length === 1) kept.push(kept[0]);
    kept.sort((a, b) => a - b);

    // 4. Формируем новые массивы
    const newTimes = [];
    const newValues = [];
    for (const idx of kept) {
      let t = times[idx] - startTime;
      t = Math.max(0, Math.min(newDuration, t));
      newTimes.push(t);
      const base = idx * valuesPerKey + valueOffset;
      for (let j = 0; j < components; j++) newValues.push(values[base + j]);
    }

    // 5. Монотонность
    for (let i = 1; i < newTimes.length; i++) {
      if (newTimes[i] <= newTimes[i - 1]) newTimes[i] = newTimes[i - 1] + 1e-4;
      if (newTimes[i] > newDuration) newTimes[i] = newDuration;
    }

    // 6. Нормализация кватернионов
    if (channel.getTargetPath() === 'rotation' && components === 4) {
      for (let i = 0; i < newValues.length; i += 4) {
        const x = newValues[i], y = newValues[i + 1], z = newValues[i + 2], w = newValues[i + 3];
        const len = Math.hypot(x, y, z, w);
        if (len > 1e-6) {
          newValues[i] = x / len; newValues[i + 1] = y / len;
          newValues[i + 2] = z / len; newValues[i + 3] = w / len;
        } else {
          newValues[i] = 0; newValues[i + 1] = 0; newValues[i + 2] = 0; newValues[i + 3] = 1;
        }
      }
    }

    // 7. Санитизация
    for (let i = 0; i < newTimes.length; i++) if (!isFinite(newTimes[i])) newTimes[i] = i * 0.033;
    for (let i = 0; i < newValues.length; i++) if (!isFinite(newValues[i])) newValues[i] = 0;

    // 8. Новые accessors
    const newInput = doc.createAccessor()
      .setType('SCALAR')
      .setArray(new Float32Array(newTimes))
      .setBuffer(buffer);

    const newOutput = doc.createAccessor()
      .setType(outputAcc.getType())
      .setArray(new Float32Array(newValues))
      .setBuffer(buffer);

    // 9. Мутируем СУЩЕСТВУЮЩИЙ sampler (не создаём новый)
    sampler.setInput(newInput).setOutput(newOutput).setInterpolation('LINEAR');
  }

  if (typeof gltfAnim.setDuration === 'function') {
    gltfAnim.setDuration(newDuration);
  }
}

// ---------------------------------------------------------------------------
// Верификация одного сегмента
// ---------------------------------------------------------------------------
function verifyExportedBuffer(doc, segmentName) {
  const anims = doc.getRoot().listAnimations();
  if (anims.length === 0) throw new Error(`Сегмент "${segmentName}": нет анимаций в файле`);

  for (const a of anims) {
    const channels = a.listChannels();
    if (channels.length === 0) throw new Error(`Сегмент "${segmentName}": анимация без каналов`);

    for (const ch of channels) {
      const s = ch.getSampler();
      if (!s) throw new Error(`Сегмент "${segmentName}": канал без sampler`);

      const i = s.getInput();
      const o = s.getOutput();
      if (!i || !o) throw new Error(`Сегмент "${segmentName}": sampler без input/output`);

      const tCount = i.getCount();            // сколько keyframes
      const vCount = o.getCount();            // сколько элементов (vec3/vec4/scalar)
      if (tCount < 1) throw new Error(`Сегмент "${segmentName}": пустой input`);
      if (vCount < 1) throw new Error(`Сегмент "${segmentName}": пустой output`);

      // Для CUBICSPLINE на каждый keyframe приходится 3 элемента (in/value/out)
      const interp = s.getInterpolation() || 'LINEAR';
      const expected = tCount * (interp === 'CUBICSPLINE' ? 3 : 1);

      if (vCount !== expected) {
        throw new Error(
          `Сегмент "${segmentName}": несоответствие размеров ` +
          `(интерполяция: ${interp}, keyframes: ${tCount}, ` +
          `ожидалось элементов: ${expected}, получено: ${vCount})`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
async function handleExport() {
  if (!state.currentDocument || state.segments.length === 0) return;

  dom.exportBtn.disabled = true;
  dom.exportBtn.textContent = 'Обрабатываю...';
  setStatus('info', 'Клонирую и нарезаю...<div class="progress"><div class="progress-bar" id="progressBar"></div></div>');

  try {
    const zip = new JSZip();
    const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS);
    const baseName = state.currentFileName.replace(/\.(glb|gltf)$/i, '');
    const targetAnimIndex = parseInt(document.querySelector('input[name="anim"]:checked').value);

    const originalAnims = state.currentDocument.getRoot().listAnimations();
    if (!originalAnims[targetAnimIndex]) throw new Error('Выбранная анимация не найдена');
    const targetAnimName = originalAnims[targetAnimIndex].getName() || '';

    const originalBuffer = await io.writeBinary(state.currentDocument);
    const usedNames = new Set();

    for (let i = 0; i < state.segments.length; i++) {
      const seg = state.segments[i];
      const cloned = await io.readBinary(originalBuffer);
      const root = cloned.getRoot();

      const clonedAnims = root.listAnimations();
      let animToKeep = clonedAnims[targetAnimIndex];
      if (!animToKeep && targetAnimName) animToKeep = clonedAnims.find((a) => a.getName() === targetAnimName);
      if (!animToKeep && clonedAnims.length > 0) animToKeep = clonedAnims[0];
      if (!animToKeep) throw new Error(`Анимация не найдена для сегмента "${seg.name}"`);

      for (const anim of clonedAnims) if (anim !== animToKeep) anim.dispose();

      await trimAnimation(cloned, animToKeep, seg.start, seg.end);

      const glbBuffer = await io.writeBinary(cloned);

      // Верификация — перечитываем
      const verify = await io.readBinary(glbBuffer);
      verifyExportedBuffer(verify, seg.name);

      const fileName = uniqueName(sanitize(seg.name), usedNames);
      zip.file(`${fileName}.glb`, glbBuffer);

      const bar = document.getElementById('progressBar');
      if (bar) bar.style.width = `${((i + 1) / state.segments.length) * 100}%`;
    }

    setStatus('info', 'Упаковываю в ZIP...');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `${baseName}_segments.zip`);
    setStatus('success', `Готово! Экспортировано ${state.segments.length} файл(ов).`);
  } catch (err) {
    console.error(err);
    setStatus('error', 'Ошибка: ' + err.message);
  } finally {
    dom.exportBtn.disabled = false;
    dom.exportBtn.textContent = 'Экспортировать все в ZIP';
  }
}

// ---------------------------------------------------------------------------
// Экспорт модели без анимаций (со скелетом и скином)
// ---------------------------------------------------------------------------
async function handleExportModel() {
  if (!state.currentDocument) return;

  dom.exportModelBtn.disabled = true;
  const originalText = dom.exportModelBtn.textContent;
  dom.exportModelBtn.textContent = 'Готовлю модель...';
  setStatus('info', 'Убираю анимации...');

  try {
    const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS);

    // Сериализуем оригинал, потом читаем — так получаем независимую копию
    const originalBuffer = await io.writeBinary(state.currentDocument);
    const cloned = await io.readBinary(originalBuffer);
    const root = cloned.getRoot();

    // Удаляем ТОЛЬКО анимации. Скелет (Skin + Nodes), меши, материалы,
    // текстуры — всё остаётся на месте.
    const anims = root.listAnimations();
    const removedCount = anims.length;
    for (const a of anims) {
      a.dispose();
    }

    if (removedCount === 0) {
      setStatus('info', 'В файле не было анимаций — скачиваю как есть');
    }

    const glbBuffer = await io.writeBinary(cloned);

    // Верификация: файл читается, скелет остался
    const verify = await io.readBinary(glbBuffer);
    const vRoot = verify.getRoot();
    const vSkins = vRoot.listSkins();
    const vMeshes = vRoot.listMeshes();
    const vAnims = vRoot.listAnimations();

    if (vMeshes.length === 0) {
      throw new Error('После обработки в файле не осталось мешей');
    }
    if (vAnims.length > 0) {
      throw new Error(`После обработки остались анимации: ${vAnims.length}`);
    }

    const baseName = state.currentFileName.replace(/\.(glb|gltf)$/i, '') || 'model';
    const filename = `${baseName}_no_anim.glb`;

    downloadBlob(new Blob([glbBuffer], { type: 'model/gltf-binary' }), filename);

    let msg = `Готово! ${filename}`;
    msg += ` · мешей: ${vMeshes.length}`;
    if (vSkins.length > 0) msg += ` · скелетов: ${vSkins.length}`;
    msg += ` · удалено анимаций: ${removedCount}`;
    setStatus('success', msg);
  } catch (err) {
    console.error(err);
    setStatus('error', 'Ошибка экспорта модели: ' + err.message);
  } finally {
    dom.exportModelBtn.disabled = false;
    dom.exportModelBtn.textContent = originalText;
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function setupExporter() {
  dom.exportBtn.addEventListener('click', handleExport);
  dom.exportModelBtn.addEventListener('click', handleExportModel);
}
