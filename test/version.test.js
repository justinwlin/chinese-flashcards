import assert from 'node:assert/strict';
import test from 'node:test';
import { formatVersionLabel } from '../src/lib/version.js';

test('the version label includes the release, commit, and local build time', () => {
  const label = formatVersionLabel({
    version: '1.1.0',
    sha: '3823230',
    builtAt: '2026-10-31T07:45:00.000Z',
    locales: 'en-US',
    timeZone: 'America/New_York',
  });
  assert.equal(label, 'v1.1.0 · 3823230 · built Oct 31, 3:45 AM');
});
