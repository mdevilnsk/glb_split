// ============================================================================
// state.js — общее мутируемое состояние + ссылки на DOM
// ============================================================================

export const state = {
  currentDocument: null,   // gltf-transform Document
  currentFileName: '',
  modelScene: null,        // THREE.Group
  mixer: null,             // THREE.AnimationMixer
  currentAction: null,     // THREE.AnimationAction
  currentClip: null,       // THREE.AnimationClip
  animations: [],          // AnimationClip[]
  segments: [],            // { id, name, start, end, _imported? }[]
  isPlaying: false,
  isScrubbing: false,
  dragTarget: null,        // 'start' | 'end' | 'playhead' | null
  isLoading: false,
  zoom: 1,
};

export const dom = {
  // Layout
  viewport:           document.getElementById('viewport'),
  dropzone:           document.getElementById('dropzone'),
  fileInput:          document.getElementById('fileInput'),
  sidebar:            document.getElementById('sidebar'),
  resizer:            document.getElementById('resizer'),

  // Animations
  animationsEl:       document.getElementById('animations'),
  timelineEl:         document.getElementById('timeline'),

  // Timeline
  timelineScroll:     document.getElementById('timelineScroll'),
  track:              document.getElementById('track'),
  rulerEl:            document.getElementById('ruler'),
  segmentsLayer:      document.getElementById('segmentsLayer'),
  selectionEl:        document.getElementById('selection'),
  handleStart:        document.getElementById('handleStart'),
  handleEnd:          document.getElementById('handleEnd'),
  playhead:           document.getElementById('playhead'),
  snapLine:           document.getElementById('snapLine'),

  // Time labels
  timeCurrent:        document.getElementById('timeCurrent'),
  timeDuration:       document.getElementById('timeDuration'),
  selDuration:        document.getElementById('selDuration'),

  // Playback
  playBtn:            document.getElementById('playBtn'),
  speedRange:         document.getElementById('speedRange'),
  speedValue:         document.getElementById('speedValue'),

  // Zoom
  zoomRange:          document.getElementById('zoomRange'),
  zoomValue:          document.getElementById('zoomValue'),
  zoomIn:             document.getElementById('zoomIn'),
  zoomOut:            document.getElementById('zoomOut'),
  zoomFit:            document.getElementById('zoomFit'),

  // Segment editor
  segStart:           document.getElementById('segStart'),
  segEnd:             document.getElementById('segEnd'),
  segName:            document.getElementById('segName'),
  addSegmentBtn:      document.getElementById('addSegmentBtn'),
  segmentsList:       document.getElementById('segmentsList'),
  segmentsCount:      document.getElementById('segmentsCount'),

  // Segment presets
  exportSegmentsBtn:  document.getElementById('exportSegmentsBtn'),
  importSegmentsBtn:  document.getElementById('importSegmentsBtn'),
  clearSegmentsBtn:   document.getElementById('clearSegmentsBtn'),
  importSegmentsInput:document.getElementById('importSegmentsInput'),

  // Actions
  exportBtn:          document.getElementById('exportBtn'),
  exportModelBtn:     document.getElementById('exportModelBtn'),
  clearBtn:           document.getElementById('clearBtn'),
  statusEl:           document.getElementById('status'),
};