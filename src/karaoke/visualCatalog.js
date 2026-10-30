import metadata from './visualMetadata.json';

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  Object.keys(value).forEach(key => freezeTree(value[key]));
  return Object.freeze(value);
}

freezeTree(metadata);

const modesById = Object.create(null);
metadata.modes.forEach(mode => {
  modesById[mode.value] = mode;
});

const backgroundsById = Object.create(null);
metadata.backgrounds.forEach(background => {
  backgroundsById[background.value] = background;
});

export const visualMetadataSchemaVersion = metadata.schemaVersion;
export const visualMetadataSourceRevision = metadata.sourceRevision;

export const stageModeOptions = Object.freeze(
  metadata.modes.map(({ value, label }) => Object.freeze({ value, label }))
);

export const backgroundModeOptions = Object.freeze(
  metadata.backgrounds.map(({ value, label }) =>
    Object.freeze({ value, label })
  )
);

export function getVisualModeMetadata(mode) {
  return Object.prototype.hasOwnProperty.call(modesById, mode)
    ? modesById[mode]
    : null;
}

export function getVisualBackgroundMetadata(mode) {
  return Object.prototype.hasOwnProperty.call(backgroundsById, mode)
    ? backgroundsById[mode]
    : null;
}

export function cloneVisualValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
