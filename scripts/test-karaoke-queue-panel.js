const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const Vue = require('vue');
const babel = require('@babel/core');
const compiler = require('vue-template-compiler');
const postcss = require('postcss');
const sass = require('sass');

const root = path.resolve(__dirname, '..');
const componentPath = path.join(
  root,
  'src/components/karaoke/KaraokeQueuePanel.vue'
);
assert.ok(fs.existsSync(componentPath), 'queue panel component exists');

function readComponent(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const descriptor = compiler.parseComponent(source, { pad: 'line' });
  assert.ok(descriptor.template, `${filename} has a template`);
  assert.ok(descriptor.script, `${filename} has component options`);
  assert.ok(descriptor.styles.length, `${filename} has styles`);
  const compiled = compiler.compile(descriptor.template.content);
  assert.deepStrictEqual(compiled.errors, [], `${filename} template compiles`);
  return { source, descriptor };
}

function textContent(node) {
  if (!node) return '';
  return `${node.text || ''}${(node.children || []).map(textContent).join('')}`
    .replace(/\s+/g, ' ')
    .trim();
}

function visit(node, visitor) {
  if (!node) return;
  visitor(node);
  (node.children || []).forEach(child => visit(child, visitor));
}

function findNode(rootNode, predicate, label) {
  let found = null;
  visit(rootNode, node => {
    if (!found && predicate(node)) found = node;
  });
  assert.ok(found, `${label} is rendered`);
  return found;
}

function findButton(rootNode, label) {
  return findNode(
    rootNode,
    node => node.tag === 'button' && node.data.attrs['aria-label'] === label,
    `${label} action`
  );
}

function click(node, label) {
  assert.equal(node.tag, 'button', `${label} is a button`);
  assert.notEqual(node.data.attrs.disabled, true, `${label} is enabled`);
  assert.equal(
    typeof node.data.on.click,
    'function',
    `${label} can be clicked`
  );
  node.data.on.click({});
}

const { descriptor } = readComponent(componentPath);
const templateFunctions = compiler.compileToFunctions(
  descriptor.template.content
);
const scriptModule = new Module(componentPath, module);
scriptModule.filename = componentPath;
scriptModule.paths = Module._nodeModulePaths(path.dirname(componentPath));
const transformedScript = babel.transform(descriptor.script.content, {
  filename: componentPath,
  plugins: ['@babel/plugin-transform-modules-commonjs'],
});
scriptModule._compile(transformedScript.code, componentPath);
const QueuePanel = Vue.extend({
  ...scriptModule.exports.default,
  ...templateFunctions,
});

function mountPanel(propsData) {
  return new QueuePanel({ propsData });
}

const queue = [
  {
    queueItemId: 'queue-1',
    trackName: '第一首',
    artists: ['歌手甲'],
    requesterName: '来宾甲',
  },
  {
    queueItemId: 'queue-2',
    trackName: '第二首',
    artists: ['歌手乙', '歌手丙'],
    requesterName: '来宾乙',
  },
];
const active = mountPanel({
  currentItem: {
    queueItemId: 'current-1',
    trackName: '正在唱',
    artists: ['主唱'],
    requesterName: '主持人',
  },
  waitingItems: queue,
  isSessionActive: true,
});
const activeTree = active._render();
assert.match(textContent(activeTree), /等待队列/);
assert.match(textContent(activeTree), /2 首待唱/);
assert.match(textContent(activeTree), /正在唱/);
assert.match(textContent(activeTree), /主唱 · 主持人/);
assert.match(textContent(activeTree), /第一首/);
assert.match(textContent(activeTree), /歌手乙 \/ 歌手丙 · 来宾乙/);

const queueNumbers = [];
visit(activeTree, node => {
  if (node.data && node.data.staticClass === 'queue-number')
    queueNumbers.push(textContent(node));
});
assert.deepStrictEqual(queueNumbers, ['01', '02']);

const firstTop = findButton(activeTree, '置顶 第一首');
const firstUp = findButton(activeTree, '上移 第一首');
const secondDown = findButton(activeTree, '下移 第二首');
assert.equal(firstTop.data.attrs.disabled, true);
assert.equal(firstUp.data.attrs.disabled, true);
assert.equal(secondDown.data.attrs.disabled, true);

const emitted = [];
[
  'move-queue-item-to-front',
  'move-queue-item',
  'remove-queue-item',
  'clear-waiting-queue',
].forEach(event =>
  active.$on(event, (...args) => emitted.push({ event, args }))
);

click(findButton(activeTree, '置顶 第二首'), 'move item to front');
click(findButton(activeTree, '上移 第二首'), 'move item up');
click(findButton(activeTree, '下移 第一首'), 'move item down');
click(findButton(activeTree, '删除 第二首'), 'remove queue item');
const clearButton = findNode(
  activeTree,
  node => node.data && node.data.staticClass === 'clear-waiting',
  'clear queue action'
);
click(clearButton, 'clear queue');
assert.deepStrictEqual(emitted, [
  { event: 'move-queue-item-to-front', args: ['queue-2'] },
  { event: 'move-queue-item', args: ['queue-2', 0] },
  { event: 'move-queue-item', args: ['queue-1', 1] },
  { event: 'remove-queue-item', args: ['queue-2'] },
  { event: 'clear-waiting-queue', args: [] },
]);
active.$destroy();

