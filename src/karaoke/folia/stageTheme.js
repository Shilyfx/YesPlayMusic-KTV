export function createStageTheme(element, animationIntensity = 'normal') {
  const css = getComputedStyle(element);
  const color = (key, fallback) => css.getPropertyValue(key).trim() || fallback;
  return {
    name: 'LumaSing',
    fontStyle: 'sans',
    animationIntensity,
    backgroundColor: color('--ktv-bg-base', '#f4f3fa'),
    primaryColor: color('--ktv-text-primary', '#17152e'),
    accentColor: color('--ktv-accent', '#7655ff'),
    secondaryColor: color('--ktv-accent-strong', '#45359a'),
    lyricsIcons: ['Flower', 'Star', 'Sparkles', 'Music', 'Heart'],
  };
}
