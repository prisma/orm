import { buildEnumsMapForNamespace, type EnumAccessor } from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import { runtimeError } from '@internal/framework-components/runtime';
import type { MongoCodecLookup } from './mongo-execution-stack';

/** A contract's enum accessors by namespace and enum name. */
export type MongoEnumAccessors = Readonly<Record<string, Readonly<Record<string, EnumAccessor>>>>;

/**
 * The contract's enum accessors by namespace, each reading its members through its codec in `codecs`: what `db.enums` holds, and what `mongoOrm()` checks a written enum value against. A contract whose enum codec `codecs` lacks is refused here, with `RUNTIME.CODEC_DESCRIPTOR_MISSING`; an enum's members are decoded when it is first read.
 */
export function buildMongoEnums(
  contract: Pick<Contract, 'domain'>,
  codecs: MongoCodecLookup,
): MongoEnumAccessors {
  const codecFor = (codecId: string) => {
    const codec = codecs.get(codecId);
    if (codec === undefined) {
      throw runtimeError(
        'RUNTIME.CODEC_DESCRIPTOR_MISSING',
        `No codec is registered for codecId '${codecId}', which a domain enum in the contract uses.`,
        { codecId },
      );
    }
    return codec;
  };
  return Object.fromEntries(
    Object.keys(contract.domain.namespaces).map((namespaceId) => [
      namespaceId,
      buildEnumsMapForNamespace(contract.domain, namespaceId, codecFor),
    ]),
  );
}
