import type {
  DiffableNode,
  ExpectationFailureReason,
  SchemaDiffIssue,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  classifyStorageTypeDiffIssue,
  verifierDisposition,
} from '../src/core/diff/verifier-disposition';

const NODE: DiffableNode = {
  id: 'user_status',
  nodeKind: 'sql-native-enum',
  isEqualTo: () => true,
  children: () => [],
};

/** Builds a storage-type diff issue whose change kind derives from presence. */
function issue(change: ExpectationFailureReason): SchemaDiffIssue {
  return {
    path: ['user_status'],
    ...(change !== 'not-expected' ? { expected: NODE } : {}),
    ...(change !== 'not-found' ? { actual: NODE } : {}),
  };
}

describe('classifyStorageTypeDiffIssue', () => {
  it('classifies not-found as declared-missing', () => {
    expect(classifyStorageTypeDiffIssue(issue('not-found'))).toBe('declaredMissing');
  });

  it('classifies not-expected as extra-auxiliary', () => {
    expect(classifyStorageTypeDiffIssue(issue('not-expected'))).toBe('extraAuxiliary');
  });

  it('classifies not-equal as value drift', () => {
    expect(classifyStorageTypeDiffIssue(issue('not-equal'))).toBe('valueDrift');
  });
});

describe('verifierDisposition', () => {
  it('fails a missing type under managed', () => {
    expect(verifierDisposition('managed', issue('not-found'))).toBe('fail');
  });

  it('fails a value-set change under managed and tolerated', () => {
    expect(verifierDisposition('managed', issue('not-equal'))).toBe('fail');
    expect(verifierDisposition('tolerated', issue('not-equal'))).toBe('fail');
  });

  it('suppresses a value-set change under external (an external owner controls the allowed values)', () => {
    expect(verifierDisposition('external', issue('not-equal'))).toBe('suppress');
  });

  it('still requires an external type to exist', () => {
    expect(verifierDisposition('external', issue('not-found'))).toBe('fail');
  });

  it('suppresses an extra type under external', () => {
    expect(verifierDisposition('external', issue('not-expected'))).toBe('suppress');
  });

  it('warns on every reason under observed', () => {
    expect(verifierDisposition('observed', issue('not-found'))).toBe('warn');
    expect(verifierDisposition('observed', issue('not-expected'))).toBe('warn');
    expect(verifierDisposition('observed', issue('not-equal'))).toBe('warn');
  });
});
