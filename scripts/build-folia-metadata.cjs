const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const UPSTREAM = path.join(ROOT, 'vendor/folia-complete/src');
const HANABI_TYPES = path.join(
  ROOT,
  'vendor/folia-pv/src/components/visualizer/hanabi/types.ts'
);
const VENDORED_LOCALE = path.join(
  ROOT,
  'vendor/folia-complete/src/i18n/locales/zh-CN.ts'
);
const LOCAL_SOURCE_LOCALE =
  'C:/Users/Shilyfx/AppData/Local/Temp/lumasing-folia-control-20261028/src/i18n/locales/zh-CN.ts';
const OUTPUT = path.join(ROOT, 'src/karaoke/visualMetadata.json');

const MODE_SPECS = [
  { value: 'classic', label: '经典 · 原有舞台', engine: 'native' },
  { value: 'poem', label: '诗页 · 留白排版', engine: 'native' },
  { value: 'depth', label: '纵深 · 透视镜头', engine: 'native' },
  { value: 'orbit', label: '环轨 · 弧线叙事', engine: 'native' },
  { value: 'sonnet', label: '商籁 · Folia Sonnet', source: 'SONNET' },
  { value: 'tempera', label: '凝彩 · Folia Tempera', source: 'TEMPERA' },
  { value: 'lumiere', label: '绘光 · Folia Lumiere', source: 'LUMIERE' },
  { value: 'hanabi', label: '花火 · Folia Hanabi', source: 'HANABI' },
  {
    value: 'folia-classic',
    label: '流光 · Folia Classic',
    source: 'CLASSIC',
  },
  { value: 'cadenza', label: '心象 · Folia Cadenza', source: 'CADENZA' },
  { value: 'partita', label: '云阶 · Folia Partita', source: 'PARTITA' },
  { value: 'fume', label: '浮名 · Folia Fume', source: 'FUME' },
  { value: 'tilt', label: '倾诉 · Folia Tilt', source: 'TILT' },
  { value: 'claddagh', label: '回环 · Folia Claddagh', source: 'CLADDAGH' },
  { value: 'monet', label: '莫奈 · Folia Monet', source: 'MONET' },
  { value: 'pendolo', label: '时计 · Folia Pendolo', source: 'PENDOLO' },
  { value: 'cappella', label: '群唱 · Folia Cappella', source: 'CAPPELLA' },
  { value: 'diorama', label: '镜台 · Folia Diorama', source: 'DIORAMA' },
  { value: 'still', label: '静止 · Folia Still', source: null },
];

const BACKGROUND_SPECS = [
  { value: 'legacy', label: '原有背景', source: null },
  { value: 'common', label: '通用 · Folia Common', source: 'COMMON' },
  { value: 'monet', label: '莫奈 · Folia Monet', source: 'MONET_BACKGROUND' },
  {
    value: 'nomand',
    label: '漫游 · Folia Nomand',
    source: 'NOMAND_BACKGROUND',
  },
  {
    value: 'latent',
    label: '隐现 · Folia Latent',
    source: 'LATENT_BACKGROUND',
  },
  { value: 'url', label: '嵌入 · 网页背景', source: 'URL_BACKGROUND' },
  { value: 'sora', label: '空 · Folia Sora', source: 'SORA_BACKGROUND' },
];

const INTENSITY_MODES = new Set([
  'sonnet',
  'tempera',
  'lumiere',
  'hanabi',
  'folia-classic',
  'cadenza',
  'partita',
  'fume',
  'claddagh',
  'monet',
  'pendolo',
  'cappella',
  'diorama',
]);

