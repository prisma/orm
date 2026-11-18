import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { suppressIdleConnectionErrors } from '../src/suppress-idle-connection-errors';

describe('suppressIdleConnectionErrors', () => {
  it('an attached emitter survives an emitted error', () => {
    const emitter = suppressIdleConnectionErrors(new EventEmitter());
    expect(() => emitter.emit('error', new Error('connection dropped'))).not.toThrow();
  });

  it('returns the same instance it was given', () => {
    const emitter = new EventEmitter();
    expect(suppressIdleConnectionErrors(emitter)).toBe(emitter);
  });

  it('is idempotent per emitter: repeated calls attach a single listener', () => {
    const emitter = new EventEmitter();
    suppressIdleConnectionErrors(emitter);
    suppressIdleConnectionErrors(emitter);
    suppressIdleConnectionErrors(emitter);
    expect(emitter.listenerCount('error')).toBe(1);
  });
});
