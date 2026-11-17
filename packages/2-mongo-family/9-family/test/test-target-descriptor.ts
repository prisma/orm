import type { ControlTargetDescriptor } from '@internal/framework-components/control';

/**
 * Minimal stub `MigratableTargetDescriptor` for tests that only need a
 * target slot on the control stack. Real target wiring lives in
 * `@internal/target-mongo`; pulling that package in here would
 * recreate the `family-mongo → target-mongo` runtime cycle this
 * milestone severs (`adapter-mongo` and `target-mongo` already depend
 * on `family-mongo`; the family layer must stay leaf-clean).
 */
export const stubMongoTargetDescriptor: ControlTargetDescriptor<'mongo', 'mongo'> = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  defaultNamespaceId: '__unbound__',
  version: '0.0.1',
  // Tests using this stub reject before any real serialization runs (the
  // family instance deserializes contracts itself, not via this slot).
  contractSerializer: {
    deserializeContract() {
      throw new Error('stubMongoTargetDescriptor has no contract serializer');
    },
    serializeContract() {
      throw new Error('stubMongoTargetDescriptor has no contract serializer');
    },
  },
  create() {
    return { familyId: 'mongo', targetId: 'mongo' };
  },
};
