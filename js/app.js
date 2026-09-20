// ============================================================================
// app.js — точка входа. Инициализация и главный animate-цикл.
// ============================================================================

import { scene, camera, renderer, controls, clock } from './three-scene.js';
import { setupResizer } from './resizer.js';
import { setupFileLoader } from './file-loader.js';
import { setupPlayback, tickPlayback } from './playback.js';
import { setupTimeline } from './timeline.js';
import { setupSegments } from './segments.js';
import { setupExporter } from './exporter.js';

// --- Setup всех модулей ---
setupResizer();
setupFileLoader();
setupPlayback();
setupTimeline();
setupSegments();
setupExporter();

// --- Главный цикл ---
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  tickPlayback(clock.getDelta());
  renderer.render(scene, camera);
}
animate();