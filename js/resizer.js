// ============================================================================
// resizer.js — перетаскивание границы панели
// ============================================================================

import { dom } from './state.js';
import { resizeViewport } from './three-scene.js';

export function setupResizer() {
  let isResizing = false;

  dom.resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    dom.resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = window.innerWidth - e.clientX;
    const clampedWidth = Math.max(340, Math.min(newWidth, Math.min(720, window.innerWidth - 200)));
    dom.sidebar.style.width = clampedWidth + 'px';
    resizeViewport();
  });

  window.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    dom.resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}