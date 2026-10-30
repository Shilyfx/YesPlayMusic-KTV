const assert = require('assert');
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const sass = require('sass');
const { compileStyle } = require('@vue/component-compiler-utils');
const compiler = require('vue-template-compiler');

const root = path.resolve(__dirname, '..');

function readVue(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const component = compiler.parseComponent(source, { pad: 'line' });
  assert.ok(component.template, `${relativePath} has a template`);
  const compiled = compiler.compile(component.template.content);
  assert.deepStrictEqual(
    compiled.errors,
    [],
    `${relativePath} template compiles`
  );
  const styles = component.styles.map((block, index) => {
    const css = sass.compileString(block.content, {
      syntax:
        block.lang === 'scss'
          ? 'scss'
          : block.lang === 'sass'
          ? 'indented'
          : 'css',
    }).css;
    const scoped = compileStyle({
      source: css,
      filename,
      id: `data-v-overlay-contract-${index}`,
      scoped: Boolean(block.scoped),
    });
    assert.deepStrictEqual(
      scoped.errors,
      [],
      `${relativePath} scoped CSS compiles`
    );
    return { css, scoped: scoped.code };
  });
  const style = styles.map(block => block.css).join('\n');
  const scopedStyle = styles.map(block => block.scoped).join('\n');
  return {
    ast: compiled.ast,
    source,
    template: component.template.content,
    style,
    scopedStyle,
  };
}

function walk(node, visit, parent = null, seen = new Set()) {
  if (!node || seen.has(node)) return;
  seen.add(node);
  visit(node, parent);
  (node.children || []).forEach(child => walk(child, visit, node, seen));
  (node.ifConditions || []).forEach(condition => {
    if (condition.block !== node) walk(condition.block, visit, parent, seen);
  });
}

function findNode(ast, predicate, message) {
  let found = null;
  walk(ast, node => {
    if (!found && predicate(node)) found = node;
  });
  assert.ok(found, message);
  return found;
}

function parentOf(ast, target) {
  let parent = null;
  walk(ast, (node, candidateParent) => {
    if (node === target) parent = candidateParent;
  });
  return parent;
}

function hasClass(node, className) {
  return (node.attrsMap?.class || '').split(/\s+/).includes(className);
}

function findRule(style, selector) {
  let declarations = null;
  postcss.parse(style).walkRules(rule => {
    if (rule.selector !== selector || declarations) return;
    declarations = {};
    rule.walkDecls(decl => {
      declarations[decl.prop] = decl.value;
    });
  });
  assert.ok(declarations, `CSS rule ${selector} exists`);
  return declarations;
}

const overlay = readVue('src/components/karaoke/ReactionOverlay.vue');
const main = readVue('src/views/karaoke.vue');
const follower = readVue('src/views/karaokeWeb.vue');
const scene = readVue('src/components/karaoke/KaraokeLyricScene.vue');
const pvScene = readVue('src/components/karaoke/KaraokePvScene.vue');

const mainStage = findNode(
  main.ast,
  node => node.tag === 'section' && hasClass(node, 'stage'),
  'main lyric stage exists'
);
const mainOverlay = findNode(
  main.ast,
  node => node.tag === 'ReactionOverlay',
  'main reaction overlay exists'
);
const mainScene = findNode(
  main.ast,
  node => node.tag === 'KaraokeLyricScene',
  'main lyric scene exists'
);
assert.strictEqual(parentOf(main.ast, mainOverlay), mainStage);
assert.strictEqual(parentOf(main.ast, mainScene), mainStage);
assert.match(main.source, /const target = this\.\$refs\.lyricStage/);
assert.match(main.source, /const target = this\.\$refs\.karaokeSurface/);

const followerRoot = findNode(
  follower.ast,
  node => node.tag === 'section' && hasClass(node, 'display-screen'),
  'follower display root exists'
);
const followerOverlay = findNode(
  follower.ast,
  node => node.tag === 'ReactionOverlay',
  'follower reaction overlay exists'
);
const followerStage = findNode(
  follower.ast,
  node => node.tag === 'main' && hasClass(node, 'display-stage'),
  'follower lyric stage exists'
);
assert.strictEqual(parentOf(follower.ast, followerOverlay), followerRoot);
assert.strictEqual(parentOf(follower.ast, followerStage), followerRoot);
assert.match(follower.source, /this\.\$refs\.screen\.requestFullscreen/);

const reactionLayer = findRule(overlay.style, '.reaction-layer');
const lyricSceneShell = findRule(scene.style, '.lyric-stage-shell');
const pvRenderer = findRule(pvScene.style, '.lyric-scene.pv-scene');
const mainLyricShell = findRule(
  main.style,
  '.stage ::v-deep .lyric-stage-shell'
);
const mainLyricStage = findRule(main.style, '.stage');
const followerRootStyle = findRule(follower.style, '.display-screen');
const followerLyricStage = findRule(follower.style, '.display-stage');
assert.equal(reactionLayer.position, 'absolute');
assert.equal(reactionLayer.inset, '0');
assert.equal(reactionLayer['z-index'], '2');
assert.equal(reactionLayer['pointer-events'], 'none');
assert.equal(lyricSceneShell.isolation, 'isolate');
assert.equal(pvRenderer.isolation, 'isolate');
assert.equal(mainLyricShell['z-index'], '1');
assert.match(
  main.scopedStyle,
  /\.stage\[data-v-overlay-contract-\d+\]\s+\.lyric-stage-shell\s*\{\s*z-index:\s*1;/s
);
assert.equal(mainLyricStage.isolation, 'isolate');
assert.equal(followerRootStyle.position, 'fixed');
assert.equal(followerLyricStage['z-index'], '1');

const reactionDock = findRule(overlay.style, '.reaction-dock');
const reactionSettings = findRule(overlay.style, '.reaction-settings');
const reactionShot = findRule(overlay.style, '.reaction-shot');
const reactionMotion = findRule(overlay.style, '.reaction-motion');
assert.equal(reactionDock['pointer-events'], 'auto');
assert.equal(reactionSettings['pointer-events'], 'auto');
assert.equal(reactionMotion['pointer-events'], 'auto');
assert.equal(reactionShot['align-items'], 'center');
assert.equal(reactionShot['justify-content'], 'center');
assert.match(overlay.source, /position: 'bottom-left'/);
assert.match(overlay.template, /min="72"[\s\S]*max="260"/);
assert.match(overlay.template, /:key="shotKey"[\s\S]*class="reaction-shot"/);
assert.match(overlay.source, /this\.shotKey\+\+/);
assert.match(overlay.source, /this\.\$refs\.shot\?\.perform\(action\)/);
assert.match(
  overlay.style,
  /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.reaction-shot\.ready\s+\.reaction-motion\s*\{[^}]*animation:\s*none\s*!important;[^}]*opacity:\s*1;[^}]*transform:\s*none;/
);

console.log(
  'Reaction overlay fullscreen roots, local paint order, accessibility, center, size and replay contracts passed'
);
