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

// ============ STATE ============
let isLoading = false;

// ============ RESOURCE CLEANUP ============
function disposeScene3D(sceneObj) {
    if (!sceneObj) return;
    sceneObj.traverse((obj) => {
        if (obj.geometry) {
            try { obj.geometry.dispose(); } catch (_) { }
        }
        if (obj.material) {
            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const mat of materials) {
                for (const key of Object.keys(mat)) {
                    const val = mat[key];
                    if (val && typeof val === 'object' && val.isTexture) {
                        try { val.dispose(); } catch (_) { }
                    }
                }
                try { mat.dispose(); } catch (_) { }
            }
        }
    });
}

function cleanupCurrentModel() {
    // Останавливаем миксер и все экшены
    if (mixer) {
        try {
            mixer.stopAllAction();
            if (modelScene) mixer.uncacheRoot(modelScene);
        } catch (_) { }
        mixer = null;
    }
    if (currentAction) {
        try { currentAction.stop(); } catch (_) { }
        currentAction = null;
    }
    currentClip = null;

    // Убираем и уничтожаем сцену модели
    if (modelScene) {
        scene.remove(modelScene);
        disposeScene3D(modelScene);
        modelScene = null;
    }

    // Уничтожаем документ gltf-transform
    if (currentDocument) {
        try { currentDocument = null; } catch (_) { }
    }

    animations = [];

    // Принудительно просим сборщик мусора (браузер может проигнорировать)
    if (window.gc) {
        try { window.gc(); } catch (_) { }
    }
}

// ============ PREFLIGHT VALIDATION (gltf-transform) ============
function preflightValidateDocument(doc) {
    const root = doc.getRoot();
    const anims = root.listAnimations();

    if (anims.length === 0) {
        throw new Error('В файле нет анимаций');
    }

    for (const anim of anims) {
        const name = anim.getName() || 'unnamed';
        const channels = anim.listChannels();

        if (channels.length === 0) {
            throw new Error(`Анимация "${name}" не содержит каналов`);
        }

        for (let ci = 0; ci < channels.length; ci++) {
            const channel = channels[ci];
            const sampler = channel.getSampler();
            if (!sampler) continue;

            const interp = sampler.getInterpolation() || 'LINEAR';
            const input = sampler.getInput();
            const output = sampler.getOutput();

            if (!input || !output) {
                throw new Error(`"${name}", канал #${ci}: отсутствует input/output accessor`);
            }

            const times = input.getArray();
            const values = output.getArray();
            const timesCount = input.getCount();
            const valuesCount = output.getCount();

            if (!times || timesCount < 1) {
                throw new Error(`"${name}", канал #${ci}: пустой input accessor (0 keyframes)`);
            }
            // 1 keyframe — валидно для константных каналов, обработается в trimAnimation
            if (!values) {
                throw new Error(`"${name}", канал #${ci}: нет значений`);
            }

            const comps = output.getElementSize();
            const expectedCount = timesCount * (interp === 'CUBICSPLINE' ? 3 : 1);

            if (valuesCount !== expectedCount) {
                throw new Error(
                    `"${name}", канал #${ci}: несоответствие данных. ` +
                    `Интерполяция: ${interp}, keyframes: ${timesCount}, ` +
                    `ожидалось ${expectedCount} элементов, получено ${valuesCount}`
                );
            }

            // Выборочная проверка на NaN/Infinity (не проходим по всем, чтобы не зависнуть)
            const tStep = Math.max(1, Math.floor(timesCount / 100));
            for (let i = 0; i < timesCount; i += tStep) {
                if (!isFinite(times[i])) {
                    throw new Error(`"${name}", канал #${ci}: NaN/Infinity в times[${i}]`);
                }
            }
            const vStep = Math.max(1, Math.floor(valuesCount / 200));
            for (let i = 0; i < valuesCount; i += vStep) {
                if (!isFinite(values[i])) {
                    throw new Error(`"${name}", канал #${ci}: NaN/Infinity в values[${i}]`);
                }
            }

            // Проверка монотонности times
            let lastT = -Infinity;
            for (let i = 0; i < timesCount; i++) {
                if (times[i] < lastT) {
                    throw new Error(`"${name}", канал #${ci}: times не монотонны на позиции ${i}`);
                }
                lastT = times[i];
            }
        }
    }
}