const ENUMS = {
  'fume.cameraTrackingMode': [
    ['stepped', '分段'],
    ['smooth', '平滑'],
  ],
  'cappella.emojiPackSource': [
    ['builtin', '内置表情'],
    ['custom', '自定义表情包'],
  ],
  'cappella.avatarSource': [
    ['cover', '歌曲封面'],
    ['builtin', '内置头像'],
    ['color', '纯色头像'],
    ['custom', '自定义头像'],
  ],
  'tilt.colorScheme': [
    ['default', '原版配色'],
    ['swap', '交换主次色'],
    ['accentAll', '统一强调色'],
    ['primaryAll', '统一主色'],
  ],
  'pendolo.showGearDecor': [
    ['none', '关闭'],
    ['subtle', '轻微'],
    ['full', '完整'],
  ],
  'sonnet.outerFrameMode': [
    ['none', '无边框'],
    ['frame', '边框'],
    ['full', '完整装饰'],
  ],
  'tempera.colorMode': [
    ['duo', '双色'],
    ['mono', '单色墨阶'],
    ['gradient', '渐变'],
  ],
  'tempera.layerImageDepth': [
    ['back', '歌词后方'],
    ['front', '歌词前方'],
  ],
  'tempera.layerImages[].align': [
    ['free', '自由'],
    ['left', '左侧'],
    ['center', '居中'],
    ['right', '右侧'],
  ],
  'tempera.layerImages[].verticalAlign': [
    ['free', '自由'],
    ['top', '顶部'],
    ['center', '居中'],
    ['bottom', '底部'],
  ],
  'lumiere.renderQuality': [
    ['full', '完整画质'],
    ['balanced', '均衡'],
    ['low', '省电'],
  ],
  'lumiere.windowNeighbors': [
    [1, '上下各一行'],
    [2, '显示三行'],
  ],
  'hanabi.colorMode': [
    ['theme', '跟随主题'],
    ['vivid', '鲜艳预设'],
    ['mixed', '主题与鲜艳混合'],
  ],
  'hanabi.renderQuality': [
    ['full', '完整画质'],
    ['balanced', '均衡'],
    ['low', '省电'],
  ],
  'diorama.geometryVisibility.mode': [
    ['clouds', '歌词粒子云'],
    ['corridor', '粒子长廊'],
  ],
  'monet.audioStyle': [
    ['bar', '频谱柱'],
    ['line', '波形线'],
  ],
  'monet.portraitSource': [
    ['cover', '歌曲封面'],
    ['custom', '自定义画像'],
  ],
  'monet.portraitStyle': [
    ['square', '方形'],
    ['rectangular', '长方形'],
  ],
  'monetBackground.backgroundSource': [
    ['cover-derived', '歌曲封面'],
    ['uploaded-global', '上传图片'],
  ],
  'monetBackground.backgroundLayout': [
    ['full-overlay', '全屏叠加'],
    ['half-pane-gradient', '半屏渐变'],
  ],
  'monetBackground.backgroundWashColorMode': [
    ['theme', '跟随主题'],
    ['custom', '自定义颜色'],
  ],
  'nomandBackground.imageSource': [
    ['cover-derived', '歌曲封面'],
    ['uploaded-global', '上传图片'],
  ],
  'nomandBackground.effect': [
    ['dithering', '像素抖色'],
    ['fluted-glass', '纹理玻璃'],
    ['paper-texture', '纸张纹理'],
    ['halftone-dots', '半调网点'],
    ['lens-distortion', '镜头畸变'],
  ],
  'nomandBackground.ditheringType': [
    ['2x2', '2 × 2'],
    ['4x4', '4 × 4'],
    ['8x8', '8 × 8'],
  ],
  'latentBackground.displayMode': [
    ['dithering', '点阵'],
    ['mesh', '流体网格'],
    ['both', '点阵与网格'],
  ],
  'latentBackground.colorSource': [
    ['cover-theme', '封面与主题色'],
    ['cover-only', '仅封面取色'],
  ],
};

