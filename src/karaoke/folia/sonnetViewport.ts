import { Matrix } from 'pixi.js';
import type { ShotView } from '../../../vendor/folia-pv/src/components/visualizer/sonnet/sonnetSceneBuilder';
import { fitViewport } from './viewportFit';

// Only the current shot is measured. Core glyph bounds are cached: decorative
// oversized text, glow, echo ghosts and MG backgrounds must not drive the fit.
const records = new WeakMap<ShotView, any[]>();
const inverse = new Matrix();
const matrix = new Matrix();
const parentMatrix = new Matrix();
const origin = { x: 0, y: 0 };
export function sonnetLyricsBounds(view: ShotView) {
  let glyphs = records.get(view);
  if (!glyphs) {
    glyphs = view.segments
      .filter(segment => segment.role !== 'decoration')
      .flatMap(segment => segment.glyphs)
      .filter(glyph => glyph.isTextGlyph !== false && !glyph.isBackgroundShape)
      .map(glyph => {
        // The core is added last; preceding children are optional echo ghosts.
        const core = glyph.display.children.at(-1);
        const bounds = core?.getLocalBounds();
        return {
          glyph,
          core,
          bounds: bounds && {
            minX: bounds.minX,
            minY: bounds.minY,
            maxX: bounds.maxX,
            maxY: bounds.maxY,
          },
        };
      });
    records.set(view, glyphs);
  }
  const parent = view.container.parent;
  const root = parent?.parent;
  if (!root) return null;
  root.getGlobalTransform(inverse).invert();
  const result = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const { glyph, core, bounds } of glyphs) {
    if (
      !core ||
      !bounds ||
      !glyph.display.visible ||
      glyph.display.alpha <= 0.001
    )
      continue;
    core.getGlobalTransform(matrix).prepend(inverse);
    // Transform the four corners, including glyph/shot rotation and parallax.
    for (const x of [bounds.minX, bounds.maxX]) {
      for (const y of [bounds.minY, bounds.maxY]) {
        const px = matrix.a * x + matrix.c * y + matrix.tx;
        const py = matrix.b * x + matrix.d * y + matrix.ty;
        result.minX = Math.min(result.minX, px);
        result.maxX = Math.max(result.maxX, px);
        result.minY = Math.min(result.minY, py);
        result.maxY = Math.max(result.maxY, py);
      }
    }
  }
  return Number.isFinite(result.minX) ? result : null;
}

export function fitSonnetLyrics(view: ShotView, width: number, height: number) {
  const bounds = sonnetLyricsBounds(view);
  if (!bounds) return;
  // Bounds include the scene transition. Convert the correction back through
  // that transform so a tilted/zoomed parent cannot push the text out again.
  view.container.parent.getGlobalTransform(parentMatrix).prepend(inverse);
  parentMatrix.apply(view.container.position, origin);
  const fit = fitViewport(bounds, origin, width, height);
  view.container.scale.set(
    view.container.scale.x * fit.scale,
    view.container.scale.y * fit.scale
  );
  parentMatrix.invert();
  view.container.x += parentMatrix.a * fit.x + parentMatrix.c * fit.y;
  view.container.y += parentMatrix.b * fit.x + parentMatrix.d * fit.y;
}
