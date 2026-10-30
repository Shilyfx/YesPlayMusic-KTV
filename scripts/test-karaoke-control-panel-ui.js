const assert = require('assert');
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const sass = require('sass');
const compiler = require('vue-template-compiler');

const root = path.resolve(__dirname, '..');

function readVueComponent(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const component = compiler.parseComponent(source, { pad: 'line' });
  assert.ok(component.template, `${relativePath} has a template`);
  assert.ok(component.styles.length, `${relativePath} has styles`);
  const result = compiler.compile(component.template.content);
  assert.deepStrictEqual(
    result.errors,
    [],
    `${relativePath} template compiles without errors`
  );
  component.styles.forEach(style => {
    sass.compileString(style.content, {
      syntax:
        style.lang === 'sass'
          ? 'indented'
          : style.lang === 'scss'
          ? 'scss'
          : 'css',
    });
  });
  return { template: component.template.content, styles: component.styles };
}

function styleBlock(styles, index = 0) {
  assert.ok(styles[index], `style block ${index} exists`);
  return styles[index].content;
}

function findCssRule(style, selector) {
  let declarations = null;
  postcss.parse(sass.compileString(style).css).walkRules(rule => {
    if (rule.selector !== selector) return;
    declarations = {};
    rule.walkDecls(declaration => {
      declarations[declaration.prop] = declaration.value;
    });
  });
  assert.ok(declarations, `CSS rule ${selector} exists`);
  return declarations;
}

function pixelValue(value, label) {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value || '');
  assert.ok(match, `${label} is a pixel dimension`);
  return Number(match[1]);
}

function assertSwitchThumbAlignment(style) {
  const track = findCssRule(style, '.ktv-switch');
  const thumb = findCssRule(style, '.ktv-switch > span');
  const activeThumb = findCssRule(style, '.ktv-switch.active > span');

  assert.equal(track.position, 'relative');
  assert.equal(track.padding, 'var(--ktv-switch-inset)');
  const inset = pixelValue(track['--ktv-switch-inset'], 'switch inset');
  const trackWidth = pixelValue(track.width, 'switch track width');
  const borderMatch = /^(\d+(?:\.\d+)?)px\s/.exec(track.border || '');
  assert.ok(borderMatch, 'switch border width is explicit');
  const borderWidth = Number(borderMatch[1]);
  assert.equal(thumb.position, 'absolute');
  const thumbSize = pixelValue(
    track['--ktv-switch-thumb-size'],
    'switch thumb size'
  );
  assert.equal(
    thumb.right,
    'calc(100% - var(--ktv-switch-thumb-size) - var(--ktv-switch-inset))'
  );
  assert.equal(activeThumb.right, 'var(--ktv-switch-inset)');
  assert.equal(activeThumb.transform, undefined);
  assert.match(thumb.transition, /right 160ms ease/);

  [
    { track: 1, geometry: 1 },
    { track: 1.1, geometry: 1 },
    { track: 0.75, geometry: 1 },
    { track: 1.1, geometry: 1.1 },
    { track: 1.5, geometry: 1.5 },
  ].forEach(({ track: trackScale, geometry: geometryScale }) => {
    const border = borderWidth * geometryScale;
    const padding = inset * geometryScale;
    const scaledTrackWidth = trackWidth * trackScale;
    const scaledThumbWidth = thumbSize * geometryScale;
    const activeRight = inset * geometryScale;
    const paddingBoxRight = border + scaledTrackWidth + padding * 2;
    const contentRight = border + padding + scaledTrackWidth;
    const thumbLeft = paddingBoxRight - activeRight - scaledThumbWidth;
    const thumbRight = thumbLeft + scaledThumbWidth;
    assert.equal(
      thumbRight,
      contentRight,
      `active thumb stays at the track's right content edge at ${trackScale}x track and ${geometryScale}x inset/thumb sizing`
    );
  });
}

function assertCollapsedDetails(template, className, label) {
  const escapedClass = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const details = new RegExp(
    `<details\\b(?=[^>]*\\bclass="${escapedClass}")([^>]*)>([\\s\\S]*?)<\\/details>`
  ).exec(template);
  assert.ok(details, `${label} uses native details`);
  assert.doesNotMatch(
    details[1],
    /(?:^|\s)open(?:\s|=|$)/,
    `${label} is collapsed by default`
  );
  assert.match(details[2], /<summary\b[^>]*>[\s\S]*?<\/summary>/);
  return details[2];
}

