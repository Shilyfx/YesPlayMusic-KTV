import {
  getVisualModeMetadata,
  stageModeOptions,
} from '../karaoke/visualCatalog';

export { stageModeOptions };

export function isPvStageMode(mode) {
  const metadata = getVisualModeMetadata(mode);
  return Boolean(metadata && metadata.engine !== 'native');
}

export function supportsAnimationIntensity(mode) {
  const metadata = getVisualModeMetadata(mode);
  return Boolean(metadata && metadata.supportsIntensity);
}

export function normalizeStageMode(value) {
  return stageModeOptions.some(mode => mode.value === value)
    ? value
    : 'classic';
}