const RANGES = {
  'classic.breathingFloatMultiplier': [0, 2, 0.05],
  'classic.wordSpacing': [0, 2, 0.05],
  'partita.staggerMin': [0, 180, 5],
  'partita.staggerMax': [0, 180, 5],
  'fume.backgroundObjectOpacity': [0, 1, 0.05],
  'fume.textHoldRatio': [0, 1, 0.05],
  'fume.cameraSpeed': [0.55, 1.85, 0.05],
  'fume.glowIntensity': [0, 1.8, 0.05],
  'fume.heroScale': [0.82, 1.32, 0.02],
  'claddagh.focusScaleRatio': [0, 1.5, 0.05],
  'claddagh.radiusScale': [0.5, 1.5, 0.05],
  'claddagh.ellipseTiltDeg': [0, 60, 1],
  'claddagh.letterSpacingOffset': [-5, 20, 0.5],
  'tilt.splitProbability': [0, 1, 0.05],
  'tilt.tiltStyleProbability': [0, 1, 0.05],
  'sonnet.cameraIntensity': [0, 2, 0.05],
  'sonnet.typographyMotion': [0, 2, 0.05],
  'sonnet.mgDensity': [0, 2, 0.05],
  'sonnet.textureResolution': [0.5, 4, 0.25],
  'sonnet.postProcessGrain': [0, 1, 0.05],
  'sonnet.postProcessContrast': [0, 1, 0.05],
  'sonnet.postProcessRgbShift': [0, 1, 0.05],
  'sonnet.postProcessHalftone': [0, 1, 0.05],
  'sonnet.postProcessVignette': [0, 2, 0.05],
  'sonnet.postProcessLensDistortion': [0, 2, 0.05],
  'sonnet.postProcessLensDispersion': [0, 1, 0.05],
  'tempera.cameraIntensity': [0, 2, 0.05],
  'tempera.glyphMotion': [0, 2, 0.05],
  'tempera.glyphSettleStretch': [0, 1, 0.01],
  'tempera.depthOfField': [0, 2, 0.05],
  'tempera.depthPan': [0, 2, 0.05],
  'tempera.glyphDepth': [0, 2, 0.05],
  'tempera.layerImageFrequency': [0, 1, 0.05],
  'tempera.textureResolution': [0.5, 4, 0.25],
  'tempera.postProcessGrain': [0, 1, 0.05],
  'tempera.postProcessContrast': [0, 1, 0.05],
  'tempera.postProcessRgbShift': [0, 1, 0.05],
  'tempera.postProcessVignette': [0, 2, 0.05],
  'tempera.postProcessLensDistortion': [0, 2, 0.05],
  'hanabi.sparkAmount': [0, 2, 0.05],
  'hanabi.ornamentAmount': [0, 2, 0.05],
  'hanabi.textMotion': [0, 2, 0.05],
  'hanabi.blockOpacity': [0, 1, 0.01],
  'hanabi.riseSpeed': [0, 2, 0.05],
  'hanabi.spin': [0, 2, 0.05],
  'hanabi.ambient': [0, 2, 0.05],
  'hanabi.glow': [0, 2, 0.05],
  'hanabi.bloom': [0, 2, 0.05],
  'hanabi.chorusBloom': [0, 2, 0.05],
  'hanabi.sky': [0, 1, 0.01],
  'hanabi.collage': [0, 2, 0.05],
  'lumiere.lightIntensity': [0.3, 2, 0.05],
  'lumiere.audioResponse': [0, 2, 0.05],
  'lumiere.fogDensity': [0, 2, 0.05],
  'lumiere.darkField': [0, 1, 0.01],
  'lumiere.moteAmount': [0, 2, 0.05],
  'lumiere.bloom': [0, 2, 0.05],
  'lumiere.textBloom': [0, 2, 0.05],
  'lumiere.unlitOpacity': [0.05, 0.6, 0.01],
  'lumiere.decay': [0, 2, 0.05],
  'lumiere.echo': [0, 2, 0.05],
  'lumiere.fogOctaves': [2, 6, 1],
  'lumiere.themeColorMix': [0, 1, 0.01],
  'diorama.particleDensity': [96, 1536, 24],
  'diorama.cameraSpeed': [0.55, 1.85, 0.05],
  'diorama.motionAmount': [0.4, 1.6, 0.05],
  'diorama.audioReactivity': [0, 1.5, 0.05],
  'diorama.particleScale': [0.65, 1.6, 0.05],
  'diorama.particleGlowIntensity': [0.1, 1.5, 0.05],
  'diorama.backgroundParticleCircumference': [4, 48, 2],
  'diorama.backgroundParticleRadial': [1, 4, 1],
  'diorama.glowIntensity': [0.1, 1.5, 0.05],
  'diorama.soulIntensity': [0.1, 1.5, 0.05],
  'diorama.gradientIntensity': [0.1, 1.5, 0.05],
  'monet.fontScale': [0.7, 1.5, 0.05],
  'monet.portraitOffsetX': [-150, 0, 1],
  'pendolo.wheelCenterX': [-0.2, 0.4, 0.01],
  'pendolo.arcRadius': [0.25, 0.8, 0.01],
  'pendolo.arcAngleDeg': [40, 160, 5],
  'pendolo.wheelCenterY': [0.2, 0.8, 0.01],
  'pendolo.tickSnappiness': [0.5, 2, 0.1],
  'pendolo.activeScale': [1, 1.6, 0.05],
  'monetBackground.backgroundBlurPx': [0, 60, 1],
  'monetBackground.backgroundOverlayOpacity': [0, 1, 0.01],
  'monetBackground.backgroundGrayscale': [0, 1, 0.01],
  'monetBackground.backgroundSaturation': [0, 2, 0.05],
  'monetBackground.backgroundWash': [0, 1, 0.01],
  'monetBackground.backgroundHalfPaneOffsetX': [-40, 40, 1],
  'monetBackground.backgroundDriftStrength': [0, 1, 0.01],
  'nomandBackground.size': [0.5, 20, 0.1],
  'nomandBackground.colorSteps': [1, 7, 1],
  'nomandBackground.flutedGlassSize': [0.1, 1, 0.05],
  'nomandBackground.flutedGlassDistortion': [0, 1, 0.05],
  'nomandBackground.flutedGlassBlur': [0, 1, 0.01],
  'nomandBackground.paperTextureContrast': [0, 1, 0.01],
  'nomandBackground.paperTextureRoughness': [0, 1, 0.01],
  'nomandBackground.paperTextureFiber': [0, 1, 0.01],
  'nomandBackground.halftoneDotsSize': [0.1, 2, 0.01],
  'nomandBackground.halftoneDotsRadius': [0.1, 2, 0.01],
  'nomandBackground.halftoneDotsContrast': [0, 1, 0.01],
  'nomandBackground.lensDistortionSpread': [0, 1, 0.01],
  'nomandBackground.lensDistortionBulge': [-1, 1, 0.01],
  'nomandBackground.lensDistortionDispersion': [0, 1, 0.01],
  'nomandBackground.overlayOpacity': [0, 1, 0.01],
  'latentBackground.ditheringSpeed': [0, 2, 0.01],
  'latentBackground.ditheringAudioSpeed': [0, 2, 0.05],
  'latentBackground.ditheringSize': [0.5, 8, 0.1],
  'latentBackground.ditheringOpacity': [0, 1, 0.01],
  'latentBackground.meshSpeed': [0, 2, 0.01],
  'latentBackground.meshAudioSpeed': [0, 2, 0.05],
  'latentBackground.meshDistortion': [0, 2, 0.01],
  'latentBackground.meshSwirl': [0, 1, 0.01],
  'latentBackground.overlayOpacity': [0, 1, 0.01],
  'common.opacity': [0, 1, 0.05],
};

