// Keep the original stage as the default for existing and invalid settings.
export const stageModeOptions = Object.freeze([
  { value: 'classic', label: '经典 · 原有舞台' },
  { value: 'poem', label: '诗页 · 留白排版' },
  { value: 'depth', label: '纵深 · 透视镜头' },
  { value: 'orbit', label: '环轨 · 弧线叙事' },
]);

export function normalizeStageMode(value) {
  return stageModeOptions.some(mode => mode.value === value)
    ? value
    : 'classic';
}
