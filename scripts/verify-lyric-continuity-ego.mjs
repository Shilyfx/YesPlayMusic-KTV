// Exercise the actual compiled viewer projector and scene DOM, without claiming
// a room or modifying the current host, playback, queue, or saved preferences.
export async function verifyLyricContinuity(page) {
  await page.waitForSelector('.display-screen', {
    state: 'visible',
    timeout: 15000,
  });
  const result = await page.evaluate(async () => {
    const view = document.querySelector('.display-screen').__vue__;
    const Vue = view.$options._base;
    const Scene = view.$options.components.KaraokeLyricScene;
    const project = view.$options.computed.stage;
    const lines = [
      { time: 0, content: '第一句' },
      { time: 2, content: '第二句' },
      { time: 4, content: '第三句' },
      { time: 8, content: '第四句' },
    ];
    const state = (position, window, elapsed) => {
      const presentation = {
        itemId: 'continuity-fixture',
        position,
        playing: true,
        lines: window,
      };
      return project.call({
        presentation,
        state: {
          presentation: {
            itemId: 'continuity-fixture',
            position,
            playing: true,
            lines: window,
          },
          serverTime: 1000,
          updatedAt: 1000,
        },
        clockNow: elapsed * 1000,
        receivedAt: 0,
      });
    };
    const before = state(3.8, lines, 0.3);
    const refreshed = state(4.2, lines.slice(1), 0);
    const next = state(8.2, lines, 0);
    const fixture = new Vue({
      data: () => ({ stage: before }),
      render(h) {
        return h(Scene, {
          props: {
            mode: 'orbit',
            lines: this.stage,
            cueKey: this.stage.cueKey,
            playing: true,
          },
        });
      },
    }).$mount();
    fixture.$el.style.display = 'none';
    document.body.append(fixture.$el);
    try {
      const original = fixture.$el.querySelector('.scene-now');
      fixture.stage = refreshed;
      await Vue.nextTick();
      const afterRefresh = fixture.$el.querySelector('.scene-now');
      const retained = original === afterRefresh;
      fixture.stage = next;
      await Vue.nextTick();
      return {
        sameText: before.active === refreshed.active,
        sameCueKey: before.cueKey === refreshed.cueKey,
        sameDomNode: retained,
        realCueChangesNode:
          fixture.$el.querySelector('.scene-now') !== afterRefresh,
      };
    } finally {
      const el = fixture.$el;
      fixture.$destroy();
      el.remove();
    }
  });
  console.log(result);
  if (
    !result.sameText ||
    !result.sameCueKey ||
    !result.sameDomNode ||
    !result.realCueChangesNode
  )
    throw new Error(
      'Lyric window refresh recreated the active DOM node and restarted its entrance animation'
    );
  console.log(
    'PASS: same lyric retains DOM across sync-window rebasing; real cue changes still animate'
  );
}
