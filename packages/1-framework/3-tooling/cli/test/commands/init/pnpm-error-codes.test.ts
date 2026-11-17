import { describe, expect, it } from 'vitest';
import {
  isPnpmIgnoredBuildsError,
  isRecognisedPnpmResolutionError,
} from '../../../src/commands/init/pnpm-error-codes';

describe('isRecognisedPnpmResolutionError', () => {
  it('recognises a leaked workspace specifier', () => {
    expect(
      isRecognisedPnpmResolutionError(
        ' ERR_PNPM_WORKSPACE_PKG_NOT_FOUND  In : "is-number@workspace:*" is in the dependencies but no package named "is-number" is present in the workspace',
      ),
    ).toBe(true);
  });

  it('recognises a leaked catalog specifier', () => {
    expect(
      isRecognisedPnpmResolutionError(
        " ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER  is-number@catalog: isn't supported by any available resolver.",
      ),
    ).toBe(true);
  });

  it('ignores a version the registry does not have', () => {
    expect(
      isRecognisedPnpmResolutionError(
        ' ERR_PNPM_NO_MATCHING_VERSION  No matching version found for is-number@^999.0.0 while fetching it from the registry',
      ),
    ).toBe(false);
  });

  it('recognises a code whatever the wording around it', () => {
    expect(isRecognisedPnpmResolutionError('ERR_PNPM_WORKSPACE_PKG_NOT_FOUND')).toBe(true);
  });

  it('ignores an English description without a recognised code', () => {
    expect(
      isRecognisedPnpmResolutionError(
        'catalog:default is not a valid spec\nworkspace:* is not a valid version',
      ),
    ).toBe(false);
  });

  it('ignores other pnpm codes', () => {
    expect(
      isRecognisedPnpmResolutionError(' ERR_PNPM_FETCH_404  GET https://registry/x: Not Found'),
    ).toBe(false);
  });

  it('ignores a code that only starts with a recognised one', () => {
    expect(isRecognisedPnpmResolutionError('ERR_PNPM_WORKSPACE_PKG_NOT_FOUND_ELSEWHERE')).toBe(
      false,
    );
  });

  it('ignores empty output', () => {
    expect(isRecognisedPnpmResolutionError('')).toBe(false);
  });
});

describe('isPnpmIgnoredBuildsError', () => {
  it.each([
    ['the pnpm 12 report', 'Error: ERR_PNPM_IGNORED_BUILDS\n\n  × adding a new package', true],
    ['the pnpm 11 report', '[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2', true],
    ['another pnpm code', ' ERR_PNPM_FETCH_404  GET https://registry/x: Not Found', false],
    ['a code that only starts with it', 'ERR_PNPM_IGNORED_BUILDS_ELSEWHERE', false],
    ['an English description without the code', 'Ignored build scripts: esbuild@0.28.2', false],
    ['empty output', '', false],
  ])('answers %s', (_case, output, expected) => {
    expect(isPnpmIgnoredBuildsError(output)).toBe(expected);
  });
});
