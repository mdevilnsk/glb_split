// ============================================================================
// tutorial.js — пошаговый обучающий оверлей
// ============================================================================

import { dom } from './state.js';

const STORAGE_KEY = 'glb-editor-tutorial-seen-v1';

const STEPS = [
  {
    title: '👋 Добро пожаловать!',
    text: 'Это редактор GLB-анимаций. Он работает полностью в браузере — файлы не отправляются на сервер. Покажу за 30 секунд, как им пользоваться.',
    target: null,
  },
  {
    title: '📦 Загрузка файла',
    text: 'Перетащите .glb или .gltf сюда, либо нажмите на эту область. После загрузки модель появится слева в 3D-вьюпорте.',
    target: '#dropzone',
    placement: 'right',
  },
  {
    title: '🎬 Выбор анимации',
    text: 'Список всех анимаций из файла. Кликните по нужной — она подгрузится в таймлайн, а модель примет позу первого кадра.',
    target: '#animations',
    placement: 'right',
  },
  {
    title: '⏱ Таймлайн',
    text: 'Красная линия — Playhead, показывает текущий кадр. Тяните её мышкой, чтобы промотать анимацию вручную. Синие метки ◀ ▶ — начало и конец выделения.',
    target: '#timelineScroll',
    placement: 'right',
  },
  {
    title: '🔍 Зум',
    text: 'Зум от 1x до 20x. Крутите колесо мышки прямо над таймлайном или используйте слайдер. Ctrl+колесо — зум к позиции курсора. Горизонтальный скролл трекпада — прокрутка.',
    target: '.zoom-row',
    placement: 'right',
  },
  {
    title: '▶ Воспроизведение',
    text: 'Кнопка Play или клавиша Пробел — воспроизведение начнётся с метки Start и остановится на End. Слайдер справа — скорость (0.1x–2x).',
    target: '.playback-row',
    placement: 'right',
  },
  {
    title: '✂️ Создание фрагмента',
    text: 'Выделите нужный кусок ползунками на таймлайне, введите имя файла и нажмите «+ Добавить фрагмент». Можно создать сколько угодно фрагментов на одной анимации.',
    target: '.segment-editor',
    placement: 'right',
  },
  {
    title: '💾 Экспорт',
    text: '«Экспортировать все в ZIP» — скачает каждый фрагмент отдельным .glb. «Скачать модель без анимаций» — получите чистый риг со скелетом.',
    target: '.sidebar-footer',
    placement: 'left',
  },
  {
    title: '🎉 Готово!',
    text: 'Открывайте файл и начинайте. Если что-то забудете — нажмите на «?» в шапке панели, туториал запустится снова.',
    target: null,
  },
];

let currentStep = 0;
let overlay = null;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
export function showTutorial() {
  currentStep = 0;
  createOverlay();
  renderStep();
}

export function maybeShowTutorialOnFirstLaunch() {
  try {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setTimeout(showTutorial, 400);
      localStorage.setItem(STORAGE_KEY, '1');
    }
  } catch (_) {
    // localStorage может быть выключен — просто игнорируем
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------
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
    if (currentStep < STEPS.length - 1) { currentStep++; renderStep(); }
    else closeTutorial();
  });

  window.addEventListener('resize', renderStep);
  window.addEventListener('keydown', tutorialKeyHandler);
}

function tutorialKeyHandler(e) {
  if (e.key === 'Escape') closeTutorial();
  else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    if (currentStep < STEPS.length - 1) { currentStep++; renderStep(); }
    else closeTutorial();
  } else if (e.key === 'ArrowLeft') {
    if (currentStep > 0) { currentStep--; renderStep(); }
  }
}

function closeTutorial() {
  window.removeEventListener('resize', renderStep);
  window.removeEventListener('keydown', tutorialKeyHandler);
  if (overlay) { overlay.remove(); overlay = null; }
}

function renderStep() {
  if (!overlay) return;

  const step = STEPS[currentStep];
  const spotlight = document.getElementById('tutSpotlight');
  const tooltip = document.getElementById('tutTooltip');
  const counter = document.getElementById('tutStepCounter');

  counter.textContent = `${currentStep + 1} / ${STEPS.length}`;

  document.getElementById('tutTitle').textContent = step.title;
  document.getElementById('tutText').textContent = step.text;

  // Кнопка "Назад" активна со второго шага
  document.getElementById('tutPrev').style.visibility = currentStep === 0 ? 'hidden' : 'visible';
  // На последнем шаге — "Завершить"
  document.getElementById('tutNext').textContent =
    currentStep === STEPS.length - 1 ? 'Начать!' : 'Далее →';

  // Центральный шаг без подсветки
  if (!step.target) {
    spotlight.style.display = 'none';
    tooltip.classList.add('centered');
    tooltip.style.left = '';
    tooltip.style.top = '';
    return;
  }

  spotlight.style.display = 'block';
  tooltip.classList.remove('centered');

  const el = document.querySelector(step.target);
  if (!el) {
    // Элемент ещё не отрисован — показываем тултип по центру
    spotlight.style.display = 'none';
    tooltip.classList.add('centered');
    return;
  }

  const rect = el.getBoundingClientRect();
  const pad = 8;

  // Позиционируем spotlight
  spotlight.style.left = `${rect.left - pad}px`;
  spotlight.style.top = `${rect.top - pad}px`;
  spotlight.style.width = `${rect.width + pad * 2}px`;
  spotlight.style.height = `${rect.height + pad * 2}px`;

  // Позиционируем tooltip
  const ttRect = tooltip.getBoundingClientRect();
  const gap = 16;
  let left = 0;
  let top = 0;

  const placement = step.placement || 'right';

  if (placement === 'right') {
    left = rect.right + gap;
    top = rect.top + rect.height / 2 - ttRect.height / 2;
    // Если не влезает справа — ставим слева
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

  // Клампим внутри окна
  left = Math.max(16, Math.min(left, window.innerWidth - ttRect.width - 16));
  top = Math.max(16, Math.min(top, window.innerHeight - ttRect.height - 16));

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}