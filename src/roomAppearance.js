import OPTIONS from './data/roomAppearance.json' with { type: 'json' };
export { OPTIONS as APPEARANCE_OPTIONS };

export const DEFAULT_APPEARANCE = Object.fromEntries(
  Object.entries(OPTIONS).map(([surface, options]) => [
    surface,
    {
      preset: options.default,
      color: options.presets[options.default].color,
      image: null,
      fit: 'cover',
      crop: [0.5, 0.5],
      repeat: 1,
    },
  ]),
);

export function validateAppearance(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3
  )
    throw new Error('The saved room style is invalid.');
  for (const [surface, options] of Object.entries(OPTIONS)) {
    const config = value[surface];
    if (
      !config ||
      !Object.hasOwn(options.presets, config.preset) ||
      !/^#[0-9a-fA-F]{6}$/.test(config.color) ||
      (config.image !== null && !/^\/api\/media\/[a-f0-9]{32}$/.test(config.image)) ||
      !(surface === 'background' ? ['cover', 'contain'] : ['cover', 'contain', 'tile']).includes(
        config.fit,
      ) ||
      !Array.isArray(config.crop) ||
      config.crop.length !== 2 ||
      !config.crop.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) ||
      !Number.isInteger(config.repeat) ||
      config.repeat < 1 ||
      config.repeat > 8
    ) {
      throw new Error('The saved room style is invalid.');
    }
  }
  return value;
}
