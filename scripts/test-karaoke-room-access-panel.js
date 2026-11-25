const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const Vue = require('vue');
const babel = require('@babel/core');
const compiler = require('vue-template-compiler');

const root = path.resolve(__dirname, '..');
const componentPath = path.join(
  root,
  'src/components/karaoke/KaraokeRoomAccessPanel.vue'
);
assert.ok(fs.existsSync(componentPath), 'room access panel component exists');

const source = fs.readFileSync(componentPath, 'utf8');
const descriptor = compiler.parseComponent(source, { pad: 'line' });
assert.ok(descriptor.template, 'room access panel has a template');
assert.ok(descriptor.script, 'room access panel has component options');
const compiledTemplate = compiler.compileToFunctions(
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
const RoomAccessPanel = Vue.extend({
  ...scriptModule.exports.default,
  ...compiledTemplate,
});

function mountPanel(propsData) {
  return new RoomAccessPanel({ propsData });
}

function visit(node, visitor) {
  if (!node) return;
  visitor(node);
  (node.children || []).forEach(child => visit(child, visitor));
}

function textContent(node) {
  if (!node) return '';
  return `${node.text || ''}${(node.children || []).map(textContent).join('')}`;
}

function findNode(rootNode, predicate, label) {
  let found = null;
  visit(rootNode, node => {
    if (!found && predicate(node)) found = node;
  });
  assert.ok(found, `${label} is rendered`);
  return found;
}

function click(node, label) {
  assert.equal(node.tag, 'button', `${label} is a button`);
  assert.equal(
    typeof node.data.on.click,
    'function',
    `${label} can be clicked`
  );
  node.data.on.click({});
}

const candidates = [
  { address: '192.168.1.20', interfaceName: 'Wi-Fi' },
  { address: '10.0.0.8', interfaceName: 'Ethernet' },
];
const pending = mountPanel({
  lanRoom: null,
  lanCandidates: candidates,
  selectedLanAddress: '',
  lanSelfTest: 'idle',
  copyLinkLabel: '一键复制',
  copyBackupLinkLabel: '一键复制',
});
const pendingTree = pending._render();
assert.match(textContent(pendingTree), /选择对外网卡/);
assert.match(textContent(pendingTree), /Wi-Fi · 192\.168\.1\.20/);
assert.match(textContent(pendingTree), /Ethernet · 10\.0\.0\.8/);
const startButton = findNode(
  pendingTree,
  node => node.tag === 'button' && node.data.staticClass === 'generate-room',
  'room QR generation action'
);
assert.equal(startButton.data.attrs.disabled, true);
const addressSelect = findNode(
  pendingTree,
  node => node.tag === 'select',
  'network adapter selector'
);
let selectedAddress = '';
pending.$on('select-lan-address', value => {
  selectedAddress = value;
});
addressSelect.data.on.change({ target: { value: '10.0.0.8' } });
assert.equal(selectedAddress, '10.0.0.8');
pending.$destroy();

const ready = mountPanel({
  lanRoom: null,
  lanCandidates: candidates,
  selectedLanAddress: '192.168.1.20',
  lanSelfTest: 'idle',
  copyLinkLabel: '一键复制',
  copyBackupLinkLabel: '一键复制',
});
const readyTree = ready._render();
const enabledStartButton = findNode(
  readyTree,
  node => node.tag === 'button' && node.data.staticClass === 'generate-room',
  'enabled room QR generation action'
);
assert.notEqual(enabledStartButton.data.attrs.disabled, true);
let startRequested = false;
ready.$on('start-lan-room', () => {
  startRequested = true;
});
click(enabledStartButton, 'room QR generation action');
assert.equal(startRequested, true);
ready.$destroy();

const active = mountPanel({
  isElectron: false,
  lanRoom: {
    code: 'ABCD',
    qrDataUrl: 'data:image/png;base64,lan',
    publicQrDataUrl: 'data:image/png;base64,public',
    joinUrl: 'http://192.168.1.20/room/ABCD',
    backupJoinUrl: 'http://192.168.1.20/room/ABCD?ip=1',
    publicJoinUrl: 'https://ktv.example/room/ABCD',
    qrError: 'LAN QR warning',
  },
  lanCandidates: candidates,
  selectedLanAddress: '192.168.1.20',
  lanSelfTest: 'error',
  copyLinkLabel: '已复制',
  copyBackupLinkLabel: '一键复制',
});
const activeTree = active._render();
assert.match(textContent(activeTree), /用同一局域网设备扫码加入/);
assert.match(textContent(activeTree), /房间码 ABCD/);
assert.match(textContent(activeTree), /LAN QR warning/);
assert.match(textContent(activeTree), /当前网卡自检失败/);
assert.match(textContent(activeTree), /https:\/\/ktv\.example\/room\/ABCD/);
assert.match(textContent(activeTree), /公网点歌/);
const qrSources = [];
visit(activeTree, node => {
  if (node.tag === 'img') qrSources.push(node.data.attrs.src);
});
assert.deepEqual(qrSources, [
  'data:image/png;base64,lan',
  'data:image/png;base64,public',
]);

const emitted = [];
[
  'copy-lan-link',
  'copy-backup-link',
  'copy-public-link',
  'restart-lan-room',
  'retry-lan-qr',
  'self-test-lan',
].forEach(event => active.$on(event, () => emitted.push(event)));
const actions = [
  ['copy-lan-link', node => textContent(node).trim() === '已复制'],
  ['copy-backup-link', node => textContent(node).trim() === '一键复制'],
  ['copy-public-link', (node, index) => index === 2],
  [
    'restart-lan-room',
    node => textContent(node).trim() === '按当前网卡更新二维码',
  ],
  ['retry-lan-qr', node => textContent(node).trim() === '重试二维码'],
  ['self-test-lan', node => textContent(node).trim() === '检测当前网卡'],
];
const linkCopyButtons = [];
visit(activeTree, node => {
  if (node.tag === 'button' && node.data.staticClass === 'room-link-copy')
    linkCopyButtons.push(node);
});
actions.forEach(([event, selector], index) => {
  const button =
    index < 3
      ? linkCopyButtons.find((node, buttonIndex) => selector(node, buttonIndex))
      : findNode(
          activeTree,
          node => node.tag === 'button' && selector(node),
          event
        );
  assert.ok(button, `${event} action is rendered`);
  click(button, event);
  assert.equal(emitted[emitted.length - 1], event);
});
active.$destroy();

const publicSetup = mountPanel({
  isElectron: true,
  publicConfig: {
    gatewayOrigin: 'https://ktv.example',
    hostId: 'desktop-host',
    hasHostSecret: true,
  },
  lanRoom: null,
  lanCandidates: candidates,
  selectedLanAddress: '192.168.1.20',
});
const publicSetupTree = publicSetup._render();
assert.match(textContent(publicSetupTree), /公网房间连接/);
assert.match(textContent(publicSetupTree), /已保存主机密钥/);
const secretInput = findNode(
  publicSetupTree,
  node => node.tag === 'input' && node.data.attrs.type === 'password',
  'masked public host secret input'
);
assert.equal(secretInput.data.domProps.value, '');
const gatewayInput = findNode(
  publicSetupTree,
  node => node.tag === 'input' && node.data.attrs.type === 'url',
  'public gateway address input'
);
assert.equal(gatewayInput.data.domProps.value, 'https://ktv.example');
let savedPublicConfig = null;
publicSetup.$on('save-public-config', value => {
  savedPublicConfig = value;
});
publicSetup.$set(publicSetup, 'draftGatewayOrigin', 'https://public.example');
publicSetup.$set(publicSetup, 'draftHostId', 'host-next');
publicSetup.$set(publicSetup, 'draftHostSecret', '');
const saveConfigButton = findNode(
  publicSetupTree,
  node =>
    node.tag === 'button' &&
    node.data.staticClass.includes('save-public-config'),
  'public connection settings save action'
);
click(saveConfigButton, 'public connection settings save action');
assert.deepEqual(savedPublicConfig, {
  gatewayOrigin: 'https://public.example',
  hostId: 'host-next',
  hostSecret: '',
});
publicSetup.$destroy();

const activePublicSetup = mountPanel({
  isElectron: true,
  publicConfig: {
    gatewayOrigin: 'https://ktv.shilyfx.icu',
    hostId: 'desktop-host',
    hasHostSecret: true,
  },
  lanRoom: {
    code: 'LIVE',
    publicJoinUrl: 'https://ktv.shilyfx.icu/r/live/room/',
    publicStatus: 'connected',
  },
});
const activePublicSetupTree = activePublicSetup._render();
assert.match(textContent(activePublicSetupTree), /下次开启房间时生效/);
assert.match(textContent(activePublicSetupTree), /当前房间的连接保持不变/);
const activeSaveButton = findNode(
  activePublicSetupTree,
  node =>
    node.tag === 'button' &&
    node.data.staticClass.includes('save-public-config'),
  'active room public settings save action'
);
assert.notEqual(activeSaveButton.data.attrs.disabled, true);
const clearSecretButton = findNode(
  activePublicSetupTree,
  node => node.tag === 'button' && textContent(node).includes('清除已保存密钥'),
  'active room saved secret clear action'
);
assert.notEqual(clearSecretButton.data.attrs.disabled, true);
let clearedConfig = null;
activePublicSetup.$on('save-public-config', value => {
  clearedConfig = value;
});
click(clearSecretButton, 'active room saved secret clear action');
assert.equal(clearedConfig.clearHostSecret, true);
assert.equal(clearedConfig.hostSecret, '');
assert.equal(
  activePublicSetup.lanRoom.publicJoinUrl,
  'https://ktv.shilyfx.icu/r/live/room/'
);
activePublicSetup.$destroy();

const defaultSetup = mountPanel({
  isElectron: true,
  publicConfig: {},
  lanRoom: null,
});
const defaultGatewayInput = findNode(
  defaultSetup._render(),
  node => node.tag === 'input' && node.data.attrs.type === 'url',
  'default public gateway address input'
);
assert.equal(defaultGatewayInput.data.domProps.value, 'https://ktv.shilyfx.icu');
defaultSetup.$destroy();

process.stdout.write('Karaoke room access panel behavior tests passed\n');
