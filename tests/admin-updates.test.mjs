import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAdminUpdateConfig, DEFAULT_UPDATE_CONFIG, resolveStartupUpdateConfig, validateUpdateConfig } from '../src/config/updates.js';

test('desktop headerControl is locked and rejected server-side when changed', () => {
  const bad = structuredClone(DEFAULT_UPDATE_CONFIG);
  bad.desktop.headerControl = 'hidden';
  const result = validateUpdateConfig(bad, { latest: { windows: '0.1.0' } });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /headerControl/);
  assert.throws(() => applyAdminUpdateConfig(DEFAULT_UPDATE_CONFIG, bad, { latest: { windows: '0.1.0' } }), /headerControl/);
});

test('mobile cadence has no every-check option and off only affects prompt cadence', () => {
  const bad = structuredClone(DEFAULT_UPDATE_CONFIG);
  bad.mobile.promptCadence = 'every-check';
  const result = validateUpdateConfig(bad, {});
  assert.equal(result.ok, false);
  const off = structuredClone(DEFAULT_UPDATE_CONFIG);
  off.mobile.promptCadence = 'off';
  const valid = validateUpdateConfig(off, {});
  assert.equal(valid.ok, true);
  assert.equal(valid.config.desktop.manualCheckThrottleSeconds, 20);
});

test('minSupported cannot be higher than latest per platform', () => {
  const bad = structuredClone(DEFAULT_UPDATE_CONFIG);
  bad.minSupported.windows = '2.0.0';
  const result = validateUpdateConfig(bad, { latest: { windows: '1.0.0' } });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /minSupported\.windows/);
});

test('autoInstall requires autoDownload and explicit confirmation', () => {
  const bad = structuredClone(DEFAULT_UPDATE_CONFIG);
  bad.desktop.autoInstall = true;
  assert.match(validateUpdateConfig(bad, {}).errors.join('\n'), /autoInstall requires desktop\.autoDownload/);
  bad.desktop.autoDownload = true;
  assert.match(validateUpdateConfig(bad, {}).errors.join('\n'), /explicit confirmation/);
  assert.equal(validateUpdateConfig(bad, { confirmedAutomationTradeoffs: true }).ok, true);
});

test('rollout changes are audited with actor and before/after payloads', () => {
  const next = structuredClone(DEFAULT_UPDATE_CONFIG);
  next.rollout.percent = 25;
  const result = applyAdminUpdateConfig(DEFAULT_UPDATE_CONFIG, next, { actor: 'alice', now: '2026-10-02T12:00:00Z', confirmedAutomationTradeoffs: false });
  assert.equal(result.audit.length, 1);
  assert.equal(result.audit[0].actor, 'alice');
  assert.equal(result.audit[0].before.percent, 100);
  assert.equal(result.audit[0].after.percent, 25);
});

test('startup config falls back to last-known-good then safe degraded defaults', () => {
  const lkg = structuredClone(DEFAULT_UPDATE_CONFIG);
  lkg.desktop.autoCheck = true;
  const fromLkg = resolveStartupUpdateConfig({ lastKnownGood: lkg });
  assert.equal(fromLkg.source, 'last-known-good');
  assert.equal(fromLkg.config.desktop.autoCheck, false);
  const degraded = resolveStartupUpdateConfig({});
  assert.equal(degraded.source, 'defaults-degraded');
  assert.equal(degraded.config.desktop.autoDownload, false);
  assert.equal(degraded.config.mobile.promptCadence, 'per-open');
});