const emptyActive = mountPanel({
  currentItem: null,
  waitingItems: [],
  isSessionActive: true,
});
const emptyActiveTree = emptyActive._render();
assert.match(textContent(emptyActiveTree), /还没有待唱歌曲/);
assert.doesNotMatch(textContent(emptyActiveTree), /正在演唱/);
assert.doesNotMatch(textContent(emptyActiveTree), /清空待唱/);
emptyActive.$destroy();

const emptyInactive = mountPanel({
  currentItem: null,
  waitingItems: [],
  isSessionActive: false,
});
assert.match(textContent(emptyInactive._render()), /KTV 尚未开始/);
emptyInactive.$destroy();

const viewPath = path.join(root, 'src/views/karaoke.vue');
const { source: viewSource, descriptor: viewDescriptor } =
  readComponent(viewPath);
assert.match(
  viewSource,
  /import KaraokeQueuePanel from '@\/components\/karaoke\/KaraokeQueuePanel\.vue';/
);
assert.match(viewSource, /KaraokeQueuePanel,/);
assert.match(viewDescriptor.template.content, /<KaraokeQueuePanel\b/);
[
  ':current-item="currentItem"',
  ':waiting-items="waitingItems"',
  ':is-session-active="isSessionActive"',
  '@move-queue-item-to-front="moveQueueItemToFront"',
  '@move-queue-item="moveQueueItem"',
  '@remove-queue-item="removeQueueItem"',
  '@clear-waiting-queue="clearWaitingQueue"',
].forEach(binding =>
  assert.ok(
    viewDescriptor.template.content.includes(binding),
    `karaoke view forwards ${binding}`
  )
);
assert.doesNotMatch(
  viewDescriptor.template.content,
  /<aside class="queue-panel glass-panel">/
);

function compileStyles(styles, filename) {
  return styles.map(style =>
    postcss.parse(
      sass.compileString(style.content, {
        syntax:
          style.lang === 'sass'
            ? 'indented'
            : style.lang === 'scss'
            ? 'scss'
            : 'css',
      }).css,
      { from: filename }
    )
  );
}

function ruleDeclarations(styles, selector) {
  let declarations = null;
  styles.forEach(rootNode =>
    rootNode.walkRules(rule => {
      if (rule.selector !== selector || rule.parent.type !== 'root') return;
      declarations = declarations || {};
      rule.walkDecls(declaration => {
        declarations[declaration.prop] = `${declaration.value}${
          declaration.important ? ' !important' : ''
        }`;
      });
    })
  );
  assert.ok(declarations, `style rule ${selector} exists`);
  return declarations;
}

function mediaRuleDeclarations(styles, condition, selector) {
  let declarations = null;
  styles.forEach(rootNode =>
    rootNode.walkAtRules('media', media => {
      if (media.params !== condition) return;
      media.walkRules(rule => {
        if (!rule.selector.split(',').some(part => part.trim() === selector))
          return;
        declarations = {};
        rule.walkDecls(declaration => {
          declarations[declaration.prop] = `${declaration.value}${
            declaration.important ? ' !important' : ''
          }`;
        });
      });
    })
  );
  assert.ok(
    declarations,
    `${selector} exists in ${condition} responsive styles`
  );
  return declarations;
}

const componentStyles = compileStyles(descriptor.styles, componentPath);
const viewStyles = compileStyles(viewDescriptor.styles, viewPath);
const componentRoot = ruleDeclarations(componentStyles, '.queue-panel');
assert.equal(componentRoot.padding, '24px');
assert.equal(componentRoot['min-width'], '0');
assert.equal(
  ruleDeclarations(componentStyles, '.eyebrow')['font-size'],
  '11px'
);
assert.equal(
  ruleDeclarations(componentStyles, '.panel-title h2')['margin-top'],
  '0'
);
const gridPlacement = ruleDeclarations(
  viewStyles,
  '.karaoke-layout > .queue-panel'
);
assert.equal(gridPlacement['grid-column'], '2');
assert.equal(gridPlacement['grid-row'], '2');
assert.equal(gridPlacement['overflow-y'], 'auto');
assert.equal(
  ruleDeclarations(componentStyles, '.waiting-list')['max-height'],
  '48vh'
);
assert.equal(
  mediaRuleDeclarations(
    componentStyles,
    '(max-width: 1100px)',
    '.waiting-list'
  )['max-height'],
  '260px'
);
assert.equal(
  mediaRuleDeclarations(componentStyles, '(max-width: 760px)', '.queue-panel')
    .order,
  '2'
);
assert.equal(
  mediaRuleDeclarations(
    componentStyles,
    '(min-width: 2560px)',
    '.queue-panel button'
  ).transition,
  'background-color 160ms ease, border-color 160ms ease, color 160ms ease'
);
assert.equal(
  mediaRuleDeclarations(
    componentStyles,
    '(prefers-reduced-motion: reduce)',
    '.queue-panel *'
  )['transition-duration'],
  '0.01ms !important'
);
assert.equal(
  ruleDeclarations(componentStyles, '.clear-waiting')['min-height'],
  '36px'
);
assert.equal(
  ruleDeclarations(componentStyles, '.queue-panel button:disabled').opacity,
  '0.45'
);
assert.equal(
  ruleDeclarations(componentStyles, '.queue-panel button:not(:disabled):hover')
    .transform,
  'translateY(-1px)'
);

process.stdout.write('Karaoke queue panel behavior and layout tests passed\n');
