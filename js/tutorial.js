// ============================================================================
// tutorial.js — двухчастный обучающий оверлей с адаптацией под состояние UI
// ============================================================================

import { dom } from './state.js';

const KEY_P1 = 'glb-editor-tutorial-p1-seen-v1';
const KEY_P2 = 'glb-editor-tutorial-p2-seen-v1';

// ---------------------------------------------------------------------------
// Шаги. part = 1 → показываются всегда; part = 2 → только после загрузки файла
// ---------------------------------------------------------------------------
const STEPS = [
  // ---------- ЧАСТЬ 1 ----------
  {
    part: 1,
    id: 'intro',
    title: '👋 Добро пожаловать!',
    text: 'Это редактор GLB-анимаций. Всё работает локально в браузере — файлы никуда не отправляются. Покажу за 30 секунд, как им пользоваться.',
  },
  {
    part: 1,
    id: 'dropzone',
    target: '#dropzone',
    placement: 'right',
    title: '📦 Загрузка файла',
    text: 'Перетащите .glb или .gltf сюда, либо нажмите на область. После загрузки модель появится в 3D-вьюпорте слева, а справа появятся инструменты таймлайна.',
  },
  {
    part: 1,
    id: 'footer',
    target: '.sidebar-footer',
    placement: 'left',
    title: '💾 Экспорт',
    text: 'Здесь кнопки экспорта: собрать ZIP со всеми нарезанными фрагментами, скачать чистую модель без анимаций или сбросить текущий файл.',
  },
  {
    part: 1,
    id: 'done1',
    title: '🎯 Первый шаг сделан',
    text: 'Отлично! Теперь перетащите любой .glb-файл в окно — покажу, как пользоваться таймлайном, зумом и нарезкой.',
  },

  // ---------- ЧАСТЬ 2 ----------
  {
    part: 2,
    id: 'animations',
    target: '#animations',
    placement: 'right',
    title: '🎬 Выбор анимации',
    text: 'Список всех анимаций из файла. Кликните по нужной — она подгрузится в таймлайн, а модель примет позу первого кадра.',
  },
  {
    part: 2,
    id: 'timeline',
    target: '#timelineScroll',
    placement: 'right',
    title: '⏱ Таймлайн',
    text: 'Красная линия — Playhead, текущий кадр. Тяните её мышкой, чтобы промотать вручную. Бирюзовые метки ◀ ▶ задают начало и конец выделения — они «прилипают» к Playhead и другим фрагментам.',
  },
  {
    part: 2,
    id: 'zoom',
    target: '.zoom-row',
    placement: 'right',
    title: '🔍 Зум',
    text: 'Зум от 1x до 20x. Колесо мышки над таймлайном или слайдер. Ctrl/Cmd + колесо — зум к позиции курсора. Горизонтальный свайп трекпада — прокрутка.',
  },
  {
    part: 2,
    id: 'playback',
    target: '.playback-row',
    placement: 'right',
    title: '▶ Воспроизведение',
    text: 'Play или Пробел — воспроизведение начнётся с метки Start и остановится на End. Слайдер справа — скорость от 0.1x до 2x.',
  },
  {
    part: 2,
    id: 'segments',
    target: '.segment-editor',
    placement: 'right',
    title: '✂️ Создание фрагмента',
    text: 'Выделите кусок ползунками, введите имя файла и нажмите «+ Добавить фрагмент». Можно создать сколько угодно фрагментов на одной анимации, а потом экспортировать их одним ZIP-архивом.',
  },
  {
    part: 2,
    id: 'done2',
    title: '🎉 Готово!',
    text: 'Теперь вы знаете всё, что нужно. Если что-то забудете — нажмите «?» в шапке панели, туториал запустится снова.',
  },
];

// ---------------------------------------------------------------------------
// Внутреннее состояние
// ---------------------------------------------------------------------------
let currentSteps = [];
let currentStep = 0;
let currentPart = null;
let overlay = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Показать туториал.
 * @param {1|2|'all'} part — какую часть показать.
 */
