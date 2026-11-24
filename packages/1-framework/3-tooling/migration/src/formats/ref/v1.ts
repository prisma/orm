import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { type } from 'arktype';

/** What a ref file holds, before its hash and policies are checked by the reader that needs them. */
export interface RefFileContent {
  readonly hash: string;
  readonly invariants: readonly string[];
  readonly policies?: unknown;
}

/** A ref file in format version 1, including `refs/head.json`. */
export interface RefDocumentV1 extends RefFileContent {
  readonly formatVersion: 1;
}

const RefDocumentV1Schema = type({
  '+': 'reject',
  formatVersion: '1',
  hash: 'string',
  invariants: 'string[]',
  'policies?': 'unknown',
});

/** The content of a version 1 ref file, or why it holds none. */
export function parseRefV1(document: unknown): Result<RefFileContent, string> {
  const parsed = RefDocumentV1Schema(document);
  if (parsed instanceof type.errors) return notOk(parsed.summary);
  return ok({
    hash: parsed.hash,
    invariants: parsed.invariants,
    ...ifDefined('policies', parsed.policies),
  });
}

export function printRefV1(content: RefFileContent): RefDocumentV1 {
  return {
    formatVersion: 1,
    hash: content.hash,
    invariants: [...content.invariants],
    ...ifDefined('policies', content.policies),
  };
}
