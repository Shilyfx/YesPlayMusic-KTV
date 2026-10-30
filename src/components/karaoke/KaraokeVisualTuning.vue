<template>
  <section
    class="ktv-visual-tuning"
    :aria-label="`${sectionTitle}参数`"
    :aria-disabled="disabled ? 'true' : 'false'"
  >
    <header class="ktv-tuning-heading">
      <div>
        <h3>{{ sectionTitle }}</h3>
        <p>默认值来自原始样式配置；仅保存已修改的项目。</p>
      </div>
      <button type="button" :disabled="disabled" @click="resetTuning">
        恢复默认
      </button>
    </header>

    <div v-if="!flatFields.length" class="ktv-tuning-empty">
      此样式没有额外的可调参数。
    </div>

    <div class="ktv-tuning-fields">
      <div
        v-for="field in flatFields"
        :key="field.key"
        class="ktv-tuning-field"
        :class="[`is-${field.type}`, { 'is-nested': field.depth > 0 }]"
        :style="field.depth ? { '--tuning-depth': field.depth } : null"
      >
        <template v-if="field.type === 'boolean'">
          <label class="ktv-tuning-toggle">
            <span>{{ field.label }}</span>
            <input
              type="checkbox"
              :checked="Boolean(readField(field.key))"
              :disabled="disabled"
              @change="updateField(field, $event.target.checked)"
            />
          </label>
        </template>

        <template v-else-if="field.type === 'range'">
          <div class="ktv-tuning-label-row">
            <label :for="fieldInputId(field)">{{ field.label }}</label>
            <output :for="fieldInputId(field)">
              {{ formatNumber(readField(field.key), field.step) }}
            </output>
          </div>
          <input
            :id="fieldInputId(field)"
            type="range"
            :min="field.min"
            :max="field.max"
            :step="field.step || 'any'"
            :value="readField(field.key)"
            :disabled="disabled"
            @input="updateNumber(field, $event.target.value)"
          />
        </template>

        <template v-else-if="field.type === 'number'">
          <label :for="fieldInputId(field)">{{ field.label }}</label>
          <input
            :id="fieldInputId(field)"
            type="number"
            :min="field.min"
            :max="field.max"
            :step="field.step || 'any'"
            :value="readField(field.key)"
            :disabled="disabled"
            @change="updateNumber(field, $event.target.value)"
          />
        </template>

        <template v-else-if="field.type === 'select'">
          <label :for="fieldInputId(field)">{{ field.label }}</label>
          <select
            :id="fieldInputId(field)"
            :value="selectedOptionIndex(field, readField(field.key))"
            :disabled="disabled"
            @change="updateSelect(field, $event.target.value)"
          >
            <option
              v-for="(option, index) in field.options"
              :key="`${field.key}-${index}`"
              :value="String(index)"
            >
              {{ option.label }}
            </option>
          </select>
        </template>

        <template v-else-if="field.type === 'color'">
          <label :for="fieldInputId(field)">{{ field.label }}</label>
          <div class="ktv-tuning-color-row">
            <input
              :id="fieldInputId(field)"
              type="color"
              :value="colorInputValue(readField(field.key))"
              :disabled="disabled"
              @input="updateField(field, $event.target.value)"
            />
            <input
              type="text"
              maxlength="9"
              :value="readField(field.key)"
              :disabled="disabled"
              :aria-label="`${field.label}颜色代码`"
              @change="updateColor(field, $event.target.value)"
            />
          </div>
        </template>

        <template v-else-if="field.type === 'text'">
          <label :for="fieldInputId(field)">{{ field.label }}</label>
          <input
            :id="fieldInputId(field)"
            type="text"
            :maxlength="field.maxLength || 256"
            :value="readField(field.key)"
            :disabled="disabled"
            @change="updateField(field, $event.target.value)"
          />
        </template>

        <template v-else-if="field.type === 'asset-ref'">
          <span class="ktv-tuning-label">{{ field.label }}</span>
          <div class="ktv-asset-reference">
            <span v-if="readField(field.key)" :title="readField(field.key)">
              已关联 {{ shortAssetId(readField(field.key)) }}
            </span>
            <span v-else>尚未选择图片</span>
            <button
              v-if="readField(field.key)"
              type="button"
              :disabled="disabled"
              @click="updateField(field, null)"
            >
              移除
            </button>
          </div>
        </template>

        <template v-else-if="field.type === 'asset-refs'">
          <span class="ktv-tuning-label">{{ field.label }}</span>
          <div
            v-if="readField(field.key).length"
            class="ktv-asset-reference-list"
          >
            <div
              v-for="(assetId, index) in readField(field.key)"
              :key="assetId"
              class="ktv-asset-reference"
            >
              <span :title="assetId">{{ shortAssetId(assetId) }}</span>
              <button
                type="button"
                :disabled="disabled"
                @click="removeAssetRef(field, index)"
              >
                移除
              </button>
            </div>
          </div>
          <p v-else class="ktv-tuning-help">尚未添加素材。</p>
        </template>

        <template v-else-if="field.type === 'asset-list'">
          <span class="ktv-tuning-label">{{ field.label }}</span>
          <p v-if="!readField(field.key).length" class="ktv-tuning-help">
            上传图片后可调整每张贴图的位置、缩放和透明度。
          </p>
          <article
            v-for="(item, index) in readField(field.key)"
            :key="item.id || index"
            class="ktv-asset-item"
          >
            <div class="ktv-asset-item-heading">
              <span :title="item.name || item.id">
                {{ item.name || shortAssetId(item.id) || `贴图 ${index + 1}` }}
              </span>
              <button
                type="button"
                :disabled="disabled"
                @click="removeAssetItem(field, index)"
              >
                移除
              </button>
            </div>
            <div
              v-for="itemField in field.itemFields"
              :key="itemField.key"
              class="ktv-asset-item-field"
            >
              <label :for="assetItemInputId(field, index, itemField)">
                {{ itemField.label }}
              </label>
              <select
                v-if="itemField.type === 'select'"
                :id="assetItemInputId(field, index, itemField)"
                :value="selectedOptionIndex(itemField, item[itemField.key])"
                :disabled="disabled"
                @change="
                  updateAssetItemSelect(
                    field,
                    index,
                    itemField,
                    $event.target.value
                  )
                "
              >
                <option
                  v-for="(option, optionIndex) in itemField.options"
                  :key="`${itemField.key}-${optionIndex}`"
                  :value="String(optionIndex)"
                >
                  {{ option.label }}
                </option>
              </select>
              <template v-else>
                <output v-if="itemField.type === 'range'">
                  {{ formatNumber(item[itemField.key], itemField.step) }}
                </output>
                <input
                  :id="assetItemInputId(field, index, itemField)"
                  :type="itemField.type === 'range' ? 'range' : 'number'"
                  :min="itemField.min"
                  :max="itemField.max"
                  :step="itemField.step || 'any'"
                  :value="item[itemField.key]"
                  :disabled="disabled"
                  @input="
                    updateAssetItemNumber(
                      field,
                      index,
                      itemField,
                      $event.target.value
                    )
                  "
                />
              </template>
            </div>
          </article>
        </template>

        <template v-else-if="field.type === 'url-list'">
          <span class="ktv-tuning-label">{{ field.label }}</span>
          <div
            v-for="(item, index) in readField(field.key)"
            :key="item.id"
            class="ktv-url-item"
          >
            <label :for="`${fieldInputId(field)}-${index}`">
              网页背景 {{ index + 1 }} 地址
            </label>
            <div class="ktv-url-row">
              <input
                :id="`${fieldInputId(field)}-${index}`"
                type="url"
                maxlength="2048"
                :value="item.url"
                :disabled="disabled"
                placeholder="https://example.com/background.jpg"
                @change="updateUrlItem(field, index, $event.target.value)"
              />
              <button
                type="button"
                :disabled="disabled"
                :aria-label="`移除网页背景 ${index + 1}`"
                @click="removeUrlItem(field, index)"
              >
                移除
              </button>
            </div>
          </div>
          <div class="ktv-url-add-row">
            <input
              v-model="newUrl"
              type="url"
              maxlength="2048"
              :disabled="
                disabled || readField(field.key).length >= (field.maxItems || 8)
              "
              placeholder="输入 http 或 https 地址"
              aria-label="新增网页背景地址"
              @keydown.enter.prevent="addUrlItem(field)"
            />
            <button
              type="button"
              :disabled="
                disabled ||
                !newUrl.trim() ||
                readField(field.key).length >= (field.maxItems || 8)
              "
              @click="addUrlItem(field)"
            >
              添加
            </button>
          </div>
          <p class="ktv-tuning-help">
            仅接受公开的 HTTP 或 HTTPS 图片地址；不会把图片内容写入设置。
          </p>
        </template>

        <template v-else-if="field.type === 'url-selection'">
          <label :for="fieldInputId(field)">{{ field.label }}</label>
          <select
            :id="fieldInputId(field)"
            :value="readField(field.key) || ''"
            :disabled="disabled || !urlItems.length"
            @change="updateField(field, $event.target.value || null)"
          >
            <option value="">不指定</option>
            <option v-for="item in urlItems" :key="item.id" :value="item.id">
              {{ item.url }}
            </option>
          </select>
        </template>

        <template v-else-if="field.type === 'json'">
          <label :for="fieldInputId(field)">{{ field.label }}（高级）</label>
          <textarea
            :id="fieldInputId(field)"
            :value="jsonValue(field)"
            :maxlength="field.maxLength || 8192"
            :disabled="disabled"
            rows="4"
            spellcheck="false"
            @change="updateJson(field, $event.target.value)"
          ></textarea>
          <p
            v-if="jsonErrors[field.key]"
            class="ktv-tuning-error"
            role="status"
          >
            请输入有效的 JSON 数组或对象。
          </p>
        </template>
      </div>
    </div>

    <div v-if="assetActions.length" class="ktv-asset-actions">
      <label
        v-for="action in assetActions"
        :key="action.id"
        class="ktv-asset-upload"
        :class="{ disabled }"
      >
        <span>{{ action.label }}</span>
        <input
          type="file"
          :accept="action.accept || 'image/*'"
          :multiple="action.multiple === true"
          :disabled="disabled"
          @change="emitAsset(action, $event)"
        />
      </label>
    </div>
  </section>