export function showTutorial(part = 'all') {
  if (part === 'all') {
    // Если файл загружен — показываем всё. Иначе — только часть 1.
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

  // Дополнительная фильтрация: если target невидим — пропускаем шаг
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

/**
 * Вызывается один раз при старте приложения.
 * Показывает часть 1, если она ещё не была просмотрена.
 */
export function maybeShowTutorialOnFirstLaunch() {
  try {
    if (!localStorage.getItem(KEY_P1)) {
      setTimeout(() => showTutorial(1), 500);
    }
  } catch (_) {}
}

/**
 * Вызывается из file-loader.js после успешной загрузки файла.
 * Если часть 1 уже пройдена, а часть 2 — нет, автоматически показывает часть 2.
 */
export function onFileLoaded() {
  try {
    const p1 = localStorage.getItem(KEY_P1);
    const p2 = localStorage.getItem(KEY_P2);
    if (p1 && !p2) {
      setTimeout(() => showTutorial(2), 600);
    }
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Внутренние функции
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
  overlay.innerHTML = `
    <div class="tutorial-spotlight" id="tutSpotlight"></div>
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

  window.addEventListener('resize', renderStep);
  window.addEventListener('keydown', tutorialKeyHandler);
}

function tutorialKeyHandler(e) {
  if (e.key === 'Escape') closeTutorial();
  else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    if (currentStep < currentSteps.length - 1) { currentStep++; renderStep(); }
    else closeTutorial();
  } else if (e.key === 'ArrowLeft') {
    if (currentStep > 0) { currentStep--; renderStep(); }
  }
}

function closeTutorial() {
  // Запоминаем, что соответствующая часть просмотрена
  try {
    if (currentPart === 1 || currentPart === 'all') localStorage.setItem(KEY_P1, '1');
    if (currentPart === 2 || currentPart === 'all') localStorage.setItem(KEY_P2, '1');
  } catch (_) {}

  window.removeEventListener('resize', renderStep);
  window.removeEventListener('keydown', tutorialKeyHandler);
  if (overlay) { overlay.remove(); overlay = null; }
}

function renderStep() {
  if (!overlay) return;

  const step = currentSteps[currentStep];
  if (!step) return closeTutorial();

  const spotlight = document.getElementById('tutSpotlight');
  const tooltip = document.getElementById('tutTooltip');
  const counter = document.getElementById('tutStepCounter');

  counter.textContent = `${currentStep + 1} / ${currentSteps.length}`;
  document.getElementById('tutTitle').textContent = step.title;
  document.getElementById('tutText').textContent = step.text;

  document.getElementById('tutPrev').style.visibility = currentStep === 0 ? 'hidden' : 'visible';
  document.getElementById('tutNext').textContent =
    currentStep === currentSteps.length - 1 ? 'Начать!' : 'Далее →';

  // -------------------------------------------------------------------------
  // Режим "только затемнение" (первый/последний шаг или невидимый target)
  // -------------------------------------------------------------------------
  const isBackdropMode = !step.target;
  const el = step.target ? document.querySelector(step.target) : null;

  if (isBackdropMode || !el || !isElementVisible(el)) {
    // Спотлайт 0×0 в позиции (0,0) — box-shadow покрывает весь экран
    spotlight.style.display = 'block';
    spotlight.style.left = '-1px';
    spotlight.style.top = '-1px';
    spotlight.style.width = '0px';
    spotlight.style.height = '0px';
    spotlight.style.border = 'none';
    spotlight.style.borderRadius = '0';

    tooltip.classList.add('centered');
    tooltip.style.left = '';
    tooltip.style.top = '';
    return;
  }

  // -------------------------------------------------------------------------
  // Обычный режим с подсветкой
  // -------------------------------------------------------------------------
  tooltip.classList.remove('centered');

  const rect = el.getBoundingClientRect();
  const pad = 8;

  // Спотлайт
  spotlight.style.display = 'block';
  spotlight.style.left = `${rect.left - pad}px`;
  spotlight.style.top = `${rect.top - pad}px`;
  spotlight.style.width = `${rect.width + pad * 2}px`;
  spotlight.style.height = `${rect.height + pad * 2}px`;
  spotlight.style.border = '2px solid #7c5cff';
  spotlight.style.borderRadius = '10px';

  // Тултип — нужно сначала измерить его высоту, поэтому временно показываем
  tooltip.style.left = '0px';
  tooltip.style.top = '0px';

  const ttRect = tooltip.getBoundingClientRect();
  const gap = 16;
  let left = 0;
  let top = 0;
  const placement = step.placement || 'right';

  if (placement === 'right') {
    left = rect.right + gap;
    top = rect.top + rect.height / 2 - ttRect.height / 2;
    if (left + ttRect.width > window.innerWidth - 16) {
      left = rect.left - gap - ttRect.width;
    }
  } else if (placement === 'left') {
    left = rect.left - gap - ttRect.width;
    if (left < 16) left = rect.right + gap;
    top = rect.top + rect.height / 2 - ttRect.height / 2;
  } else if (placement === 'bottom') {
    left = rect.left + rect.width / 2 - ttRect.width / 2;
    top = rect.bottom + gap;
  }

  left = Math.max(16, Math.min(left, window.innerWidth - ttRect.width - 16));
  top = Math.max(16, Math.min(top, window.innerHeight - ttRect.height - 16));

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}