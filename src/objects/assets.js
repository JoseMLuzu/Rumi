import { OBJECTS } from '../data/furniture.js';
const images = import.meta.glob('../assets/interactive/*-initial.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
export function initialImageURL(type) {
  return images[`../assets/interactive/${OBJECTS[type]?.initialImage}`];
}