</template>

<script>
import {
  getVisualBackgroundMetadata,
  getVisualModeMetadata,
  cloneVisualValue,
} from '@/karaoke/visualCatalog';

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function mergeValues(base, patch) {
  if (!isRecord(base) || !isRecord(patch))
    return patch === undefined
      ? cloneVisualValue(base)
      : cloneVisualValue(patch);
  const result = cloneVisualValue(base);
  Object.keys(patch).forEach(key => {
    result[key] =
      isRecord(result[key]) && isRecord(patch[key])
        ? mergeValues(result[key], patch[key])
        : cloneVisualValue(patch[key]);
  });
  return result;
}

function flattenFields(fields, depth = 0) {
  const result = [];
  (fields || []).forEach(field => {
    if (field.type === 'group') {
      result.push(...flattenFields(field.fields, depth + 1));
    } else {
      result.push({ ...field, depth });
    }
  });
  return result;
}

function readPath(source, path) {
  return path.split('.').reduce((value, key) => value && value[key], source);
}

function writePath(source, path, value) {
  const keys = path.split('.');
  let target = source;
  keys.slice(0, -1).forEach(key => {
    if (!isRecord(target[key])) target[key] = {};
    target = target[key];
  });
  target[keys[keys.length - 1]] = value;
  return source;
}

function clampNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  let next = number;
  if (Number.isFinite(field.min)) next = Math.max(field.min, next);
  if (Number.isFinite(field.max)) next = Math.min(field.max, next);
  if (field.step && Number.isInteger(field.step) && field.step >= 1)
    next = Math.round(next);
  return next;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value).trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return '';
    return url.href.length <= 2048 ? url.href : '';
  } catch (_) {
    return '';
  }
}

export default {
  name: 'KaraokeVisualTuning',
  props: {
    scope: { type: String, default: 'mode' },
    mode: { type: String, default: 'classic' },
    backgroundMode: { type: String, default: 'legacy' },
    config: { type: Object, default: () => ({}) },
    disabled: { type: Boolean, default: false },
  },
  data() {
    return { newUrl: '', jsonErrors: {} };
  },
  computed: {
    id() {
      return this.scope === 'background' ? this.backgroundMode : this.mode;
    },
    metadata() {
      return this.scope === 'background'
        ? getVisualBackgroundMetadata(this.id)
        : getVisualModeMetadata(this.id);
    },
    sectionTitle() {
      return this.scope === 'background'
        ? `${this.metadata ? this.metadata.label : '背景'}参数`
        : `${this.metadata ? this.metadata.label : '歌词样式'}参数`;
    },
    flatFields() {
      return flattenFields(this.metadata && this.metadata.fields);
    },
    assetActions() {
      return this.metadata ? this.metadata.assetActions || [] : [];
    },
    savedTuning() {
      if (this.scope === 'background')
        return (this.config.background && this.config.background.tuning) || {};
      return (
        (this.config.tuningByMode && this.config.tuningByMode[this.id]) || {}
      );
    },
    effectiveTuning() {
      return mergeValues(
        (this.metadata && this.metadata.tuningDefaults) || {},
        this.savedTuning
      );
    },
    urlItems() {
      const items = readPath(this.effectiveTuning, 'items');
      return Array.isArray(items) ? items : [];
    },
  },
  watch: {
    id() {
      this.newUrl = '';
      this.jsonErrors = {};
    },
  },
  methods: {
    fieldInputId(field) {
      return `ktv-tuning-${this.scope}-${this.id}-${field.key}`.replace(
        /[^a-zA-Z0-9_-]/g,
        '-'
      );
    },
    assetItemInputId(field, index, itemField) {
      return `${this.fieldInputId(field)}-${index}-${itemField.key}`.replace(
        /[^a-zA-Z0-9_-]/g,
        '-'
      );
    },
    readField(path) {
      return readPath(this.effectiveTuning, path);
    },
    formatNumber(value, step) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '0';
      const decimals =
        step && String(step).includes('.')
          ? Math.min(4, String(step).split('.')[1].length)
          : 0;
      return number.toFixed(decimals);
    },
    colorInputValue(value) {
      return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
        ? value
        : '#000000';
    },
    selectedOptionIndex(field, value) {
      const index = (field.options || []).findIndex(option =>
        Object.is(option.value, value)
      );
      return String(index < 0 ? 0 : index);
    },
    shortAssetId(value) {
      return typeof value === 'string' && value.length > 16
        ? `${value.slice(0, 8)}…${value.slice(-6)}`
        : value || '';
    },
    emitTuning(next) {
      this.$emit('change', {
        key: this.scope === 'background' ? 'background.tuning' : 'tuning',
        value: next,
      });
    },
    updateField(field, value) {
      const next = cloneVisualValue(this.effectiveTuning);
      writePath(next, field.key, value);
      this.emitTuning(next);
    },
    updateNumber(field, value) {
      const next = clampNumber(value, field);
      if (next !== undefined) this.updateField(field, next);
    },
    updateSelect(field, selectedIndex) {
      const option = (field.options || [])[Number(selectedIndex)];
      if (option) this.updateField(field, option.value);
    },
    updateColor(field, value) {
      if (/^#[\da-f]{6}$/i.test(value)) this.updateField(field, value);
    },
    updateAssetItem(field, index, itemField, value) {
      const items = cloneVisualValue(this.readField(field.key) || []);
      if (!items[index]) return;
      items[index][itemField.key] = value;
      this.updateField(field, items);
    },
    updateAssetItemNumber(field, index, itemField, value) {
      const next = clampNumber(value, itemField);
      if (next !== undefined)
        this.updateAssetItem(field, index, itemField, next);
    },
    updateAssetItemSelect(field, index, itemField, selectedIndex) {
      const option = (itemField.options || [])[Number(selectedIndex)];
      if (option) this.updateAssetItem(field, index, itemField, option.value);
    },
    removeAssetRef(field, index) {
      const refs = (this.readField(field.key) || []).slice();
      const removedId = refs[index];
      refs.splice(index, 1);
      if (this.id === 'tempera' && field.key === 'layerImageAssetIds') {
        const next = cloneVisualValue(this.effectiveTuning);
        writePath(next, field.key, refs);
        next.layerImages = (next.layerImages || []).filter(
          item => item.id !== removedId
        );
        this.emitTuning(next);
        return;
      }
      this.updateField(field, refs);
    },
    removeAssetItem(field, index) {
      const items = (this.readField(field.key) || []).slice();
      const removed = items[index];
      items.splice(index, 1);
      if (this.id === 'tempera' && field.key === 'layerImages') {
        const next = cloneVisualValue(this.effectiveTuning);
        writePath(next, field.key, items);
        if (removed && typeof removed.id === 'string') {
          next.layerImageAssetIds = (next.layerImageAssetIds || []).filter(
            id => id !== removed.id
          );
        }
        if (
          Array.isArray(next.layerImageNames) &&
          next.layerImageNames.length === items.length + 1
        ) {
          next.layerImageNames.splice(index, 1);
        }
        this.emitTuning(next);
        return;
      }
      this.updateField(field, items);
    },
    updateUrlItem(field, index, value) {
      const url = safeHttpUrl(value);
      if (!url) return;
      const items = cloneVisualValue(this.readField(field.key) || []);
      items[index] = { ...items[index], url };
      this.updateField(field, items);
    },
    removeUrlItem(field, index) {
      const items = (this.readField(field.key) || []).slice();
      const removed = items[index];
      items.splice(index, 1);
      const next = cloneVisualValue(this.effectiveTuning);
      writePath(next, field.key, items);
      if (next.selectedId === (removed && removed.id)) next.selectedId = null;
      this.emitTuning(next);
    },
    addUrlItem(field) {
      const url = safeHttpUrl(this.newUrl);
      const items = (this.readField(field.key) || []).slice();
      if (!url || items.length >= (field.maxItems || 8)) return;
      const id = `url-${Date.now().toString(36)}`;
      items.push({ id, url });
      this.newUrl = '';
      this.updateField(field, items);
    },
    jsonValue(field) {
      try {
        return JSON.stringify(this.readField(field.key), null, 2);
      } catch (_) {
        return '[]';
      }
    },
    updateJson(field, source) {
      try {
        const value = JSON.parse(source);
        if (!value || typeof value !== 'object')
          throw new Error('not a collection');
        this.updateField(field, value);
        this.$set(this.jsonErrors, field.key, false);
      } catch (_) {
        this.$set(this.jsonErrors, field.key, true);
      }
    },
    resetTuning() {
      this.$emit('change', {
        key: this.scope === 'background' ? 'background.reset' : 'tuning.reset',
        value: this.id,
      });
    },
    emitAsset(action, event) {
      const files = Array.from((event.target && event.target.files) || []);
      if (files.length) {
        this.$emit('asset', {
          scope: this.scope,
          id: this.id,
          role: action.role,
          key: action.key,
          files: action.multiple ? files : files.slice(0, 1),
        });
      }
      if (event.target) event.target.value = '';
    },
  },
};
</script>

