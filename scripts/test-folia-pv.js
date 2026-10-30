const assert = require('assert');
const path = require('path');
const Module = require('module');
const esbuild = require('esbuild');
require('./helpers/register-babel-src');
const { fitViewport } = require('../src/karaoke/folia/viewportFit');
// Exercise real Pixi parent transforms, not only axis-aligned arithmetic.
const guardFile = path.resolve('src/karaoke/folia/sonnetViewport.ts');
const guard = new Module(guardFile, module);
guard.paths = module.paths;
guard._compile(
  esbuild.buildSync({
    stdin: {
      contents:
        "export { Container, Graphics } from 'pixi.js'; export * from './sonnetViewport';",
      resolveDir: path.dirname(guardFile),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
  }).outputFiles[0].text,
  guardFile
);
const { Container, Graphics } = guard.exports;
for (const rotation of [0, 0.2, -0.4]) {
  const root = new Container(),
    scene = new Container(),
    shot = new Container();
  root.addChild(scene);
  scene.addChild(shot);
  scene.position.set(500, 250);
  scene.pivot.set(500, 250);
  scene.rotation = rotation;
  scene.scale.set(1.3);
  shot.position.set(-80, 100);
  shot.scale.set(2);
  const display = new Container();
  display.addChild(new Graphics().rect(-100, -50, 1800, 180).fill(0));
  shot.addChild(display);
  const view = {
    container: shot,
    segments: [{ role: 'hero', glyphs: [{ display, isTextGlyph: true }] }],
  };
  guard.exports.fitSonnetLyrics(view, 1000, 500);
  const b = guard.exports.sonnetLyricsBounds(view);
  assert.ok(
    b.minX >= 20 - 1e-6 &&
      b.maxX <= 980 + 1e-6 &&
      b.minY >= 20 - 1e-6 &&
      b.maxY <= 480 + 1e-6,
    'foreground must remain inside the viewport after real scene rotation/zoom'
  );
  root.destroy({ children: true });
}
for (const bounds of [
  { minX: -200, maxX: 1800, minY: 20, maxY: 500 },
  { minX: 1500, maxX: 1900, minY: -80, maxY: 1100 },
  { minX: -3000, maxX: 4000, minY: -2000, maxY: 3000 },
]) {
  const origin = { x: 800, y: 450 };
  const fit = fitViewport(bounds, origin, 1600, 900);
  const actual = {
    minX: origin.x + (bounds.minX - origin.x) * fit.scale + fit.x,
    maxX: origin.x + (bounds.maxX - origin.x) * fit.scale + fit.x,
    minY: origin.y + (bounds.minY - origin.y) * fit.scale + fit.y,
    maxY: origin.y + (bounds.maxY - origin.y) * fit.scale + fit.y,
  };
  assert.ok(actual.minX >= 36 - 1e-6 && actual.maxX <= 1564 + 1e-6);
  assert.ok(actual.minY >= 36 - 1e-6 && actual.maxY <= 864 + 1e-6);
  assert.ok(fit.scale <= 1);
}
assert.deepStrictEqual(
  fitViewport(
    { minX: 100, minY: 100, maxX: 1400, maxY: 800 },
    { x: 800, y: 450 },
    1600,
    900
  ),
  { scale: 1, x: 0, y: 0 },
  'camera and typography that already fit must remain unchanged'
);
const {
  toFoliaLines,
  createPvClock,
  memoizedPvDocument,
} = require('../src/karaoke/folia/timing');
const {
  isPvStageMode,
  normalizeStageMode,
} = require('../src/utils/lyricStageModes');

const input = {
  itemId: 'song',
  duration: 20,
  lines: [
    { time: 0, content: '你好 🌸' },
    { time: 0, content: 'Hello' },
    { time: 3, content: '下一行' },
    { time: 10, content: '最后一行' },
  ],
};
const before = JSON.stringify(input);
const memoized = memoizedPvDocument(input.itemId, input.duration, input.lines);
assert.strictEqual(
  memoizedPvDocument(input.itemId, input.duration, input.lines),
  memoized
);
assert.notStrictEqual(
  memoizedPvDocument('next-song', input.duration, input.lines),
  memoized,
  'same lyric array on a new song still requires a new document'
);
const lines = toFoliaLines(input);
assert.deepStrictEqual(
  lines.map(line => [line.startTime, line.endTime]),
  [
    [0, 3],
    [0, 3],
    [3, 10],
    [10, 20],
  ]
);
assert.equal(lines[0].fullText, '你好 🌸');
assert.equal(
  lines[0].words.length,
  1,
  'plain LRC must not invent authored syllable timing'
);
assert.equal(JSON.stringify(input), before);
const timingFile = path.resolve(
  'vendor/folia-pv/src/utils/lyrics/graphemeTiming.ts'
);
const timingModule = new Module(timingFile, module);
timingModule.paths = module.paths;
timingModule._compile(
  esbuild.buildSync({
    entryPoints: [timingFile],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
  }).outputFiles[0].text,
  timingFile
);
const timeline = timingModule.exports.buildLineGraphemeTimeline(lines[0]);
assert.ok(
  timeline.every(glyph => glyph.startTime === 0 && glyph.endTime === 3),
  'plain LRC glyphs must share the line cue, not acquire invented staggered timings'
);
assert.deepStrictEqual(lines[0].wordSegments, [input.lines[0].content]);
const authoredWords = [
  { text: '你好', startTime: 1, endTime: 2 },
  { text: '世界', startTime: 3, endTime: 4 },
];
const authoredLine = toFoliaLines({
  itemId: 'timed',
  duration: 5,
  lines: [{ time: 1, content: '你好世界', words: authoredWords }],
})[0];
assert.deepStrictEqual(
  authoredLine.words,
  authoredWords,
  'genuine word timestamps must remain unchanged'
);
assert.equal(authoredLine.wordSegments, undefined);
let now = 100;
const clock = createPvClock(() => now);
clock.set(12, true);
now += 250;
assert.equal(clock.get(), 12.25);
now += 10000;
assert.equal(
  clock.get(),
  12.5,
  'interpolation must stop when the host clock stalls'
);
clock.set(4, false);
now += 1000;
assert.equal(clock.get(), 4, 'paused seek remains fixed');
clock.set(40, true);
assert.equal(clock.get(), 40, 'seek replaces the prior anchor');

const document = {
  itemId: 'original-pv',
  duration: 180,
  lines: Array.from({ length: 32 }, (_, i) => ({
    time: i * 4 + 2,
    content: `第${i + 1}行歌词 今天也有光落在你的肩上`,
  })),
};
for (const mode of ['sonnet', 'tempera', 'hanabi']) {
  assert.equal(isPvStageMode(mode), true);
  assert.equal(normalizeStageMode(mode), mode);
  const filename = path.resolve(
    `vendor/folia-pv/src/components/visualizer/${mode}/${mode}Program.ts`
  );
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
  }).outputFiles[0].text;
  const loaded = new Module(filename, module);
  loaded.paths = module.paths;
  loaded._compile(output, filename);
  const title = mode[0].toUpperCase() + mode.slice(1);
  const compile = loaded.exports[`compile${title}Program`];
  const seek = loaded.exports[`find${title}ParagraphIndexAtTime`];
  const source = toFoliaLines(document);
  const program = compile(source, document.itemId);
  assert.ok(
    program.paragraphs.length > 1,
    `${mode} should compile multiple original scenes`
  );
  assert.deepStrictEqual(
    program,
    compile(source, document.itemId),
    `${mode} must be deterministic across screens`
  );
  const first = program.paragraphs[0];
  assert.equal(seek(program, first.startTime), 0);
  const last = program.paragraphs[program.paragraphs.length - 1];
  assert.equal(seek(program, last.startTime), program.paragraphs.length - 1);
  console.log(
    `${mode}: ${program.paragraphs.length} original paragraphs; deterministic and seek-safe`
  );
}
console.log(
  'Original Folia compiler, lyric timing and interpolation tests passed'
);