function assertInputBounds(style, selector, componentName) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = Array.from(
    style.matchAll(
      new RegExp(`${escapedSelector}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, 'gs')
    )
  );
  const declarations = [
    ['box-sizing', 'border-box'],
    ['min-width', '0'],
    ['max-width', '100%'],
  ];
  const rule = rules.find(({ 1: body }) =>
    declarations.every(([property, value]) =>
      new RegExp(`(?:^|;)\\s*${property}:\\s*${value}\\s*(?:;|$)`).test(body)
    )
  );
  assert.ok(
    rule,
    `${componentName} ${selector} sets border-box sizing and both width bounds`
  );
}

function assertFontSize(style, selector, value, componentName) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expected = new RegExp(
    `${escapedSelector}\\s*(?:,[^{}]*)?\\s*\\{[^}]*font-size:\\s*${value.replace(
      '.',
      '\\.'
    )}\\s*;`,
    's'
  );
  assert.ok(
    expected.test(style),
    `${componentName} ${selector} uses the increased ${value} type size`
  );
}

const panel = readVueComponent(
  'src/components/karaoke/KaraokeControlPanel.vue'
);
const tuning = readVueComponent(
  'src/components/karaoke/KaraokeVisualTuning.vue'
);
const panelTemplate = panel.template;
const panelStyle = styleBlock(panel.styles);
const tuningStyle = styleBlock(tuning.styles);

const randomSection =
  /<section\s+v-if="!isFollower"\s+class="ktv-random-style"[\s\S]*?<\/section>/.exec(
    panelTemplate
  );
assert.ok(randomSection, 'random style controls stay hidden for followers');
assert.match(randomSection[0], /aria-label="随机歌词样式"/);
assert.match(randomSection[0], /aria-label="随机样式范围"/);
const randomPoolDetails = assertCollapsedDetails(
  randomSection[0],
  'ktv-random-pool-details',
  'random style pool'
);
const randomPool =
  /<div\b(?=[^>]*\bclass="ktv-random-pool")[^>]*>[\s\S]*?<\/div>/.exec(
    randomPoolDetails
  );
assert.ok(randomPool, 'the random style pool remains visible');
assert.match(randomPool[0], /v-for="option in modeOptions"/);
assert.match(randomPool[0], /:checked="isInRandomPool\(option\.value\)"/);
assert.match(randomPool[0], /:disabled="isFollowLocked\('style'\)"/);
assert.match(
  randomPool[0],
  /toggleRandomPool\(option\.value, \$event\.target\.checked\)/
);
const modeTuningDetails = assertCollapsedDetails(
  panelTemplate,
  'ktv-mode-tuning',
  'display tuning'
);
const modeTuning = /<KaraokeVisualTuning\b[\s\S]*?\/>/.exec(modeTuningDetails);
assert.ok(modeTuning, 'display tuning remains connected to the panel');
assert.match(modeTuning[0], /:disabled="isFollowLocked\('style'\)"/);
assert.match(modeTuning[0], /@change="handleVisualTuningChange"/);
assert.match(modeTuning[0], /@asset="relayAsset"/);

const backgroundDetails = assertCollapsedDetails(
  panelTemplate,
  'ktv-background-tuning',
  'stage background tuning'
);
assert.match(backgroundDetails, /scope="background"/);
assert.match(backgroundDetails, /:disabled="isFollowLocked\('background'\)"/);
assert.match(backgroundDetails, /@asset="relayAsset"/);
assert.match(panelTemplate, /<KaraokeVisualPreview\b/);
assertSwitchThumbAlignment(panelStyle);
assert.match(panelTemplate, /<span class="ktv-field-label">跟随主屏幕<\/span>/);
assert.doesNotMatch(panelTemplate, /跟随主持人/);

assertInputBounds(
  panelStyle,
  '.ktv-control-panel input',
  'KaraokeControlPanel'
);
assertInputBounds(
  tuningStyle,
  '.ktv-visual-tuning input',
  'KaraokeVisualTuning'
);
assertFontSize(panelStyle, '.ktv-field-label', '12.1px', 'KaraokeControlPanel');
assertFontSize(
  panelStyle,
  '.ktv-collapsible-summary',
  '12.1px',
  'KaraokeControlPanel'
);
assertFontSize(
  panelStyle,
  '.ktv-track-copy .ktv-eyebrow',
  '11px',
  'KaraokeControlPanel'
);
assertFontSize(
  tuningStyle,
  '.ktv-tuning-field label',
  '0.902rem',
  'KaraokeVisualTuning'
);

process.stdout.write('Karaoke control panel UI regressions passed\n');
assert.equal(
  findCssRule(panelStyle, '.ktv-switch')['box-sizing'],
  'border-box'
);
assert.equal(findCssRule(panelStyle, '.ktv-switch > span').top, '50%');
assert.equal(
  findCssRule(panelStyle, '.ktv-switch > span').transform,
  'translateY(-50%)'
);
assert.ok(panel.template.includes('全部跟随主屏幕'));
