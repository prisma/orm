import { describe, expect, it } from 'vitest';
import { isRuntimeError, runtimeAborted } from '../src/execution/runtime-error';

describe('runtimeAborted()', () => {
  it('produces a runtime-error envelope with code RUNTIME.ABORTED', () => {
    const err = runtimeAborted('encode');
    expect(isRuntimeError(err)).toBe(true);
    expect(err.code).toBe('RUNTIME.ABORTED');
    expect(err.category).toBe('RUNTIME');
    expect(err.severity).toBe('error');
  });

  it('records the phase in details', () => {
    expect(runtimeAborted('encode').details).toEqual({ phase: 'encode' });
    expect(runtimeAborted('decode').details).toEqual({ phase: 'decode' });
    expect(runtimeAborted('stream').details).toEqual({ phase: 'stream' });
  });

  it('attaches the supplied cause', () => {
    const reason = new Error('caller cancelled');
    const err = runtimeAborted('stream', reason);
    expect(err.cause).toBe(reason);
  });

  it('leaves cause undefined when no cause is supplied', () => {
    const err = runtimeAborted('stream');
    expect(err.cause).toBeUndefined();
  });

  it('passes through a string reason as-is on cause', () => {
    const err = runtimeAborted('decode', 'user cancelled');
    expect(err.cause).toBe('user cancelled');
  });
});
