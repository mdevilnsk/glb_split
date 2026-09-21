// ============================================================================
// tutorial.js — двухчастный обучающий оверлей (кроссбраузерный)
// ============================================================================

import { dom } from './state.js';

const KEY_P1 = 'glb-editor-tutorial-p1-seen-v1';
const KEY_P2 = 'glb-editor-tutorial-p2-seen-v1';

// ---------------------------------------------------------------------------
// In-memory fallback (Safari Private Mode может блокировать localStorage)
// ---------------------------------------------------------------------------
const memoryStore = {};
const store = {
  get(key) {
    try { return localStorage.getItem(key); }
    catch (_) { return memoryStore[key] ?? null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); }
    catch (_) { memoryStore[key] = value; }
  },
};

// ---------------------------------------------------------------------------
// Шаги
// ---------------------------------------------------------------------------
const STEPS = [
  {
    part: 1, id: 'intro',
    title: '👋 Добро пожаловать!',
    text: 'Это редактор GLB-анимаций. Всё работает локально в браузере — файлы никуда не отправляются. Покажу за 30 секунд, как им пользоваться.',
  },
  {
    part: 1, id: 'dropzone',
    target: '#dropzone', placement: 'right',
    title: '📦 Загрузка файла',
    text: 'Перетащите .glb или .gltf сюда, либо нажмите на область. После загрузки модель появится в 3D-вьюпорте слева, а справа появятся инструменты таймлайна.',
  },
  {
    part: 1, id: 'footer',
    target: '.sidebar-footer', placement: 'left',
    title: '💾 Экспорт',
    text: 'Здесь кнопки экспорта: собрать ZIP со всеми нарезанными фрагментами, скачать чистую модель без анимаций или сбросить текущий файл.',
  },
  {
    part: 1, id: 'done1',
    title: '🎯 Первый шаг сделан',
    text: 'Отлично! Теперь перетащите любой .glb-файл в окно — покажу, как пользоваться таймлайном, зумом и нарезкой.',
  },

  {
    part: 2, id: 'animations',
    target: '#animations', placement: 'right',
    title: '🎬 Выбор анимации',
    text: 'Список всех анимаций из файла. Кликните по нужной — она подгрузится в таймлайн, а модель примет позу первого кадра.',
  },
  {
    part: 2, id: 'timeline',
    target: '#timelineScroll', placement: 'right',
    title: '⏱ Таймлайн',
    text: 'Красная линия — Playhead, текущий кадр. Тяните её мышкой, чтобы промотать вручную. Бирюзовые метки ◀ ▶ задают начало и конец выделения — они «прилипают» к Playhead и другим фрагментам.',
  },
  {
    part: 2, id: 'zoom',
    target: '.zoom-row', placement: 'right',
    title: '🔍 Зум',
    text: 'Зум от 1x до 20x. Колесо мышки над таймлайном или слайдер. Ctrl/Cmd + колесо — зум к позиции курсора.',
  },
  {
    part: 2, id: 'playback',
    target: '.playback-row', placement: 'right',
    title: '▶ Воспроизведение',
    text: 'Play или Пробел — воспроизведение начнётся с метки Start и остановится на End. Слайдер справа — скорость от 0.1x до 2x.',
  },
  {
    part: 2, id: 'segments',
    target: '.segment-editor', placement: 'right',
    title: '✂️ Создание фрагмента',
    text: 'Выделите кусок ползунками, введите имя файла и нажмите «+ Добавить фрагмент». Потом можно экспортировать все фрагменты одним ZIP-архивом.',
  },
  {
    part: 2, id: 'done2',
    title: '🎉 Готово!',
    text: 'Теперь вы знаете всё, что нужно. Если что-то забудете — нажмите «?» в шапке панели, туториал запустится снова.',
  },
];

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------
let currentSteps = [];
let currentStep = 0;
let currentPart = null;
let overlay = null;
let resizeHandler = null;
let keyHandler = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function showTutorial(part = 'all') {
  if (part === 'all') {
    const hasFile = !!document.querySelector('.anim-item');
    currentSteps = STEPS.filter((s) => s.part === 1 || (s.part === 2 && hasFile));
    currentPart = hasFile ? 'all' : 1;
  } else if (part === 1) {
    currentSteps = STEPS.filter((s) => s.part === 1);
    currentPart = 1;
  } else if (part === 2) {
    currentSteps = STEPS.filter((s) => s.part === 2);
    currentPart = 2;
  } else {
    currentSteps = STEPS.slice();
    currentPart = 'all';
  }

  // Пропускаем шаги, у которых target невидим
  currentSteps = currentSteps.filter((step) => {
    if (!step.target) return true;
    const el = document.querySelector(step.target);
    return el && isElementVisible(el);
  });

  if (currentSteps.length === 0) return;
  currentStep = 0;
  createOverlay();
  renderStep();
}

