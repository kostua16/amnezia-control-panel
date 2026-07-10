import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPartialProvisioning,
  hasProvisioningConfig,
  shouldReactivateAfterProvisioningRetry,
} from '../provisioning-state';

describe('provisioning-state helpers', () => {
  it('treats only non-empty object config as provisioned', () => {
    assert.strictEqual(hasProvisioningConfig({ peer: 'awg' }), true);
    assert.strictEqual(hasProvisioningConfig({}), false);
    assert.strictEqual(hasProvisioningConfig(null), false);
    assert.strictEqual(hasProvisioningConfig([]), false);
  });

  it('flags inactive protocols without config as partial provisioning', () => {
    assert.strictEqual(
      hasPartialProvisioning([
        { isActive: true, config: { peer: 'awg' } },
        { isActive: false, config: {} },
      ]),
      true,
    );
    assert.strictEqual(
      hasPartialProvisioning([{ isActive: false, config: { removed: true } }]),
      false,
    );
  });

  it('reactivates only users whose assigned protocols were all unprovisioned', () => {
    assert.strictEqual(
      shouldReactivateAfterProvisioningRetry(
        [
          { isActive: false, config: {} },
          { isActive: false, config: {} },
        ],
        2,
      ),
      true,
    );
    assert.strictEqual(
      shouldReactivateAfterProvisioningRetry(
        [
          { isActive: false, config: {} },
          { isActive: false, config: { removed: true } },
        ],
        1,
      ),
      false,
    );
    assert.strictEqual(
      shouldReactivateAfterProvisioningRetry(
        [
          { isActive: false, config: {} },
          { isActive: true, config: { peer: 'awg' } },
        ],
        1,
      ),
      false,
    );
  });
});
