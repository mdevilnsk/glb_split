// ============================================================================
// utils.js — общие хелперы (без зависимостей на state/DOM кроме status)
// ============================================================================

import { dom } from './state.js';

export function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

export function sanitize(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'segment';
}

export function uniqueName(name, used) {
  let n = name;
  let i = 1;
  while (used.has(n)) n = `${name}_${i++}`;
  used.add(n);
  return n;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function setStatus(type, message) {
  dom.statusEl.className = `visible ${type}`;
  dom.statusEl.innerHTML = message;
}

// ---------------------------------------------------------------------------
// Валидация THREE.AnimationClip
// ---------------------------------------------------------------------------
export function validateClip(clip) {
  if (!clip) throw new Error('Клип отсутствует');
  if (!clip.tracks || clip.tracks.length === 0) throw new Error('нет ни одного трека');
  if (!isFinite(clip.duration) || clip.duration <= 0) {
    throw new Error(`некорректная длительность: ${clip.duration}`);
  }

  for (const track of clip.tracks) {
    const times = track.times;
    const values = track.values;
    if (!times || times.length === 0) throw new Error(`трек "${track.name}" пуст`);
    if (!values || values.length === 0) throw new Error(`трек "${track.name}" без значений`);

    const comps = track.getValueSize ? track.getValueSize() : values.length / times.length;
    if (values.length % comps !== 0 || values.length / comps !== times.length) {
      throw new Error(
        `трек "${track.name}": размеры не соответствуют (times: ${times.length}, ` +
        `values: ${values.length}, components: ${comps})`
      );
    }

    const tStep = Math.max(1, Math.floor(times.length / 200));
    for (let i = 0; i < times.length; i += tStep) {
      if (!isFinite(times[i])) throw new Error(`трек "${track.name}": NaN/Inf в times[${i}]`);
    }
    const vStep = Math.max(1, Math.floor(values.length / 500));
    for (let i = 0; i < values.length; i += vStep) {
      if (!isFinite(values[i])) throw new Error(`трек "${track.name}": NaN/Inf в values[${i}]`);
    }

    let lastT = -Infinity;
    for (let i = 0; i < times.length; i++) {
      if (times[i] < lastT) throw new Error(`трек "${track.name}": times не монотонны на ${i}`);
      lastT = times[i];
    }
  }
}

// ---------------------------------------------------------------------------
// Парсинг с таймаутом (защита от бесконечного зависания Chrome)
// ---------------------------------------------------------------------------
export function parseWithTimeout(loader, buffer, path, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(
        `Парсинг превысил ${timeoutMs / 1000} сек. Файл повреждён или содержит аномальный объём данных.`
      ));
    }, timeoutMs);

    loader.parseAsync(buffer, path).then(
      (gltf) => {
        if (settled) { try { disposeScene3D(gltf.scene); } catch (_) {} return; }
        settled = true; clearTimeout(timer); resolve(gltf);
      },
      (err) => {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(err);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Полное уничтожение Three.js-объектов (геометрии, материалы, текстуры)
// ---------------------------------------------------------------------------
export function disposeScene3D(sceneObj) {
  if (!sceneObj) return;
  sceneObj.traverse((obj) => {
    if (obj.geometry) { try { obj.geometry.dispose(); } catch (_) {} }
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        for (const key of Object.keys(mat)) {
          const val = mat[key];
          if (val && typeof val === 'object' && val.isTexture) {
            try { val.dispose(); } catch (_) {}
          }
        }
        try { mat.dispose(); } catch (_) {}
      }
    }
  });
}