// Fetch the original, pinned MIT model exports. No inference runs in this script.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const manifestFile = path.join(
  root,
  'vendor/folia-analysis/shared/modelManifest.json'
);
const output = path.join(root, 'public/pv/models');

async function matches(file, model) {
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size !== model.bytes) return false;
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex') === model.sha256;
  } catch (_) {
    return false;
  }
}

async function fetchModels() {
  const manifest = JSON.parse(await fs.promises.readFile(manifestFile, 'utf8'));
  await fs.promises.mkdir(output, { recursive: true });
  for (const model of manifest.models) {
    if (
      !/^(beat_this|htdemucs)-wgsl\.bin$/.test(model.file) ||
      !/^[a-f0-9]{64}$/.test(model.sha256) ||
      !Number.isSafeInteger(model.bytes) ||
      model.bytes <= 0 ||
      model.bytes > 100 * 1024 * 1024
    )
      throw new Error('INVALID_FOLIA_MODEL_MANIFEST');
    const destination = path.join(output, model.file);
    if (await matches(destination, model)) {
      console.log(`${model.name}: verified existing model`);
      continue;
    }
    const temporary = `${destination}.download`;
    const cached = process.env.FOLIA_MODEL_CACHE
      ? path.join(process.env.FOLIA_MODEL_CACHE, model.file)
      : null;
    if (cached && (await matches(cached, model))) {
      await fs.promises.copyFile(cached, temporary);
    } else {
      let ready = false;
      for (const mirror of manifest.mirrors) {
        const url = mirror.replace('{file}', model.file);
        if (!url.startsWith('https://')) continue;
        const args = [
          '--fail',
          '--location',
          '--retry',
          '1',
          '--connect-timeout',
          '20',
          '--max-time',
          '900',
          '--output',
          temporary,
          url,
        ];
        const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
        if (proxy) args.push('--proxy', proxy);
        const result = spawnSync('curl', args, {
          stdio: 'inherit',
          shell: false,
        });
        if (result.status === 0 && (await matches(temporary, model))) {
          ready = true;
          break;
        }
        await fs.promises.unlink(temporary).catch(() => {});
      }
      if (!ready) throw new Error(`FOLIA_MODEL_UNAVAILABLE:${model.name}`);
    }
    if (!(await matches(temporary, model)))
      throw new Error(`FOLIA_MODEL_INTEGRITY_FAILED:${model.name}`);
    await fs.promises.rename(temporary, destination);
    console.log(`${model.name}: installed; size and SHA-256 verified`);
  }
}

module.exports = { fetchModels, matches };
if (require.main === module)
  fetchModels().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