const FIELD_LABELS = {
  enableWordRotation: '逐字旋转',
  breathingFloatMultiplier: '呼吸浮动幅度',
  useLegacyLayout: '传统排版',
  wordSpacing: '字间距',
  fontScale: '文字缩放',
  widthRatio: '文字区域宽度',
  motionAmount: '动态幅度',
  glowIntensity: '辉光强度',
  beamIntensity: '光束强度',
  showGuideLines: '显示辅助线',
  useSemanticLayout: '语义排版',
  staggerMin: '最小错落距离',
  staggerMax: '最大错落距离',
  hidePrintSymbols: '隐藏印刷符号',
  disableGeometricBackground: '关闭几何背景',
  backgroundObjectOpacity: '背景物体透明度',
  textHoldRatio: '歌词停留比例',
  cameraTrackingMode: '镜头跟随方式',
  cameraSpeed: '镜头速度',
  heroScale: '主歌词缩放',
  focusScaleRatio: '焦点歌词缩放',
  radiusScale: '环形半径',
  ellipseTiltDeg: '椭圆倾角',
  showAxisLine: '显示轴线',
  letterSpacingOffset: '字间距调整',
  showEmoMessages: '显示表情文字',
  emojiPackSource: '表情包来源',
  avatarSource: '头像来源',
  splitProbability: '分屏概率',
  tiltStyleProbability: '倾斜样式概率',
  colorScheme: '配色方案',
  arcRadius: '弧线半径',
  arcAngleDeg: '弧线角度',
  wheelCenterX: '表盘中心横向位置',
  wheelCenterY: '表盘中心纵向位置',
  tickSnappiness: '节拍响应',
  activeScale: '当前歌词缩放',
  showGearDecor: '齿轮装饰',
  showCenterGradient: '显示中心渐变',
  showCoverOnWatchFace: '表盘显示封面',
  enableLineGlow: '启用线条辉光',
  cameraIntensity: '镜头运动强度',
  typographyMotion: '文字动效',
  mgDensity: '装饰图形密度',
  showOnlyText: '仅显示歌词',
  showGuide: '显示辅助线',
  showBackgroundMg: '显示背景装饰图形',
  showFixedGeo: '显示固定几何图形',
  showGiantDecorativeText: '显示大型装饰文字',
  showBackgroundDecor: '显示背景装饰',
  enableTransitions: '启用转场',
  outerFrameMode: '外框样式',
  textureResolution: '纹理分辨率',
  postProcessEnabled: '启用后期效果',
  postProcessGrain: '胶片颗粒',
  postProcessContrast: '对比度',
  postProcessRgbShift: 'RGB 色差',
  postProcessHalftone: '半调网点',
  postProcessVignette: '暗角',
  postProcessLensDistortion: '镜头畸变',
  postProcessLensDispersion: '镜头色散',
  glyphMotion: '逐字动势',
  wholeLineLyrics: '整行歌词',
  glyphSettleStretch: '逐字停靠时长',
  depthOfField: '景深',
  depthPan: '镜头平移',
  glyphDepth: '歌词远近',
  showBlocks: '显示色块',
  showDecor: '显示装饰',
  showCornerMarks: '显示边角线框',
  textInversion: '文字动态反色',
  portraitAssetId: '自定义肖像图片',
  emojiAssetIds: '自定义表情图片',
  avatarAssetIds: '自定义头像图片',
  layerImageAssetIds: '贴图素材库',
  layerImages: '贴图布局',
  layerImageDepth: '贴图层级',
  layerImageFrequency: '贴图出现概率',
  postProcessTextureCompression: '压缩后期纹理',
  lightIntensity: '光强',
  audioResponse: '音乐响应',
  fogDensity: '烟雾浓度',
  darkField: '暗场强度',
  moteAmount: '浮尘数量',
  bloom: '图形辉光',
  textBloom: '文字辉光',
  unlitOpacity: '未唱歌词透明度',
  windowNeighbors: '相邻歌词行数',
  decay: '崩解强度',
  echo: '背景歌词亮度',
  fogOctaves: '烟雾细节',
  lineArt: '显示线稿',
  frontBokeh: '显示前景散景',
  trails: '显示轨迹线',
  hideTrails: '隐藏轨迹线',
  seamlessTransitions: '连续转场',
  overlayFrame: '显示画框',
  keywordColors: '关键字着色',
  themeIcons: '主题图标',
  themeColorMix: '主题色占比',
  renderQuality: '画质',
  geometryVisibility: '几何图层',
  enabled: '启用图层',
  mode: '图形样式',
  strands: '立方晶格',
  blobs: '点云外壳',
  ribbons: '三角晶体',
  rings: '圆环粒子',
  particleDensity: '粒子密度',
  particleScale: '粒子缩放',
  particleGlowEnabled: '粒子辉光',
  particleGlowIntensity: '粒子辉光强度',
  showParticles: '显示粒子',
  backgroundParticleCircumference: '背景粒子圆周密度',
  backgroundParticleRadial: '背景粒子径向密度',
  glowEnabled: '普通辉光跟唱',
  soulEnabled: '灵魂出窍跟唱',
  soulIntensity: '灵魂出窍强度',
  soulActiveEnabled: '当前字漂移',
  gradientEnabled: '渐变跟唱',
  gradientIntensity: '渐变跟唱强度',
  keywordColoringEnabled: '关键字着色',
  showDescription: '显示歌曲介绍',
  showAudioVisualization: '显示音频可视化',
  audioStyle: '音频可视化样式',
  portraitSource: '画像来源',
  portraitOffsetX: '画像横向位置',
  portraitStyle: '画像比例',
  showPortraitDragHanger: '显示画像挂线',
  backgroundSource: '背景图片来源',
  backgroundLayout: '背景布局',
  backgroundBlurPx: '背景模糊',
  backgroundOverlayOpacity: '背景叠层透明度',
  backgroundGrayscale: '背景灰度',
  backgroundSaturation: '背景饱和度',
  backgroundWash: '背景色雾',
  backgroundHalfPaneOffsetX: '半屏背景位置',
  backgroundWashColorMode: '背景色雾颜色',
  backgroundWashCustomColor: '自定义色雾颜色',
  backgroundDriftEnabled: '背景缓慢漂移',
  backgroundDriftStrength: '漂移幅度',
  backgroundStreaksEnabled: '显示竖向纹理',
  imageSource: '背景图片来源',
  effect: '漫游效果',
  ditheringType: '点阵尺寸',
  size: '效果尺寸',
  colorSteps: '颜色阶数',
  originalColors: '保留原色',
  inverted: '反转颜色',
  flutedGlassSize: '玻璃纹理尺寸',
  flutedGlassDistortion: '玻璃折射强度',
  flutedGlassBlur: '玻璃模糊',
  paperTextureContrast: '纸张对比度',
  paperTextureRoughness: '纸张粗糙度',
  paperTextureFiber: '纸张纤维',
  halftoneDotsSize: '网点尺寸',
  halftoneDotsRadius: '网点半径',
  halftoneDotsContrast: '网点对比度',
  halftoneDotsOriginalColors: '网点保留原色',
  halftoneDotsInverted: '网点反转颜色',
  lensDistortionSpread: '畸变扩散',
  lensDistortionBulge: '镜头膨胀',
  lensDistortionDispersion: '镜头色散',
  overlayEnabled: '启用叠层',
  overlayOpacity: '叠层透明度',
  displayMode: '显示内容',
  colorSource: '颜色来源',
  dynamicOnlyInPlayer: '仅播放时动态',
  enhancedBeatResponse: '增强节拍响应',
  ditheringSpeed: '点阵速度',
  ditheringAudioSpeed: '点阵音频响应',
  ditheringSize: '点阵大小',
  ditheringOpacity: '点阵透明度',
  meshSpeed: '网格速度',
  meshAudioSpeed: '网格音频响应',
  meshDistortion: '网格扭曲',
  meshSwirl: '网格旋涡',
  blank: '显示纯色空背景',
  useCoverColorBg: '使用封面主题色',
  disableVignette: '关闭暗角',
  opacity: '背景透明度',
  items: '网页背景列表',
  selectedId: '当前网页背景',
  url: '网页地址',
};

