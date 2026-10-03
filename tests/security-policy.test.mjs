import test from 'node:test';
import assert from 'node:assert/strict';
import { DefaultSecurityPolicy } from '../packages/browser-contract/src/ISecurityPolicy.js';

test('DefaultSecurityPolicy blocks dangerous protocols and allows valid web schemes', () => {
  const policy = new DefaultSecurityPolicy();

  assert.equal(policy.validateUrl('https://yayra.app').allowed, true);
  assert.equal(policy.validateUrl('http://insecure.site').allowed, true);
  assert.equal(policy.validateUrl('file:///etc/passwd').allowed, false);
  assert.equal(policy.validateUrl('javascript:alert(1)').allowed, false);
  assert.equal(policy.validateUrl('vbscript:msgbox').allowed, false);
});