// ============ PARSE WITH TIMEOUT ============
function parseWithTimeout(loader, buffer, path, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error(
                `Парсинг превысил ${timeoutMs / 1000} сек. ` +
                `Файл повреждён или содержит аномально большой объём данных.`
            ));
        }, timeoutMs);

        loader.parseAsync(buffer, path)
            .then((gltf) => {
                if (settled) {
                    // Поздний ответ — сразу уничтожаем результат
                    try { disposeScene3D(gltf.scene); } catch (_) { }
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve(gltf);
            })
            .catch((err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(err);
            });
    });
}

// ============ LOAD FILE ============
async function loadFile(file) {
    if (isLoading) {
        setStatus('info', 'Уже загружается другой файл...');
        return;
    }

    if (!file.name.match(/\.(glb|gltf)$/i)) {
        return setStatus('error', 'Только .glb или .gltf');
    }

    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > 80) {
        const ok = confirm(
            `Файл весит ${sizeMB.toFixed(0)} МБ.\n\n` +
            `Парсинг может занять много памяти. Продолжить?`
        );
        if (!ok) return;
    }

    isLoading = true;
    currentFileName = file.name;

    // Очищаем предыдущую модель ДО начала работы
    cleanupCurrentModel();
    segments = [];
    animationsEl.innerHTML = '';
    timelineEl.classList.remove('visible');
    segmentsList.innerHTML = '';
    segmentsLayer.innerHTML = '';
    segmentsCount.textContent = '0';
    exportBtn.disabled = true;

    setStatus('info', `Читаю файл (${sizeMB.toFixed(1)} МБ)...`);

    try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);

        // ---------- ЭТАП 1: парсинг через gltf-transform ----------
        setStatus('info', 'Анализ структуры...');
        const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS);
        currentDocument = await io.readBinary(buffer);

        // ---------- ЭТАП 2: preflight-валидация ----------
        setStatus('info', 'Проверка анимаций...');
        preflightValidateDocument(currentDocument);

        // ---------- ЭТАП 3: парсинг через Three.js с таймаутом ----------
        setStatus('info', 'Парсинг геометрии (может занять до 30 сек)...');
        const loader = new GLTFLoader();
        const gltf = await parseWithTimeout(loader, arrayBuffer, '', 30000);

        // ---------- ЭТАП 4: добавляем модель в сцену ----------
        modelScene = gltf.scene;
        scene.add(modelScene);

        const box = new THREE.Box3().setFromObject(modelScene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        controls.target.copy(center);
        camera.position.copy(center).add(new THREE.Vector3(0, size.y, size.z * 2));
        controls.update();

        // ---------- ЭТАП 5: валидация клипов Three.js ----------
        animations = [];
        const skipped = [];
        for (const clip of gltf.animations) {
            try {
                validateClip(clip);
                animations.push(clip);
            } catch (err) {
                console.warn(`Пропущена анимация "${clip.name}":`, err.message);
                skipped.push(`${clip.name}: ${err.message}`);
            }
        }

        if (animations.length === 0) {
            throw new Error(
                'Все анимации невалидны. ' + (skipped.length > 0 ? `Первая ошибка: ${skipped[0]}` : '')
            );
        }

        mixer = new THREE.AnimationMixer(modelScene);

        renderAnimations();
        timelineEl.classList.add('visible');
        exportBtn.disabled = false;
        dropzone.style.display = 'none';

        let msg = `Загружено: ${file.name} · анимаций: ${animations.length}`;
        if (skipped.length > 0) msg += ` · пропущено: ${skipped.length}`;
        setStatus(skipped.length > 0 ? 'info' : 'success', msg);
    } catch (err) {
        console.error('Load error:', err);

        // ПОЛНАЯ ОЧИСТКА
        cleanupCurrentModel();
        segments = [];
        animationsEl.innerHTML = '';
        timelineEl.classList.remove('visible');
        segmentsList.innerHTML = '';
        segmentsLayer.innerHTML = '';
        segmentsCount.textContent = '0';
        exportBtn.disabled = true;
        dropzone.style.display = 'flex';

        setStatus('error', `Ошибка загрузки: ${err.message}`);
    } finally {
        isLoading = false;
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
    if (!animations[index]) {
        setStatus('error', 'Анимация не найдена');
        return;
    }
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
// ============ DRAG LOGIC ============
const snapLine = document.getElementById('snapLine');
const SNAP_THRESHOLD_PX = 10; // Пиксельный порог «магнита»

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

    // Авто-скролл у краёв
    const scrollRect = timelineScroll.getBoundingClientRect();
    if (e.clientX > scrollRect.right - 30) timelineScroll.scrollLeft += 12;
    else if (e.clientX < scrollRect.left + 30) timelineScroll.scrollLeft -= 12;

    const rawTime = xToTime(e.clientX);

    if (dragTarget === 'start') {
        const maxT = parseFloat(segEnd.value);
        const snap = snapTime(rawTime, getSnapCandidates());
        const snapped = Math.max(0, Math.min(snap.time, maxT - 0.001));
        segStart.value = snapped.toFixed(3);
        updateSelectionUI();
        showSnapLine(snap.snapped, snapped);
    } else if (dragTarget === 'end') {
        const minT = parseFloat(segStart.value);
        const snap = snapTime(rawTime, getSnapCandidates());
        const snapped = Math.min(currentClip.duration, Math.max(snap.time, minT + 0.001));
        segEnd.value = snapped.toFixed(3);
        updateSelectionUI();
        showSnapLine(snap.snapped, snapped);
    } else if (dragTarget === 'playhead') {
        updatePlayhead(rawTime);
        hideSnapLine();
    }
});