const ASSET_ACTIONS = {
  tempera: [
    {
      id: 'layerImageAssetIds',
      key: 'layerImageAssetIds',
      role: 'tempera',
      label: '添加贴图图片',
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      multiple: true,
    },
  ],
  monet: [
    {
      id: 'portrait',
      key: 'portrait',
      role: 'portrait',
      label: '上传自定义画像',
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      multiple: false,
    },
  ],
  monetBackground: [
    {
      id: 'background',
      key: 'background',
      role: 'background',
      label: '上传背景图片',
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      multiple: false,
    },
  ],
  nomandBackground: [
    {
      id: 'background',
      key: 'background',
      role: 'background',
      label: '上传背景图片',
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      multiple: false,
    },
  ],
  cappella: [
    {
      id: 'emojiPack',
      key: 'emojiPack',
      role: 'emoji',
      label: '导入自定义表情包',
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      multiple: true,
    },
    {
      id: 'avatarPack',
      key: 'avatarPack',
      role: 'avatar',
      label: '导入自定义头像',
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      multiple: true,
    },
  ],
};

function loadTypes(file) {
  const result = esbuild.buildSync({
    entryPoints: [file],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    require,
    module,
    module.exports
  );
  return module.exports;
}

function readZhOptions() {
  const locale = fs.existsSync(VENDORED_LOCALE)
    ? VENDORED_LOCALE
    : LOCAL_SOURCE_LOCALE;
  const source = fs.existsSync(locale) ? fs.readFileSync(locale, 'utf8') : '';
  const labels = {};
  const expression = /["']([^"']+)["']\s*:\s*["']((?:\\.|[^"'\\])*)["']/g;
  let match;
  while ((match = expression.exec(source))) {
    labels[match[1]] = match[2].replace(/\\(["'\\])/g, '$1');
  }
  return labels;
}

const upperTypes = loadTypes(path.join(UPSTREAM, 'types.ts'));
const hanabiTypes = loadTypes(HANABI_TYPES);
const zhLabels = readZhOptions();

const DEFAULT_EXPORTS = {
  CLASSIC: upperTypes.DEFAULT_CLASSIC_TUNING,
  CADENZA: upperTypes.DEFAULT_CADENZA_TUNING,
  PARTITA: upperTypes.DEFAULT_PARTITA_TUNING,
  FUME: upperTypes.DEFAULT_FUME_TUNING,
  CLADDAGH: upperTypes.DEFAULT_CLADDAGH_TUNING,
  CAPPELLA: upperTypes.DEFAULT_CAPPELLA_TUNING,
  TILT: upperTypes.DEFAULT_TILT_TUNING,
  PENDOLO: upperTypes.DEFAULT_PENDOLO_TUNING,
  SONNET: upperTypes.DEFAULT_SONNET_TUNING,
  TEMPERA: upperTypes.DEFAULT_TEMPERA_TUNING,
  LUMIERE: upperTypes.DEFAULT_LUMIERE_TUNING,
  DIORAMA: upperTypes.DEFAULT_DIORAMA_TUNING,
  MONET: upperTypes.DEFAULT_MONET_TUNING,
  HANABI: hanabiTypes.DEFAULT_HANABI_TUNING,
  MONET_BACKGROUND: upperTypes.DEFAULT_MONET_BACKGROUND_TUNING,
  NOMAND_BACKGROUND: upperTypes.DEFAULT_NOMAND_BACKGROUND_TUNING,
  LATENT_BACKGROUND: upperTypes.DEFAULT_LATENT_BACKGROUND_TUNING,
  SORA_BACKGROUND: upperTypes.DEFAULT_SORA_BACKGROUND_TUNING,
};

DEFAULT_EXPORTS.COMMON = {
  useCoverColorBg: false,
  disableVignette: false,
  disableGeometricBackground: false,
  opacity: 0.75,
};
DEFAULT_EXPORTS.URL_BACKGROUND = { items: [], selectedId: null };

const MODE_PREFIX = {
  'folia-classic': 'classic',
};
const BACKGROUND_PREFIX = {
  common: 'visualizerBackgroundCommon',
  monet: 'monetBackground',
  nomand: 'nomandBackground',
  latent: 'latentBackground',
  url: 'urlBackground',
  sora: 'soraBackground',
};

function pascal(value) {
  return String(value).replace(/(^|[-_])([a-z0-9])/gi, (_, _sep, letter) =>
    letter.toUpperCase()
  );
}

function labelFor(scope, id, key, fallback) {
  const leaf = key.split('.').pop().replace(/\[\]$/, '');
  const modePrefix = MODE_PREFIX[id] || id;
  const prefix = scope === 'mode' ? modePrefix : BACKGROUND_PREFIX[id] || id;
  const translation = zhLabels[`${prefix}${pascal(leaf)}`];
  return (
    translation ||
    FIELD_LABELS[leaf] ||
    FIELD_LABELS[leaf.replace(/\[\]$/, '')] ||
    fallback ||
    leaf
  );
}

function enumOptions(scope, id, key, value) {
  const direct =
    ENUMS[`${id}.${key}`] || ENUMS[`${id}.${key.replace(/\[\d+\]/g, '[]')}`];
  if (direct) return direct.map(([value, label]) => ({ value, label }));
  if (key === 'renderQuality')
    return [
      { value: 'full', label: '完整画质' },
      { value: 'balanced', label: '均衡' },
      { value: 'low', label: '省电' },
    ];
  if (key === 'items' && scope === 'background' && id === 'url') return [];
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return null;
  return null;
}

function makeField(scope, id, pathParts, value) {
  const pathKey = pathParts.join('.');
  const ruleId =
    scope === 'background'
      ? {
          monet: 'monetBackground',
          nomand: 'nomandBackground',
          latent: 'latentBackground',
          sora: 'soraBackground',
        }[id] || id
      : id;
  const enumRule =
    ENUMS[`${ruleId}.${pathKey}`] ||
    ENUMS[`${ruleId}.${pathKey.replace(/\[\d+\]/g, '[]')}`];
  const fieldRule = RANGES[`${ruleId}.${pathKey}`];
  const field = {
    key: pathKey,
    label: labelFor(scope, id, pathKey),
    default: value,
  };
  if (
    pathParts.some(part =>
      ['__proto__', 'constructor', 'prototype'].includes(part)
    )
  )
    return null;

  if (scope === 'background' && id === 'url' && pathKey === 'selectedId') {
    field.type = 'url-selection';
    return field;
  }

  if (
    scope === 'mode' &&
    ((id === 'monet' && pathKey === 'portraitAssetId') ||
      (id === 'cappella' &&
        ['emojiAssetIds', 'avatarAssetIds'].includes(pathKey)) ||
      (id === 'tempera' && pathKey === 'layerImageAssetIds'))
  ) {
    field.type = id === 'monet' ? 'asset-ref' : 'asset-refs';
    field.maxItems = 16;
    return field;
  }

  if (Array.isArray(value)) {
    field.type =
      pathKey === 'items' && scope === 'background' && id === 'url'
        ? 'url-list'
        : id === 'tempera' && pathKey === 'layerImages'
        ? 'asset-list'
        : 'json';
    field.maxItems =
      field.type === 'asset-list' ? 16 : field.type === 'url-list' ? 8 : 64;
    field.maxLength = 8192;
    if (field.type === 'asset-list') {
      field.itemFields = [
        {
          key: 'align',
          label: '水平位置',
          type: 'select',
          default: 'free',
          options: ENUMS['tempera.layerImages[].align'].map(([v, label]) => ({
            value: v,
            label,
          })),
        },
        {
          key: 'verticalAlign',
          label: '垂直位置',
          type: 'select',
          default: 'bottom',
          options: ENUMS['tempera.layerImages[].verticalAlign'].map(
            ([v, label]) => ({ value: v, label })
          ),
        },
        {
          key: 'scale',
          label: '贴图缩放',
          type: 'range',
          default: 0.7,
          min: 0.05,
          max: 2,
          step: 0.05,
        },
        {
          key: 'opacity',
          label: '贴图透明度',
          type: 'range',
          default: 1,
          min: 0,
          max: 1,
          step: 0.05,
        },
      ];
    }
    return field;
  }

  if (value && typeof value === 'object') {
    field.type = 'group';
    field.fields = Object.keys(value)
      .map(key => makeField(scope, id, [...pathParts, key], value[key]))
      .filter(Boolean);
    return field;
  }

  if (typeof value === 'boolean') {
    field.type = 'boolean';
    return field;
  }

  if (enumRule) {
    field.type = 'select';
    field.options = enumRule.map(([optionValue, label]) => ({
      value: optionValue,
      label,
    }));
    field.preset = true;
    return field;
  }

  if (typeof value === 'number') {
    field.type = fieldRule ? 'range' : 'number';
    if (fieldRule) {
      field.step = fieldRule[2];
      field.min = fieldRule[0];
      field.max = fieldRule[1];
    }
    return field;
  }

  if (typeof value === 'string') {
    const options = enumOptions(scope, id, pathKey, value);
    if (options) {
      field.type = 'select';
      field.options = options;
      field.preset = true;
      return field;
    }
    field.type = /^#[0-9a-f]{6}$/i.test(value) ? 'color' : 'text';
    field.maxLength = 256;
    return field;
  }

  field.type = 'json';
  field.maxLength = 8192;
  return field;
}

function buildEntry(spec, scope) {
  const defaults = spec.source ? DEFAULT_EXPORTS[spec.source] || {} : {};
  const sourceDefaults =
    scope === 'mode' && spec.value === 'folia-classic'
      ? DEFAULT_EXPORTS.CLASSIC
      : defaults;
  const value =
    scope === 'mode' && spec.value === 'monet'
      ? { ...sourceDefaults, portraitAssetId: null }
      : scope === 'mode' && spec.value === 'cappella'
      ? { ...sourceDefaults, emojiAssetIds: [], avatarAssetIds: [] }
      : scope === 'mode' && spec.value === 'tempera'
      ? { ...sourceDefaults, layerImageAssetIds: [] }
      : sourceDefaults;
  const fields = Object.keys(value)
    .map(key => makeField(scope, spec.value, [key], value[key]))
    .filter(Boolean);
  const assetKey =
    scope === 'mode'
      ? spec.value === 'folia-classic'
        ? 'classic'
        : spec.value
      : `${spec.value}Background`;
  return {
    ...spec,
    engine: spec.engine || (scope === 'mode' ? 'pv' : undefined),
    supportsIntensity: scope === 'mode' && INTENSITY_MODES.has(spec.value),
    tuningDefaults: value,
    fields,
    assetActions: ASSET_ACTIONS[assetKey] || [],
    source: spec.source ? 'vendor/folia-complete/src/types.ts' : null,
  };
}

const metadata = {
  schemaVersion: 1,
  sourceRevision: '7a5f975e337e5ba13f55d72b5bc68983bf41c379',
  modes: MODE_SPECS.map(spec => buildEntry(spec, 'mode')),
  backgrounds: BACKGROUND_SPECS.map(spec => buildEntry(spec, 'background')),
};
metadata.modes.find(mode => mode.value === 'hanabi').source =
  'vendor/folia-pv/src/components/visualizer/hanabi/types.ts';

fs.writeFileSync(OUTPUT, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
process.stdout.write(
  `Wrote ${metadata.modes.length} modes and ${
    metadata.backgrounds.length
  } backgrounds to ${path.relative(ROOT, OUTPUT)}\n`
);
