// Keep the original resolver contract with a bounded icon vocabulary. We do not
// ship every icon in lucide's dynamic map to a karaoke display.
export default {
  flower: () => import('lucide-react/dist/esm/icons/flower.mjs'),
  star: () => import('lucide-react/dist/esm/icons/star.mjs'),
  sparkles: () => import('lucide-react/dist/esm/icons/sparkles.mjs'),
  music: () => import('lucide-react/dist/esm/icons/music.mjs'),
  heart: () => import('lucide-react/dist/esm/icons/heart.mjs'),
};