window.addEventListener('mouseup', () => {
    if (dragTarget) {
        dragTarget = null;
        isScrubbing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        hideSnapLine();
    }
});

// ============ SNAPPING ============
function getSnapCandidates() {
    const candidates = [];
    if (!currentClip) return candidates;

    // 1. Playhead (главная цель)
    if (currentAction) candidates.push(currentAction.time);

    // 2. Края анимации
    candidates.push(0);
    candidates.push(currentClip.duration);

    // 3. Границы других фрагментов
    for (const seg of segments) {
        candidates.push(seg.start);
        candidates.push(seg.end);
    }

    return candidates;
}

function snapTime(time, candidates) {
    if (!currentClip || candidates.length === 0) {
        return { time, snapped: false };
    }

    // Порог в пикселях → переводим в секунды под текущий зум
    const pxPerSecond = track.clientWidth / currentClip.duration;
    const thresholdTime = SNAP_THRESHOLD_PX / pxPerSecond;

    let bestTime = time;
    let bestDist = thresholdTime;
    let snapped = false;

    for (const c of candidates) {
        const dist = Math.abs(c - time);
        if (dist < bestDist) {
            bestDist = dist;
            bestTime = c;
            snapped = true;
        }
    }

    return { time: bestTime, snapped };
}

function showSnapLine(visible, time) {
    if (!visible || !currentClip) {
        hideSnapLine();
        return;
    }
    const pct = (time / currentClip.duration) * 100;
    snapLine.style.left = `${pct}%`;
    snapLine.classList.add('visible');
}

function hideSnapLine() {
    snapLine.classList.remove('visible');
}

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