export function maybeShowTutorialOnFirstLaunch() {
  if (!store.get(KEY_P1)) {
    setTimeout(() => showTutorial(1), 500);
  }
}

export function onFileLoaded() {
  const p1 = store.get(KEY_P1);
  const p2 = store.get(KEY_P2);
  if (p1 && !p2) {
    setTimeout(() => showTutorial(2), 600);
  }
}

// ---------------------------------------------------------------------------
// Вспомогательные
// ---------------------------------------------------------------------------
function isElementVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return true;
}

function createOverlay() {
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.className = 'tutorial-overlay';
  // Четыре прямоугольника-затемнителя + рамка-подсветка + тултип.
  // Этот подход работает одинаково во всех браузерах, включая Safari.
  overlay.innerHTML = `
    <div class="tut-backdrop tut-backdrop-top"></div>
    <div class="tut-backdrop tut-backdrop-bottom"></div>
    <div class="tut-backdrop tut-backdrop-left"></div>
    <div class="tut-backdrop tut-backdrop-right"></div>
    <div class="tut-highlight" id="tutHighlight"></div>
    <div class="tutorial-tooltip" id="tutTooltip">
      <div class="tutorial-step-info">
        <span id="tutStepCounter"></span>
        <button class="tutorial-close" id="tutClose" title="Закрыть">✕</button>
      </div>
      <h3 class="tutorial-title" id="tutTitle"></h3>
      <p class="tutorial-text" id="tutText"></p>
      <div class="tutorial-actions">
        <button class="tutorial-btn ghost" id="tutSkip">Пропустить</button>
        <div class="tutorial-nav">
          <button class="tutorial-btn ghost" id="tutPrev">← Назад</button>
          <button class="tutorial-btn primary" id="tutNext">Далее →</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('tutClose').addEventListener('click', closeTutorial);
  document.getElementById('tutSkip').addEventListener('click', closeTutorial);
  document.getElementById('tutPrev').addEventListener('click', () => {
    if (currentStep > 0) { currentStep--; renderStep(); }
  });
  document.getElementById('tutNext').addEventListener('click', () => {
    if (currentStep < currentSteps.length - 1) { currentStep++; renderStep(); }
    else closeTutorial();
  });

  resizeHandler = () => renderStep();
  keyHandler = (e) => {
    if (e.key === 'Escape') closeTutorial();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (currentStep < currentSteps.length - 1) { currentStep++; renderStep(); }
      else closeTutorial();
    } else if (e.key === 'ArrowLeft') {
      if (currentStep > 0) { currentStep--; renderStep(); }
    }
  };

  window.addEventListener('resize', resizeHandler);
  window.addEventListener('keydown', keyHandler);
}

function closeTutorial() {
  if (currentPart === 1 || currentPart === 'all') store.set(KEY_P1, '1');
  if (currentPart === 2 || currentPart === 'all') store.set(KEY_P2, '1');

  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  if (overlay) { overlay.remove(); overlay = null; }
}

// ---------------------------------------------------------------------------
// Позиционирование бэкдропов вокруг подсвеченного прямоугольника
// ---------------------------------------------------------------------------
function positionBackdrops(rect) {
  const top    = overlay.querySelector('.tut-backdrop-top');
  const bottom = overlay.querySelector('.tut-backdrop-bottom');
  const left   = overlay.querySelector('.tut-backdrop-left');
  const right  = overlay.querySelector('.tut-backdrop-right');

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Если rect == null — покрываем весь экран (режим "без подсветки")
  if (!rect) {
    top.style.cssText    = `left:0; top:0; width:${vw}px; height:${vh}px;`;
    bottom.style.cssText = `display:none;`;
    left.style.cssText   = `display:none;`;
    right.style.cssText  = `display:none;`;
    return;
  }

  const { x, y, w, h } = rect;

  // Верх: от 0 до y
  top.style.cssText = `left:0; top:0; width:${vw}px; height:${Math.max(0, y)}px;`;
  // Низ: от y+h до низа экрана
  bottom.style.cssText = `left:0; top:${y + h}px; width:${vw}px; height:${Math.max(0, vh - (y + h))}px;`;
  // Лево: от y до y+h, от 0 до x
  left.style.cssText = `left:0; top:${y}px; width:${Math.max(0, x)}px; height:${h}px;`;
  // Право: от y до y+h, от x+w до правого края
  right.style.cssText = `left:${x + w}px; top:${y}px; width:${Math.max(0, vw - (x + w))}px; height:${h}px;`;
}

// ---------------------------------------------------------------------------
// Рендер шага
// ---------------------------------------------------------------------------
function renderStep() {
  if (!overlay) return;

  const step = currentSteps[currentStep];
  if (!step) return closeTutorial();

  const highlight = document.getElementById('tutHighlight');
  const tooltip = document.getElementById('tutTooltip');
  const counter = document.getElementById('tutStepCounter');

  counter.textContent = `${currentStep + 1} / ${currentSteps.length}`;
  document.getElementById('tutTitle').textContent = step.title;
  document.getElementById('tutText').textContent = step.text;

  document.getElementById('tutPrev').style.visibility = currentStep === 0 ? 'hidden' : 'visible';
  document.getElementById('tutNext').textContent =
    currentStep === currentSteps.length - 1 ? 'Начать!' : 'Далее →';

  const el = step.target ? document.querySelector(step.target) : null;
  const needHighlight = el && isElementVisible(el);

  // -------- Режим "полное затемнение" (нет target) --------
  if (!needHighlight) {
    highlight.style.display = 'none';
    positionBackdrops(null);

    tooltip.classList.add('centered');
    tooltip.style.left = '';
    tooltip.style.top = '';
    return;
  }

  // -------- Режим с подсветкой --------
  tooltip.classList.remove('centered');

  const elRect = el.getBoundingClientRect();
  const pad = 6;

  // Координаты вырезанной области
  const hole = {
    x: Math.max(0, elRect.left - pad),
    y: Math.max(0, elRect.top - pad),
    w: elRect.width + pad * 2,
    h: elRect.height + pad * 2,
  };

  // Позиционируем бэкдропы
  positionBackdrops(hole);

  // Рамка-подсветка вокруг выреза
  highlight.style.display = 'block';
  highlight.style.left = `${hole.x}px`;
  highlight.style.top = `${hole.y}px`;
  highlight.style.width = `${hole.w}px`;
  highlight.style.height = `${hole.h}px`;

  // Позиционируем тултип — сначала сброс, потом измеряем, потом ставим
  tooltip.style.left = '0px';
  tooltip.style.top = '0px';

  const ttRect = tooltip.getBoundingClientRect();
  const gap = 16;
  let left = 0;
  let top = 0;
  const placement = step.placement || 'right';

  if (placement === 'right') {
    left = hole.x + hole.w + gap;
    top = hole.y + hole.h / 2 - ttRect.height / 2;
    if (left + ttRect.width > window.innerWidth - 16) {
      left = hole.x - gap - ttRect.width;
    }
  } else if (placement === 'left') {
    left = hole.x - gap - ttRect.width;
    if (left < 16) left = hole.x + hole.w + gap;
    top = hole.y + hole.h / 2 - ttRect.height / 2;
  } else if (placement === 'bottom') {
    left = hole.x + hole.w / 2 - ttRect.width / 2;
    top = hole.y + hole.h + gap;
  }

  left = Math.max(16, Math.min(left, window.innerWidth - ttRect.width - 16));
  top = Math.max(16, Math.min(top, window.innerHeight - ttRect.height - 16));

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}