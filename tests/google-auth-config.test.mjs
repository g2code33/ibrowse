import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGoogleClientId, resolveGoogleClientSecret } from '../electron/googleAuthConfig.cjs';

function fakeFs(files = {}) {
  return {
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p) => files[p]
  };
}

test('resolveGoogleClientId: prefers the YAYRA_GOOGLE_CLIENT_ID environment variable', () => {
  const id = resolveGoogleClientId({
    env: { YAYRA_GOOGLE_CLIENT_ID: '  env-client-id  ' },
    fs: fakeFs(),
    configDir: '/app/electron'
  });
  assert.equal(id, 'env-client-id');
});

test('resolveGoogleClientId: falls back to electron/google-auth.config.json when env is unset', () => {
  const id = resolveGoogleClientId({
    env: {},
    fs: fakeFs({ '/app/electron/google-auth.config.json': JSON.stringify({ clientId: 'file-client-id' }) }),
    configDir: '/app/electron'
  });
  assert.equal(id, 'file-client-id');
});

test('resolveGoogleClientId: returns null (not a throw) when neither source is configured', () => {
  const id = resolveGoogleClientId({ env: {}, fs: fakeFs(), configDir: '/app/electron' });
  assert.equal(id, null);
});

test('resolveGoogleClientId: returns null for a malformed config file instead of throwing', () => {
  const id = resolveGoogleClientId({
    env: {},
    fs: fakeFs({ '/app/electron/google-auth.config.json': 'not valid json' }),
    configDir: '/app/electron'
  });
  assert.equal(id, null);
});

test('resolveGoogleClientId: returns null when the config file has no clientId field', () => {
  const id = resolveGoogleClientId({
    env: {},
    fs: fakeFs({ '/app/electron/google-auth.config.json': JSON.stringify({ foo: 'bar' }) }),
    configDir: '/app/electron'
  });
  assert.equal(id, null);
});

test('resolveGoogleClientSecret: prefers the YAYRA_GOOGLE_CLIENT_SECRET environment variable', () => {
  const secret = resolveGoogleClientSecret({
    env: { YAYRA_GOOGLE_CLIENT_SECRET: '  env-secret  ' },
    fs: fakeFs(),
    configDir: '/app/electron'
  });
  assert.equal(secret, 'env-secret');
});

test('resolveGoogleClientSecret: falls back to electron/google-auth.config.json when env is unset', () => {
  const secret = resolveGoogleClientSecret({
    env: {},
    fs: fakeFs({ '/app/electron/google-auth.config.json': JSON.stringify({ clientId: 'id', clientSecret: 'file-secret' }) }),
    configDir: '/app/electron'
  });
  assert.equal(secret, 'file-secret');
});

test('resolveGoogleClientSecret: returns null (not a throw) when neither source is configured', () => {
  const secret = resolveGoogleClientSecret({ env: {}, fs: fakeFs(), configDir: '/app/electron' });
  assert.equal(secret, null);
});

test('resolveGoogleClientSecret: returns null for a malformed config file instead of throwing', () => {
  const secret = resolveGoogleClientSecret({
    env: {},
    fs: fakeFs({ '/app/electron/google-auth.config.json': 'not valid json' }),
    configDir: '/app/electron'
  });
  assert.equal(secret, null);
});

test('resolveGoogleClientId and resolveGoogleClientSecret read independent fields from the same config file', () => {
  const fs = fakeFs({ '/app/electron/google-auth.config.json': JSON.stringify({ clientId: 'id-only' }) });
  assert.equal(resolveGoogleClientId({ env: {}, fs, configDir: '/app/electron' }), 'id-only');
  assert.equal(resolveGoogleClientSecret({ env: {}, fs, configDir: '/app/electron' }), null);
});
