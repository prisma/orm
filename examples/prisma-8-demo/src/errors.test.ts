import { describe, expect, it } from 'vitest';
import { AppConfigError, MissingNamespaceError, NotFoundError } from './errors';

describe('demo errors', () => {
  it('AppConfigError carries its name and message', () => {
    const error = new AppConfigError('bad config');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'AppConfigError', message: 'bad config' });
  });

  it('NotFoundError carries its name and message', () => {
    const error = new NotFoundError('Post not found: 1');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'NotFoundError', message: 'Post not found: 1' });
  });

  it('MissingNamespaceError names the surface and namespace', () => {
    const error = new MissingNamespaceError('public', 'ORM client');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'MissingNamespaceError',
      message: "ORM client is missing the 'public' namespace",
    });
  });
});
