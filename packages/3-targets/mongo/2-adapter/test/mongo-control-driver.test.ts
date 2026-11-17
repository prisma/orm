import type { ControlDriverInstance } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { isMongoControlDriver } from '../src/core/migrations/mongo-control-driver';

const taggedClose = { familyId: 'mongo', targetId: 'mongo', close: async () => {} } as const;

describe('isMongoControlDriver', () => {
  it('true when the mongo control driver exposes an execute() transport', () => {
    const driver = { ...taggedClose, execute: async function* () {} };
    expect(isMongoControlDriver(driver)).toBe(true);
  });

  it('false when the execute() transport is absent — matching tags alone are not enough', () => {
    expect(isMongoControlDriver(taggedClose)).toBe(false);
  });

  it('false when targetId is not mongo even with an execute() transport', () => {
    const driver: ControlDriverInstance<'mongo', string> = {
      familyId: 'mongo',
      targetId: 'other',
      close: async () => {},
      execute: async function* () {},
    } as ControlDriverInstance<'mongo', string>;
    expect(isMongoControlDriver(driver)).toBe(false);
  });
});
