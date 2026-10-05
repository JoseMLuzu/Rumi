import OBJECTS from './objects.json' with { type: 'json' };
export { OBJECTS };
// Footprints describe floor space, not the height of the visual model.
export const FURNITURE_CATALOG = {
  ...OBJECTS,
  bed: {
    label: 'Bed',
    description: 'A soft place to land',
    width: 2.2,
    depth: 3.2,
    color: '#9fae95',
  },
  chair: {
    label: 'Chair',
    description: 'Pull up a seat',
    width: 0.95,
    depth: 1.05,
    color: '#bd8867',
  },
  table: {
    label: 'Table',
    description: 'For slow mornings',
    width: 1.8,
    depth: 1.4,
    color: '#bd8867',
  },
  bookTable: {
    label: 'Book table',
    description: 'The living room’s book and stand',
    width: 1.8,
    depth: 1.4,
    color: '#896447',
  },
  sofa: {
    label: 'Sofa',
    description: 'Stay a little longer',
    width: 2.7,
    depth: 1.15,
    color: '#d9a092',
  },
  plant: {
    label: 'Plant',
    description: 'A little more green',
    width: 0.8,
    depth: 0.8,
    color: '#70866a',
  },
  lamp: {
    label: 'Lamp',
    description: 'A warm evening glow',
    width: 0.65,
    depth: 0.65,
    color: '#e7c98e',
  },
  poolDoll: {
    label: 'Pool doll',
    description: 'A playful poolside guest',
    width: 1.1,
    depth: 0.45,
    color: '#19b5bf',
  },
  chaiseLongue: {
    label: 'Burgundy chaise longue',
    description: 'A cozy spot to unwind',
    width: 2.05,
    depth: 0.85,
    color: '#9a405b',
  },
};

export const STARTER_LAYOUT = [
  { id: 'starter-bed', type: 'bed', position: [-3.2, 0, -2.7], rotation: 0 },
  { id: 'starter-sofa', type: 'sofa', position: [2.6, 0, -3.6], rotation: 0 },
  { id: 'starter-table', type: 'table', position: [2.6, 0, -1.65], rotation: 0 },
  { id: 'starter-chair', type: 'chair', position: [2.6, 0, 0.1], rotation: Math.PI },
  { id: 'starter-plant', type: 'plant', position: [-3.6, 0, 3.7], rotation: 0 },
  { id: 'starter-lamp', type: 'lamp', position: [4.45, 0, -3.4], rotation: 0 },
];
