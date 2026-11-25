#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const suites = [
  {
    name: 'Room, guest access, API and search rate limiting',
    tests: [
      'test-karaoke-web-host.js',
      'test-karaoke-public-guest.js',
      'test-karaoke-remote-api.js',
      'test-karaoke-request-submission.js',
      'test-upstream-search-rate-limit.js',
      'test-karaoke-lifecycle.js',
      'test-karaoke-local-library.js',
      'test-karaoke-reactions.js',
      'test-reaction-loader.js',
      'test-reaction-assets.cjs',
    ],
  },
  {
    name: 'Catalog pagination',
    tests: [
      'test-karaoke-catalog-pagination-api.js',
      'test-karaoke-catalog-pagination-ui.js',
    ],
  },
  {
    name: 'Playback',
    tests: ['test-karaoke-player.js', 'test-karaoke-recovery.js'],
  },
  {
    name: 'Primary and secondary displays',
    tests: [
      'test-karaoke-web-bridge.js',
      'test-karaoke-display.js',
      'test-karaoke-display-client.js',
      'test-karaoke-display-preferences.js',
      'test-karaoke-display-lifecycle.js',
      'test-karaoke-display-analysis-retry.js',
    ],
  },
  {
    name: 'Karaoke panels',
    tests: ['test-karaoke-queue-panel.js', 'test-karaoke-room-access-panel.js'],
  },
  {
    name: 'Guest page modules',
    tests: [
      '../src/remote/previewController.test.cjs',
      '../src/remote/remoteStatus.test.cjs',
      '../src/remote/searchLogic.test.cjs',
      '../src/remote/reactionController.test.cjs',
      '../src/remote/remoteCapabilities.test.cjs',
      '../src/remote/remoteApi.test.cjs',
      '../src/remote/playbackQueueRenderer.test.cjs',
      '../src/remote/reactionEntry.test.cjs',
    ],
  },
  {
    name: 'Multi-room gateway and guest resources',
    tests: [
      'test-multiroom-gateway.cjs',
      'test-host-connector.cjs',
      'test-host-reconnect.cjs',
      'test-desktop-public-adapter.cjs',
      'test-multiroom-desktop-e2e.cjs',
      'test-karaoke-multiroom-host.cjs',
      'test-isolate-remote-assets.js',
      'test-public-guest-static-paths.js',
    ],
  },
];

const testCount = suites.reduce(
  (count, suite) => count + suite.tests.length,
  0
);
let passed = 0;

console.log(`KTV quick regression: ${testCount} local tests`);

for (const suite of suites) {
  console.log(`\n=== ${suite.name} ===`);
  for (const test of suite.tests) {
    const testPath = path.join(__dirname, test);
    console.log(`\n> node scripts/${test}`);
    const result = spawnSync(process.execPath, [testPath], {
      cwd: root,
      stdio: 'inherit',
    });

    if (result.error) {
      console.error(`Unable to run ${test}: ${result.error.message}`);
      process.exitCode = 1;
      return;
    }

    if (result.status !== 0) {
      if (result.signal) console.error(`${test} stopped by ${result.signal}`);
      process.exitCode = result.status || 1;
      return;
    }

    passed += 1;
  }
}

console.log(`\nPASS: ${passed}/${testCount} KTV quick regression tests`);
