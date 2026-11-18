import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { soleDomainNamespaceId } from '../src/default-namespace';

function capture(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return expect.unreachable('expected the call to throw');
}

describe('soleDomainNamespaceId', () => {
  it('throws CONTRACT.NAMESPACE_INVALID when the domain declares no namespaces', () => {
    const error = capture(() => soleDomainNamespaceId({ namespaces: {} }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.NAMESPACE_INVALID',
      message: 'domain has no namespaces',
    });
  });

  it('returns the namespace when exactly one is declared', () => {
    expect(soleDomainNamespaceId({ namespaces: { auth: {} } })).toBe('auth');
  });

  it('throws CONTRACT.NAMESPACE_INVALID when more than one namespace is declared rather than guessing', () => {
    const error = capture(() => soleDomainNamespaceId({ namespaces: { auth: {}, public: {} } }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.NAMESPACE_INVALID' });
  });
});