// ============ ZOOM + SCROLL (Wheel + Trackpad) ============
timelineScroll.addEventListener('wheel', (e) => {
    const absX = Math.abs(e.deltaX);
    const absY = Math.abs(e.deltaY);

    // 1) Горизонтальный скролл: трекпад свайп влево/вправо ИЛИ Shift+колесо
    //    Отдаём браузеру — стандартный overflow-x: auto делает своё дело
    if (e.shiftKey || absX > absY * 1.5) {
        return;
    }

    // 2) Вертикальный скролл (или pinch) → зум
    if (!currentClip) return;

    // Коэффициент зума
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newZoom = Math.max(1, Math.min(20, zoom * factor));

    // Если уже на пределе — не перехватываем скролл,
    // чтобы можно было прокрутить сайдбар
    if (Math.abs(newZoom - zoom) < 0.0001) return;

    e.preventDefault();

    // Зум относительно позиции курсора (точка под мышкой остаётся на месте)
    const rect = timelineScroll.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + timelineScroll.scrollLeft;
    const timeBefore = (mouseX / track.clientWidth) * currentClip.duration;

    applyZoom(newZoom);

    const newMouseX = (timeBefore / currentClip.duration) * track.clientWidth;
    timelineScroll.scrollLeft = newMouseX - (e.clientX - rect.left);
}, { passive: false });

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

            await trimAnimation(cloned, animToKeep, seg.start, seg.end);

            const glbBuffer = await io.writeBinary(cloned);

            // Верификация: перечитываем результат и проверяем структуру
            const verify = await io.readBinary(glbBuffer);
            const vAnims = verify.getRoot().listAnimations();
            if (vAnims.length === 0) {
                throw new Error(`Сегмент "${seg.name}": экспортированный файл не содержит анимаций`);
            }
            for (const a of vAnims) {
                const channels = a.listChannels();
                if (channels.length === 0) {
                    throw new Error(`Сегмент "${seg.name}": анимация без каналов`);
                }
                for (const ch of channels) {
                    const s = ch.getSampler();
                    if (!s) throw new Error(`Сегмент "${seg.name}": канал без sampler`);
                    const i = s.getInput();
                    const o = s.getOutput();
                    if (!i || !o) throw new Error(`Сегмент "${seg.name}": sampler без input/output`);
                    if (i.getCount() < 1) {
                        throw new Error(`Сегмент "${seg.name}": пустой input accessor`);
                    }
                    // 1 keyframe допустим по факту (некоторые движки играют как статическую позу)
                    // Наш trimAnimation должен был продублировать, но на всякий случай не падаем
                    const comps = o.getElementSize();
                    const expected = i.getCount() * comps;
                    if (o.getCount() !== expected) {
                        throw new Error(
                            `Сегмент "${seg.name}": несоответствие размеров ` +
                            `(keyframes: ${i.getCount()}, components: ${comps}, ` +
                            `ожидалось ${expected}, получено ${o.getCount()})`
                        );
                    }
                }
            }

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

