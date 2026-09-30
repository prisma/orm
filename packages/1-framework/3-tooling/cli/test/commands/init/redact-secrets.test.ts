import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../../../src/commands/init/redact-secrets';

describe('redactSecrets', () => {
  describe('credentials inside a URL', () => {
    it('redacts userinfo from URLs in stderr', () => {
      expect(redactSecrets('failed: https://user:pass@registry.example.com/foo')).toBe(
        'failed: https://****:****@registry.example.com/foo',
      );
    });

    it('redacts a bare token URL', () => {
      expect(redactSecrets('npm error: https://npm-token-123@registry.npmjs.org/')).toBe(
        'npm error: https://****@registry.npmjs.org/',
      );
    });

    it('redacts even when the URL is in the middle of a longer line', () => {
      expect(
        redactSecrets('GET https://alice:secret@registry.example.com/foo failed: 401 Unauthorized'),
      ).toBe('GET https://****:****@registry.example.com/foo failed: 401 Unauthorized');
    });

    it('redacts up to the last @ of the authority', () => {
      expect(redactSecrets('failed: https://user:p@ss@registry.example.com/foo')).toBe(
        'failed: https://****:****@registry.example.com/foo',
      );
    });

    it('leaves an @ in the path alone', () => {
      expect(redactSecrets('404 GET https://registry.npmjs.org/@prisma%2fclient')).toBe(
        '404 GET https://registry.npmjs.org/@prisma%2fclient',
      );
    });

    it('leaves URLs without userinfo untouched', () => {
      expect(redactSecrets('ENOTFOUND https://registry.npmjs.org/')).toBe(
        'ENOTFOUND https://registry.npmjs.org/',
      );
    });
  });

  describe('credentials in npmrc-shaped registry settings', () => {
    it('redacts an auth token', () => {
      expect(redactSecrets('config //registry.npmjs.org/:_authToken=npm_abc123DEF')).toBe(
        'config //registry.npmjs.org/:_authToken=***',
      );
    });

    it('redacts legacy basic-auth settings', () => {
      expect(
        redactSecrets('//nexus.internal/repo/:_auth=Zm9vOmJhcg== and :_password=hunter2'),
      ).toBe('//nexus.internal/repo/:_auth=*** and :_password=***');
    });

    it('redacts a top-level setting with no registry scope', () => {
      expect(redactSecrets('config _authToken=npm_abc123DEF and _password=hunter2')).toBe(
        'config _authToken=*** and _password=***',
      );
    });

    it('leaves a setting with no credential in it alone', () => {
      expect(redactSecrets('//registry.npmjs.org/:always-auth=true')).toBe(
        '//registry.npmjs.org/:always-auth=true',
      );
    });
  });

  it('handles empty input', () => {
    expect(redactSecrets('')).toBe('');
  });
});
