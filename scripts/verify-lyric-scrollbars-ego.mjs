// Run inside ego-browser nodejs. Mounts the real compiled scene without changing
// the host's settings, queue, playback state, or room ownership.
export async function verifyLyricScrollbars(page) {
  await page.waitForFunction(
    () => !!document.querySelector('.karaoke-surface')?.__vue__
  );
  const results = await page.evaluate(async () => {
    const view = document.querySelector('.karaoke-surface').__vue__;
    const Vue = view.$options._base;
    const Scene = Vue.extend(view.$options.components.KaraokeLyricScene);
    const results = [];
    for (const mode of ['orbit', 'poem', 'depth']) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText =
        'position:fixed;inset:20px;z-index:99999;background:#f4f3fb;--ktv-active-lyric-size:45px;--ktv-text-primary:#17162b;--ktv-accent:#7861df;--ktv-accent-strong:#453197';
      const scene = new Scene({
        propsData: {
          mode,
          fullscreen: true,
          playing: false,
          cueKey: 'fixture:0',
          lines: {
            before: '上句',
            active: '长歌词仍需完整阅读。'.repeat(120),
            after: '下句',
            afterSecond: '末句',
          },
        },
      });
      try {
        scene.$mount();
        wrapper.append(scene.$el);
        document.body.append(wrapper);
        await Vue.nextTick();
        const root = scene.$el;
        const css = getComputedStyle(root);
        const bar = getComputedStyle(root, '::-webkit-scrollbar');
        root.scrollLeft = 200;
        const scrollLeft = root.scrollLeft;
        root.scrollTop = root.scrollHeight;
        const scrollsVertically = root.scrollTop > 0;
        scene.lines = {
          before: '上句',
          active: '当前歌词自动回到视野',
          after: '下句',
          afterSecond: '末句',
        };
        scene.cueKey = 'fixture:1';
        await Vue.nextTick();
        await Vue.nextTick();
        const bounds = root.getBoundingClientRect();
        const active = root.querySelector('.scene-now').getBoundingClientRect();
        results.push({
          mode,
          overflowX: css.overflowX,
          scrollbarWidth: css.scrollbarWidth,
          scrollbarDisplay: bar.display,
          horizontalGutter: root.offsetWidth - root.clientWidth,
          scrollLeft,
          scrollsVertically,
          followsCue:
            active.top >= bounds.top - 1 && active.top < bounds.bottom,
        });
      } finally {
        scene.$destroy();
        wrapper.remove();
      }
    }
    return results;
  });
  console.log(JSON.stringify(results));
  for (const result of results) {
    if (result.overflowX !== 'hidden')
      throw new Error(result.mode + ': unwanted horizontal overflow');
    if (
      result.scrollbarWidth !== 'none' &&
      result.scrollbarDisplay !== 'none'
    ) {
      throw new Error(result.mode + ': native scrollbars remain visible');
    }
    if (result.horizontalGutter !== 0)
      throw new Error(result.mode + ': scrollbar reserves visible gutter');
    if (!result.scrollsVertically || !result.followsCue)
      throw new Error(result.mode + ': long lyrics or cue following regressed');
  }
  console.log(
    'PASS: no visible lyric scrollbars; long lyrics and cue following preserved in all three scenes'
  );
}