async function trimAnimation(doc, gltfAnim, startTime, endTime) {
    if (!doc || !gltfAnim) throw new Error('trimAnimation: нет документа или анимации');

    const channels = gltfAnim.listChannels();
    if (channels.length === 0) throw new Error('trimAnimation: у анимации нет каналов');

    const newDuration = Math.max(1e-3, endTime - startTime);
    const root = doc.getRoot();

    let buffer = root.listBuffers()[0];
    if (!buffer) buffer = doc.createBuffer();

    // Обрабатываем каждый УНИКАЛЬНЫЙ sampler ровно один раз
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

        // 1. Собираем индексы keyframes в диапазоне
        const kept = [];
        for (let i = 0; i < times.length; i++) {
            if (times[i] >= startTime && times[i] <= endTime) kept.push(i);
        }

        // 2. Fallback: если ничего не попало — ближайший
        if (kept.length === 0) {
            let closest = 0, minD = Infinity;
            for (let i = 0; i < times.length; i++) {
                const d = Math.min(Math.abs(times[i] - startTime), Math.abs(times[i] - endTime));
                if (d < minD) { minD = d; closest = i; }
            }
            kept.push(closest);
        }

        // 3. Гарантируем МИНИМУМ 2 keyframe (glTF требует)
        if (kept.length === 1) {
            kept.push(kept[0]);
        }
        kept.sort((a, b) => a - b);

        // 4. Формируем новые массивы
        const newTimes = [];
        const newValues = [];
        for (const idx of kept) {
            let t = times[idx] - startTime;
            t = Math.max(0, Math.min(newDuration, t));
            newTimes.push(t);
            const base = idx * valuesPerKey + valueOffset;
            for (let j = 0; j < components; j++) {
                newValues.push(values[base + j]);
            }
        }

        // 5. Строгая монотонность
        for (let i = 1; i < newTimes.length; i++) {
            if (newTimes[i] <= newTimes[i - 1]) {
                newTimes[i] = newTimes[i - 1] + 1e-4;
            }
            if (newTimes[i] > newDuration) newTimes[i] = newDuration;
        }

        // 6. Нормализация кватернионов
        if (channel.getTargetPath() === 'rotation' && components === 4) {
            for (let i = 0; i < newValues.length; i += 4) {
                const x = newValues[i], y = newValues[i + 1], z = newValues[i + 2], w = newValues[i + 3];
                const len = Math.hypot(x, y, z, w);
                if (len > 1e-6) {
                    newValues[i] = x / len;
                    newValues[i + 1] = y / len;
                    newValues[i + 2] = z / len;
                    newValues[i + 3] = w / len;
                } else {
                    newValues[i] = 0; newValues[i + 1] = 0; newValues[i + 2] = 0; newValues[i + 3] = 1;
                }
            }
        }

        // 7. Санитизация
        for (let i = 0; i < newTimes.length; i++) {
            if (!isFinite(newTimes[i])) newTimes[i] = i * 0.033;
        }
        for (let i = 0; i < newValues.length; i++) {
            if (!isFinite(newValues[i])) newValues[i] = 0;
        }

        // 8. СОЗДАЁМ новые accessors...
        const newInput = doc.createAccessor()
            .setType('SCALAR')
            .setArray(new Float32Array(newTimes))
            .setBuffer(buffer);

        const newOutput = doc.createAccessor()
            .setType(outputAcc.getType())
            .setArray(new Float32Array(newValues))
            .setBuffer(buffer);

        // 9. ...и МУТИРУЕМ существующий sampler.
        //    Канал остаётся привязан к тому же объекту, ничего не теряется при сериализации.
        sampler
            .setInput(newInput)
            .setOutput(newOutput)
            .setInterpolation('LINEAR');
    }

    if (typeof gltfAnim.setDuration === 'function') {
        gltfAnim.setDuration(newDuration);
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

function validateClip(clip) {
    if (!clip) throw new Error('Клип отсутствует');
    if (!clip.tracks || clip.tracks.length === 0) {
        throw new Error('нет ни одного трека');
    }
    if (!isFinite(clip.duration) || clip.duration <= 0) {
        throw new Error(`некорректная длительность: ${clip.duration}`);
    }

    for (const track of clip.tracks) {
        const times = track.times;
        const values = track.values;

        if (!times || times.length === 0) {
            throw new Error(`трек "${track.name}" пуст`);
        }
        if (!values || values.length === 0) {
            throw new Error(`трек "${track.name}" без значений`);
        }

        // Проверка размера массивов (должны быть кратны)
        const comps = track.getValueSize ? track.getValueSize() : (values.length / times.length);
        if (values.length % comps !== 0 || values.length / comps !== times.length) {
            throw new Error(
                `трек "${track.name}": размеры не соответствуют. ` +
                `times: ${times.length}, values: ${values.length}, components: ${comps}`
            );
        }

        // Проверяем на NaN/Infinity выборочно (не по всем — иначе сами зависнем)
        const tStep = Math.max(1, Math.floor(times.length / 200));
        for (let i = 0; i < times.length; i += tStep) {
            if (!isFinite(times[i])) {
                throw new Error(`трек "${track.name}": NaN/Infinity в times[${i}]`);
            }
        }
        const vStep = Math.max(1, Math.floor(values.length / 500));
        for (let i = 0; i < values.length; i += vStep) {
            if (!isFinite(values[i])) {
                throw new Error(`трек "${track.name}": NaN/Infinity в values[${i}]`);
            }
        }

        // Монотонность times
        let lastT = -Infinity;
        for (let i = 0; i < times.length; i++) {
            if (times[i] < lastT) {
                throw new Error(`трек "${track.name}": times не монотонны на позиции ${i}`);
            }
            lastT = times[i];
        }
    }
}
