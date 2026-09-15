import { literalDefaultForm } from '@internal/sql-contract-psl';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../../src/core/codecs';
import {
  BIGINT_LITERAL_CODEC_IDS,
  JSON_LITERAL_CODEC_IDS,
} from '../../src/core/psl-print/print-defaults';

describe('literal default forms agree between the PSL interpreter and the Postgres printer', () => {
  it('names the same Postgres codecs as bigint-formed and JSON-formed', () => {
    const postgresCodecIds = codecDescriptors.map((descriptor) => descriptor.codecId);
    expect(postgresCodecIds.length).toBeGreaterThan(10);
    const fromInterpreter = {
      bigint: postgresCodecIds.filter((id) => literalDefaultForm(id) === 'bigint').sort(),
      json: postgresCodecIds.filter((id) => literalDefaultForm(id) === 'json').sort(),
    };
    expect(fromInterpreter).toEqual({
      bigint: [...BIGINT_LITERAL_CODEC_IDS].sort(),
      json: [...JSON_LITERAL_CODEC_IDS].sort(),
    });
  });
});
