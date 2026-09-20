// ============================================================================
// three-scene.js — сцена, камера, рендерер, свет, resize
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { dom } from './state.js';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

export const camera = new THREE.PerspectiveCamera(
  45,
  dom.viewport.clientWidth / dom.viewport.clientHeight,
  0.1,
  1000
);
camera.position.set(0, 1.5, 4);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(dom.viewport.clientWidth, dom.viewport.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
dom.viewport.appendChild(renderer.domElement);

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 1, 0);

export const clock = new THREE.Clock();

// --- Lights ---
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);
const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight2.position.set(-5, 5, -7);
scene.add(dirLight2);

// --- Grid ---
scene.add(new THREE.GridHelper(10, 20, 0x2d3139, 0x1e2128));

// --- Resize ---
export function resizeViewport() {
  const w = dom.viewport.clientWidth;
  const h = dom.viewport.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

window.addEventListener('resize', resizeViewport);
if (window.ResizeObserver) {
  new ResizeObserver(resizeViewport).observe(dom.viewport);
}