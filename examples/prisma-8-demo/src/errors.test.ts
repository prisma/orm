import { describe, expect, it } from 'vitest';
import { MissingNamespaceError } from './errors';

describe('demo errors', () => {
  it('MissingNamespaceError names the surface and namespace', () => {
    const error = new MissingNamespaceError('public', 'ORM client');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'MissingNamespaceError',
      message: "ORM client is missing the 'public' namespace",
    });
  });
});
