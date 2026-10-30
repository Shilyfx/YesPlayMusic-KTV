export const REACTION_UI_REVISION = 'centered-effects-v7';
export const reactionChoices = [
  {
    kind: 'applause',
    emotion: '33',
    label: '唱得太棒了',
    caption: '掌声送给你',
    action: 'burst',
  },
  {
    kind: 'cheer',
    emotion: '10',
    label: '全场一起嗨',
    caption: '气氛组就位',
    action: 'spin',
  },
  {
    kind: 'love',
    emotion: '14',
    label: '心动暴击',
    caption: '这首唱到心里',
    action: 'bounce',
  },
  {
    kind: 'moved',
    emotion: '12',
    label: '听到泪目',
    caption: '每句都是故事',
    action: 'bounce',
  },
  {
    kind: 'encore',
    emotion: '13',
    label: '再来一首',
    caption: '根本没听够',
    action: 'spin',
  },
  {
    kind: 'groove',
    emotion: '19',
    label: '这味对了',
    caption: '跟着节奏摇摆',
    action: 'bounce',
  },
  {
    kind: 'wow',
    emotion: '03',
    label: '高音起飞',
    caption: '这也能唱上去',
    action: 'burst',
  },
  {
    kind: 'duet',
    emotion: '31',
    label: '一起合唱',
    caption: '下一句交给我',
    action: 'bounce',
  },
];
export const reactionAnimations = Object.fromEntries(
  reactionChoices.map(item => [item.kind, item])
);
export const automaticReactions = {
  started: { emotion: '10', label: '开唱啦', action: 'bounce' },
  finished: { emotion: '33', label: '演唱完成', action: 'burst' },
  requested: { emotion: '31', label: '收到点歌', action: 'bounce' },
  paused: { emotion: '06', label: '休息一下，等你继续', action: 'bounce' },
  resumed: { emotion: '07', label: '继续开唱', action: 'bounce' },
  skipped: { emotion: '13', label: '下一首走起', action: 'spin' },
};

export const reactionCharacters = [
  { id: 'ball', label: '球球' },
  { id: 'nimbo', label: '云宝' },
  { id: 'twinkle', label: '亮亮' },
];

export const reactionEffects = [
  {
    id: 'bounce',
    label: '弹跳登场',
    caption: '跟着节奏蹦一下',
    sketch: 'sketch-bounce',
    action: 'bounce',
  },
  {
    id: 'zoom',
    label: '中央放大',
    caption: '把这份情绪放大',
    sketch: 'sketch-zoom',
    action: '',
  },
  {
    id: 'fade',
    label: '温柔浮现',
    caption: '慢慢出现，轻轻退场',
    sketch: 'sketch-fade',
    action: '',
  },
  {
    id: 'spin',
    label: '旋转彩带',
    caption: '螺旋登场甩出彩带',
    sketch: 'sketch-spin',
    action: 'spin',
  },
  {
    id: 'firework',
    label: '烟花爆闪',
    caption: '冲天跃起漫天星火',
    sketch: 'sketch-firework',
    action: 'burst',
  },
  {
    id: 'meteor',
    label: '流星滑入',
    caption: '斜向俯冲帅气定格',
    sketch: 'sketch-meteor',
    action: 'spin',
  },
  {
    id: 'spotlight',
    label: '聚光降临',
    caption: '从天而降温暖陪伴',
    sketch: 'sketch-spotlight',
    action: 'signature',
  },
  {
    id: 'sway',
    label: '左右摇摆',
    caption: '像荧光棒轻快摇晃',
    sketch: 'sketch-sway',
    action: 'bounce',
  },
  {
    id: 'spring',
    label: '弹簧冲刺',
    caption: '果冻拉伸回弹登场',
    sketch: 'sketch-spring',
    action: 'bounce',
  },
  {
    id: 'carnival',
    label: '庆典狂欢',
    caption: '欢跳撒花全场沸腾',
    sketch: 'sketch-carnival',
    action: 'celebrate',
  },
  {
    id: 'peek',
    label: '惊喜探头',
    caption: '探头张望再跃上台',
    sketch: 'sketch-peek',
    action: 'bounce',
  },
  {
    id: 'heartbeat',
    label: '心跳律动',
    caption: '双拍脉冲心动共鸣',
    sketch: 'sketch-heartbeat',
    action: 'signature',
  },
  {
    id: 'vortex',
    label: '旋风瞬移',
    caption: '极速旋风利落展开',
    sketch: 'sketch-vortex',
    action: 'spin',
  },
];