<style scoped>
.ktv-visual-tuning {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  margin-top: 12px;
  padding: 14px;
  border: 1px solid
    color-mix(in srgb, var(--ktv-accent, #ab9cff) 24%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--ktv-bg-base, #17192a) 72%, transparent);
  color: var(--ktv-text-primary, #fff);
}

.ktv-visual-tuning input,
.ktv-visual-tuning select,
.ktv-visual-tuning textarea {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
}

.ktv-tuning-heading,
.ktv-tuning-label-row,
.ktv-asset-item-heading,
.ktv-url-row,
.ktv-url-add-row,
.ktv-asset-reference {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ktv-tuning-heading {
  margin-bottom: 12px;
}
.ktv-tuning-heading h3 {
  margin: 0;
  font-size: 1.012rem;
}
.ktv-tuning-heading p,
.ktv-tuning-help,
.ktv-tuning-empty {
  margin: 4px 0 0;
  color: var(--ktv-text-muted, rgba(255, 255, 255, 0.62));
  font-size: 0.836rem;
  line-height: 1.45;
}
.ktv-tuning-heading button,
.ktv-asset-reference button,
.ktv-asset-item-heading button,
.ktv-url-row button,
.ktv-url-add-row button,
.ktv-asset-upload {
  min-height: 32px;
  padding: 6px 10px;
  border: 1px solid
    color-mix(in srgb, var(--ktv-accent, #ab9cff) 34%, transparent);
  border-radius: 9px;
  background: transparent;
  color: var(--ktv-text-primary, #fff);
  font: inherit;
  font-size: 0.858rem;
  cursor: pointer;
}
.ktv-tuning-fields {
  display: grid;
  gap: 11px;
}
.ktv-tuning-field {
  min-width: 0;
  display: grid;
  gap: 6px;
  padding-left: calc(var(--tuning-depth, 0) * 12px);
}
.ktv-tuning-field label,
.ktv-tuning-label,
.ktv-tuning-label-row {
  color: var(--ktv-text-primary, #fff);
  font-size: 0.902rem;
}
.ktv-tuning-label-row output,
.ktv-asset-item-field output {
  color: var(--ktv-accent-strong, #d0c8ff);
  font-variant-numeric: tabular-nums;
}
.ktv-tuning-field input[type='range'],
.ktv-asset-item-field input[type='range'] {
  width: 100%;
  accent-color: var(--ktv-accent, #ab9cff);
}
.ktv-tuning-field input[type='number'],
.ktv-tuning-field input[type='text'],
.ktv-tuning-field input[type='url'],
.ktv-tuning-field select,
.ktv-tuning-field textarea,
.ktv-asset-item-field input[type='number'],
.ktv-asset-item-field select {
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid
    color-mix(in srgb, var(--ktv-accent, #ab9cff) 28%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--ktv-bg-base, #17192a) 76%, white 4%);
  color: var(--ktv-text-primary, #fff);
  font: inherit;
  font-size: 0.902rem;
}
.ktv-tuning-field textarea {
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.ktv-tuning-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ktv-tuning-toggle input {
  width: 18px;
  height: 18px;
  accent-color: var(--ktv-accent, #ab9cff);
}
.ktv-tuning-color-row {
  display: flex;
  gap: 8px;
}
.ktv-tuning-color-row input[type='color'] {
  width: 42px;
  min-width: 0;
  max-width: 100%;
  height: 38px;
  padding: 3px;
  border: 1px solid
    color-mix(in srgb, var(--ktv-accent, #ab9cff) 28%, transparent);
  border-radius: 9px;
  background: transparent;
}
.ktv-asset-reference-list,
.ktv-asset-item,
.ktv-url-item {
  display: grid;
  gap: 8px;
}
.ktv-asset-reference,
.ktv-asset-item,
.ktv-url-item {
  padding: 9px;
  border: 1px solid
    color-mix(in srgb, var(--ktv-accent, #ab9cff) 18%, transparent);
  border-radius: 10px;
}
.ktv-asset-reference span,
.ktv-asset-item-heading span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ktv-asset-item-field {
  display: grid;
  grid-template-columns: minmax(0, 0.7fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}
.ktv-asset-item-field label {
  min-width: 0;
  font-size: 0.836rem;
}
.ktv-url-add-row {
  margin-top: 8px;
}
.ktv-url-add-row input,
.ktv-url-row input {
  flex: 1;
  min-width: 0;
}
.ktv-asset-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.ktv-asset-upload {
  position: relative;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
}
.ktv-asset-upload input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.ktv-asset-upload.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ktv-tuning-error {
  margin: 0;
  color: #ff8d9d;
  font-size: 0.836rem;
}
.ktv-tuning-empty {
  padding: 8px 0;
}
button:disabled,
input:disabled,
select:disabled,
textarea:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
@media (max-width: 420px) {
  .ktv-tuning-heading {
    align-items: flex-start;
  }
  .ktv-asset-item-field {
    grid-template-columns: 1fr auto;
  }
  .ktv-asset-item-field label {
    grid-column: 1 / -1;
  }
}
</style>
