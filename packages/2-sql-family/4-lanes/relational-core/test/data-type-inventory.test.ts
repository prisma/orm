import { describe, expect, it } from 'vitest';
import * as sqlCodecs from '../src/ast/sql-codecs';

/**
 * The family registers no data types and its codecs name none: the same descriptor is `pg/int4` on
 * one target and `sqlite/integer` on another, so the target names the type when it adapts the
 * template. ADR 254, spec B4.
 */
const TEMPLATES = [
  sqlCodecs.sqlTextDescriptor,
  sqlCodecs.sqlIntDescriptor,
  sqlCodecs.sqlFloatDescriptor,
  sqlCodecs.sqlCharDescriptor,
  sqlCodecs.sqlVarcharDescriptor,
];

describe('the relational family’s codec templates', () => {
  it('ships the five templates the targets adapt', () => {
    expect(TEMPLATES.map((template) => template.codecId).sort()).toEqual([
      'sql/char@1',
      'sql/float@1',
      'sql/int@1',
      'sql/text@1',
      'sql/varchar@1',
    ]);
  });

  it('names no data type on any of them', () => {
    expect(TEMPLATES.filter((template) => 'dataType' in template)).toEqual([]);
  });
});
