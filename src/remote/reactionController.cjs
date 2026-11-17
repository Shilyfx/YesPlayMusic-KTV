'use strict';

function shuffleEffects(list, random = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createReactionController({
  app,
  api,
  getClientToken,
  setNotice,
  escape,
  normalizeReactionText,
  resolveReaction,
  ktvReactionChoices,
  reactionCharacters,
  reactionEffects,
  loadEmotionBall,
  loadMoodMates,
  random = Math.random,
  setTimeout: schedule = setTimeout,
}) {
  const randomizedReactionEffects = shuffleEffects(reactionEffects, random);
  let reactionEffect = randomizedReactionEffects[0]?.id || 'bounce';
  let reactionEffectsExpanded = false;
  let reactionCharacter = 'ball';
  let reactionPreviewVersion = 0;

  function reactionCardsMarkup() {
    return ktvReactionChoices
      .map(
        item =>
          `<button type="button" class="reaction-card" data-reaction="${item.kind}" data-emotion-id="${item.emotion}"><span class="reaction-preview" data-reaction-preview="${item.emotion}" aria-hidden="true"></span><strong>${item.label}</strong><small>${item.caption}</small></button>`
      )
      .join('');
  }

  function effectButtonMarkup(item) {
    return `<button type="button" data-effect-choice="${escape(
      item.id
    )}" aria-pressed="${
      item.id === reactionEffect
    }"><span class="effect-sketch ${escape(
      item.sketch
    )}"></span><strong>${escape(item.label)}</strong><small>${escape(
      item.caption
    )}</small></button>`;
  }

  function reactionEffectsMarkup() {
    const primary = randomizedReactionEffects.slice(0, 6);
    const extra = randomizedReactionEffects.slice(6);
    const primaryHtml = `<div class="reaction-effects" role="group" aria-label="出场方式">${primary
      .map(effectButtonMarkup)
      .join('')}</div>`;
    if (!extra.length) return primaryHtml;
    const extraHtml = `<div class="reaction-effects reaction-effects-extra" data-more-reaction-effects role="group" aria-label="更多出场方式" ${
      reactionEffectsExpanded ? '' : 'hidden'
    }>${extra
      .map(effectButtonMarkup)
      .join(
        ''
      )}</div><div class="reaction-effects-more-wrap"><button type="button" class="quiet reaction-effects-toggle" data-toggle-more-effects aria-expanded="${reactionEffectsExpanded}">${
      reactionEffectsExpanded
        ? '收起更多登场方式'
        : `展开更多登场方式（${extra.length}）`
    }</button></div>`;
    return primaryHtml + extraHtml;
  }

  function studioMarkup() {
    return `<section class="reaction-studio glass" aria-label="互动应援"><div class="section-heading"><div><p class="section-label">把气氛送上舞台</p><h2>互动应援站</h2></div><span class="reaction-hint">选角色、选出场方式，再把表情送上舞台</span></div><div class="reaction-characters" role="group" aria-label="选择角色">${reactionCharacters
      .map(
        item =>
          `<button type="button" data-character-choice="${
            item.id
          }" aria-pressed="${
            item.id === reactionCharacter
          }"><span class="reaction-preview" data-reaction-preview="10" data-preview-character="${
            item.id
          }" aria-hidden="true"></span><strong>${item.label}</strong></button>`
      )
      .join(
        ''
      )}</div>${reactionEffectsMarkup()}<div class="reaction-custom"><button type="button" data-custom-reaction aria-expanded="false" aria-controls="reaction-custom-editor">自定义内容</button><div id="reaction-custom-editor" data-reaction-custom-editor hidden><label>这次想说的话<input type="text" data-reaction-custom-text maxlength="80" autocomplete="off" placeholder="例如：这首唱给今晚的你" /></label><div class="reaction-custom-actions"><small data-reaction-text-count>0 / 40</small><button type="button" data-clear-reaction-text>恢复默认文字</button></div><p>填写后替换应援文字，留空使用默认内容。</p></div></div><p class="reaction-instruction">选一个表情，把应援送上舞台</p><div class="reaction-grid">${reactionCardsMarkup()}</div><p class="reaction-feedback" role="status" data-reaction-feedback>你的应援将出现在主屏和副屏</p></section>`;
  }

  function tabMarkup() {
    return '<button type="button" role="tab" data-module-tab="reactions">互动应援</button>';
  }

  function updateCustomText() {
    const input = app.querySelector('[data-reaction-custom-text]');
    if (!input) return;
    const length = Array.from(input.value).length;
    const count = app.querySelector('[data-reaction-text-count]');
    count.textContent = `${length} / 40`;
    count.classList.toggle('over-limit', length > 40);
    app.querySelector('[data-custom-reaction]').textContent = input.value.trim()
      ? '自定义内容 · 使用中'
      : '自定义内容';
  }

  function renderReactionGrid() {
    const grid = app.querySelector('.reaction-grid');
    if (grid) grid.innerHTML = reactionCardsMarkup();
    loadPreviews();
  }

  async function loadPreviews() {
    const version = ++reactionPreviewVersion;
    try {
      const [ball, mates] = await Promise.all([
        loadEmotionBall(),
        loadMoodMates(),
      ]);
      if (version !== reactionPreviewVersion) return;
      app.querySelectorAll('[data-reaction-preview]').forEach(node => {
        const character = node.dataset.previewCharacter || reactionCharacter;
        const key = `${character}:${node.dataset.reactionPreview}`;
        if (node.dataset.rendered === key) return;
        const library = character === 'ball' ? ball : mates;
        node.innerHTML = '';
        const instance = library.create(node, {
          character,
          emotion: node.dataset.reactionPreview,
          autostart: false,
          idle: false,
          lite: true,
        });
        const markup = node.innerHTML;
        instance.destroy();
        node.innerHTML = markup;
        node.dataset.rendered = key;
      });
    } catch (_) {
      if (version === reactionPreviewVersion)
        setNotice('角色预览加载失败，请重新打开互动应援', 'error');
    }
  }

  async function sendReaction(kind, button) {
    if (!getClientToken()) {
      setNotice('正在连接房间，请稍后再试', 'error');
      return;
    }
    button.disabled = true;
    try {
      const effect = reactionEffect;
      const customText = normalizeReactionText(
        app.querySelector('[data-reaction-custom-text]')?.value
      );
      const result = await api('/reactions', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          effect,
          character: reactionCharacter,
          ...(kind === 'emotion'
            ? { emotionId: button.dataset.emotionId }
            : {}),
          ...(customText ? { customText } : {}),
        }),
      });
      const labelText =
        customText ||
        resolveReaction({ kind, emotionId: button.dataset.emotionId })?.label ||
        '应援';
      const isQueued = result?.status === 'queued';
      const isReplaced = result?.status === 'replaced';
      setNotice(
        isQueued
          ? `已加入排队（第 ${result.queuePosition || 1} 位），即将登场`
          : isReplaced
          ? '已更新当前登场表情'
          : '表情已送出',
        'success'
      );
      const feedback = app.querySelector('[data-reaction-feedback]');
      if (feedback)
        feedback.textContent = isQueued
          ? `排队中「${labelText}」· 第 ${result.queuePosition || 1} 位等待登场`
          : `已送出「${labelText}」· 看看舞台上的角色`;
    } catch (error) {
      setNotice(
        (error.code || error.message) === 'INVALID_REACTION_TEXT'
          ? '自定义内容最多40个字符，请缩短后发送'
          : error.code === 'REACTION_QUEUE_FULL'
          ? '当前舞台互动较多，请稍后再试'
          : error.code === 'RATE_LIMIT'
          ? '发送太快，请稍后再试'
          : '表情发送失败，请稍后重试',
        'error'
      );
    } finally {
      schedule(() => {
        if (button.isConnected) button.disabled = false;
      }, 500);
    }
  }

  function bind() {
    app.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.characterChoice) {
        reactionCharacter = button.dataset.characterChoice;
        app
          .querySelectorAll('[data-character-choice]')
          .forEach(item =>
            item.setAttribute('aria-pressed', String(item === button))
          );
        renderReactionGrid();
      } else if (button.hasAttribute('data-custom-reaction')) {
        const editor = app.querySelector('[data-reaction-custom-editor]');
        editor.hidden = !editor.hidden;
        button.setAttribute('aria-expanded', String(!editor.hidden));
        if (!editor.hidden)
          app.querySelector('[data-reaction-custom-text]').focus();
      } else if (button.hasAttribute('data-clear-reaction-text')) {
        app.querySelector('[data-reaction-custom-text]').value = '';
        updateCustomText();
      } else if (button.hasAttribute('data-toggle-more-effects')) {
        reactionEffectsExpanded = !reactionEffectsExpanded;
        const moreContainer = app.querySelector('[data-more-reaction-effects]');
        if (moreContainer) moreContainer.hidden = !reactionEffectsExpanded;
        button.setAttribute('aria-expanded', String(reactionEffectsExpanded));
        const hiddenCount = Math.max(0, randomizedReactionEffects.length - 6);
        button.textContent = reactionEffectsExpanded
          ? '收起更多登场方式'
          : `展开更多登场方式（${hiddenCount}）`;
      } else if (button.dataset.effectChoice) {
        reactionEffect = button.dataset.effectChoice;
        app
          .querySelectorAll('[data-effect-choice]')
          .forEach(item =>
            item.setAttribute('aria-pressed', String(item === button))
          );
      } else if (button.dataset.reaction) {
        sendReaction(button.dataset.reaction, button);
      }
    });
    app
      .querySelector('[data-reaction-custom-text]')
      ?.addEventListener('input', updateCustomText);
  }

  return {
    bind,
    loadPreviews,
    studioMarkup,
    tabMarkup,
  };
}

module.exports = { createReactionController };
