import type {
  CodecDescriptor,
  CodecTrait,
  DataTypeParams,
} from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { MongoCodec } from './codecs';

export interface MongoCodecDescriptorMetadata<Id extends string> {
  readonly traits: readonly CodecTrait[];
  /** Builds the codec for a field's parameters, for a codec whose data type has parameters. */
  readonly withParams?: (params: DataTypeParams) => MongoCodec<Id, readonly CodecTrait[]>;
  readonly renderValueLiteral?: CodecDescriptor['renderValueLiteral'];
  readonly enumRefusal?: string;
  readonly keepsWrittenForm?: true;
}

/**
 * The codec descriptor of a MongoDB codec, which a target or an extension lists in `types.codecTypes.codecDescriptors`. Contract authoring reads its metadata, and the runtime and control stacks take the codec from its factory, so a codec is declared once. The factory hands out `codec` itself, or, given parameters, the codec `withParams` builds for them.
 */
export function mongoCodecDescriptor<Id extends string>(
  codec: MongoCodec<Id, readonly CodecTrait[]>,
  metadata: MongoCodecDescriptorMetadata<Id>,
): CodecDescriptor {
  return {
    codecId: codec.id,
    dataType: codec.dataType.id,
    traits: metadata.traits,
    paramsSchema: blindCast<
      CodecDescriptor['paramsSchema'],
      "the codec takes exactly its data type's parameters, and the descriptor list erases each codec's own parameter type"
    >(codec.dataType.params),
    isParameterized: codec.dataType.params !== undefined,
    factory: blindCast<
      CodecDescriptor['factory'],
      'a codec whose type has no parameters is shared by every field'
    >((params: DataTypeParams | undefined) => {
      const built =
        metadata.withParams === undefined || params === undefined
          ? codec
          : metadata.withParams(params);
      return () => built;
    }),
    ...ifDefined('renderValueLiteral', metadata.renderValueLiteral),
    ...ifDefined('enumRefusal', metadata.enumRefusal),
    ...ifDefined('keepsWrittenForm', metadata.keepsWrittenForm),
  };
}
