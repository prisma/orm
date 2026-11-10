import type {
  AnyQueryAst,
  ContractCodecRegistry,
  LoweredStatement,
} from '@internal/sql-relational-core/ast';
import {
  createAstCodecRegistry,
  deriveParamMetadata,
  encodeParamsWithMetadata,
} from '@internal/sql-runtime';
import { postgresCodecRegistry } from '@internal/target-postgres/codecs';
import { InternalError } from '@internal/utils/internal-error';

export const CONTROL_CODECS = createAstCodecRegistry(postgresCodecRegistry);

export async function encodeControlQueryParams(
  lowered: LoweredStatement,
  ast: AnyQueryAst,
  codecs: ContractCodecRegistry = CONTROL_CODECS,
): Promise<readonly unknown[]> {
  const values = lowered.params.map((slot) => {
    if (slot.kind === 'literal') return slot.value;
    throw new InternalError(
      `control query lowered to a bind slot '${slot.name}', which is unsupported`,
    );
  });
  return encodeParamsWithMetadata(values, deriveParamMetadata(ast), {}, codecs);
}