export const REACTION_EFFECT_IDS = reactionEffects.map(item => item.id);

export function isValidReactionEffect(value) {
  return typeof value === 'string' && REACTION_EFFECT_IDS.includes(value);
}
// Original IDs/names from Aora Bot's pinned 32-state registry; KTV captions are local.
export const upstreamReactions = [
  ['00', '睡眠', '听着歌睡着了'],
  ['01', '唤醒', '准备开唱'],
  ['02', '待机放空', '安静听你唱'],
  ['03', '好奇', '期待下一句'],
  ['04', '发呆', '沉浸放空'],
  ['05', '加载苏醒', '前奏准备中'],
  ['06', '休眠', '中场休息'],
  ['07', '抖动唤醒', '满血回归'],
  ['10', '开心', '这首太快乐'],
  ['11', '疑惑', '下一句怎么唱'],
  ['12', '失落', '唱进心事里'],
  ['13', '惊讶', '高音惊艳全场'],
  ['14', '害羞', '心动藏不住'],
  ['15', '疲惫', '唱累了喝口水'],
  ['16', '专注', '认真听你唱'],
  ['17', '慌张', '快到我的部分了'],
  ['18', '无奈', '又没抢到麦'],
  ['19', '满意', '这味太对了'],
  ['20', '困惑', '调怎么不一样'],
  ['21', '生气', '这首我要唱'],
  ['30', '思考中', '下一首点什么'],
  ['31', '接收任务', '这首交给我'],
  ['32', '处理中忙碌', '副歌蓄力中'],
  ['33', '任务完成', '完美收麦'],
  ['34', '出错', '刚才唱跑调了'],
  ['35', '等待输入', '等你接下一句'],
  ['36', '联网加载', '好歌马上来'],
  ['37', '复述回忆', '青春又回来了'],
  ['38', '拒绝/受限', '这首唱不上去'],
  ['39', '输出回复', '跟我一起唱'],
  ['40', '检索资料', '寻找我的拿手曲'],
  ['41', '停止终止', '先歇一首'],
].map(([emotion, label, caption]) => ({
  kind: 'emotion',
  emotion,
  label,
  caption,
}));

export function resolveReaction(event) {
  return event.kind === 'emotion'
    ? ktvReactionChoices.find(item => item.emotion === event.emotionId)
    : reactionAnimations[event.kind] || automaticReactions[event.kind];
}

const ktvNotes = [
  '这首歌太温柔',
  '拿好麦克风',
  '把舞台留给你',
  '等着被你惊艳',
  '让音乐慢慢流动',
  '好声音马上登场',
  '喝口水再继续',
  '我的状态回来了',
  '快乐跟着旋律走',
  '帮我接下一句',
  '今晚唱出心事',
  '全场都被惊艳',
  '心动不用说出口',
  '歇一首再继续',
  '不想错过每一句',
  '轮到我接麦了',
  '下次让我先来',
  '熟悉的感觉回来了',
  '换个调试试看',
  '拿手曲不让麦',
  '歌单还有好多首',
  '陪你一起唱完',
  '把力气留给副歌',
  '这首完成得漂亮',
  '下一句再追回来',
  '麦克风交给你',
  '等一首好声音',
  '这一首都是青春',
  '换首拿手的再来',
  '下一句一起合唱',
  '我的歌就在歌单里',
  '下一首轮到你',
];
export const ktvReactionChoices = upstreamReactions.map((item, index) => {
  const preset = reactionChoices.find(
    choice => choice.emotion === item.emotion
  );
  return {
    ...item,
    label: preset?.label || item.caption,
    caption: preset?.caption || ktvNotes[index],
    action: preset?.action,
  };
});

export function normalizeReactionText(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new Error('INVALID_REACTION_TEXT');
  const text = value.replace(/[\r\n\t]/g, ' ').trim();
  const characters = Array.from(text);
  if (
    characters.length > 40 ||
    characters.some(
      char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    )
  )
    throw new Error('INVALID_REACTION_TEXT');
  return text;
}
