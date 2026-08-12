export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const COLUMNS = 8;
export const ROWS = 9;
export const ATLAS_WIDTH = CELL_WIDTH * COLUMNS;
export const ATLAS_HEIGHT = CELL_HEIGHT * ROWS;

export const STATES = Object.freeze([
  { id: 'idle', frames: 6 },
  { id: 'running-right', frames: 8 },
  { id: 'running-left', frames: 8 },
  { id: 'waving', frames: 4 },
  { id: 'jumping', frames: 5 },
  { id: 'failed', frames: 8 },
  { id: 'waiting', frames: 6 },
  { id: 'running', frames: 6 },
  { id: 'review', frames: 6 },
]);

export const ACTIVE_FRAME_COUNT = STATES.reduce((sum, state) => sum + state.frames, 0);

export const DEFINITION_USAGE = Object.freeze([
  'hair',
  'face',
  'outfit',
  'palette',
  'identifying_features',
  'species_features',
  'weapon',
  'accessories',
  'dynamics',
  'directional',
]);
