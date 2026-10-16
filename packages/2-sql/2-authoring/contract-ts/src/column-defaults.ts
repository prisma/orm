import type { ColumnDefault, JsonValue } from '@internal/contract/types';
import {
  type Codec,
  type CodecLookupWithDescriptors,
  codecForRef,
  type ToCanonicalForm,
} from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { isStructuredError, type StructuredError } from '@internal/utils/structured-error';
import type { AuthoredColumnDefault } from './contract-definition';
import { contractError } from './contract-errors';
import { type ColumnSite, columnSiteMeta, columnSiteSubject } from './declaration-sites';

/**
 * The codec that encodes one column's default, built with the column's own `typeParams`, because a parameterized codec checks its params when it encodes and reads a default. Only a column has params; every other encode site takes the representative instance.
 */
export function columnCodec(
  codecId: string,
  typeParams: Record<string, unknown> | undefined,
  codecLookup: CodecLookupWithDescriptors,
): Codec | undefined {
  return codecForRef(codecLookup, {
    codecId,
    ...ifDefined(
      'typeParams',
      typeParams === undefined
        ? undefined
        : blindCast<
            JsonValue,
            'a CodecRef types typeParams as JSON because contract.json stores them; materializeCodec checks them against the codec paramsSchema before the factory sees them'
          >(typeParams),
    ),
  });
}

/** Encodes a value the contract stores, and reads it back with the codec, which refuses a value its column would not hold. */
export function encodeViaCodec(value: unknown, codec: Codec | undefined): JsonValue {
  if (codec) {
    const json = codec.encodeJson(value);
    codec.decodeJson(json);
    return json;
  }
  return blindCast<
    JsonValue,
    'the build was given no codec for this value, so it is stored as authored; the caller answers for it being JSON'
  >(value);
}

export type ColumnDefaultSite = ColumnSite & { readonly codecId: string };

function defaultRefusal(
  site: ColumnDefaultSite,
  cause: unknown,
  elementPosition?: number,
): StructuredError {
  const subject =
    elementPosition === undefined ? 'default' : `default (element ${elementPosition})`;
  const reason = cause instanceof Error ? cause.message : String(cause);
  return contractError(
    'CONTRACT.DEFAULT_INVALID',
    `${columnSiteSubject(site)} has a ${subject} that its codec refuses: ${reason}`,
    {
      cause,
      meta: {
        ...columnSiteMeta(site),
        codecId: site.codecId,
        reason: 'codec-refused-default',
        ...ifDefined('elementPosition', elementPosition),
      },
    },
  );
}

const LITERAL_VALUES_ABSENT = 'CONTRACT.LITERAL_VALUES_ABSENT';

/** The refusal of a literal default by a data type that has no literal values, such as a raw column's. */
function noLiteralValuesRefusal(site: ColumnDefaultSite, cause: StructuredError): StructuredError {
  return contractError(
    'CONTRACT.DEFAULT_INVALID',
    `${columnSiteSubject(site)} has a literal default. ${cause.message}`,
    {
      cause,
      meta: { ...columnSiteMeta(site), codecId: site.codecId, reason: 'no-literal-values' },
    },
  );
}

/** The canonical form of a column's values, and the data type that gives it. */
export interface DefaultCanonicalForm {
  readonly dataTypeId: string;
  readonly toCanonicalForm: ToCanonicalForm;
}

function dataTypeRefusal(
  site: ColumnDefaultSite,
  dataTypeId: string,
  cause: unknown,
  elementPosition?: number,
): StructuredError {
  const subject =
    elementPosition === undefined ? 'default' : `default (element ${elementPosition})`;
  const reason = cause instanceof Error ? cause.message : String(cause);
  return contractError(
    'CONTRACT.DEFAULT_INVALID',
    `${columnSiteSubject(site)} has a ${subject} that its data type ${dataTypeId} refuses: ${reason}`,
    {
      cause,
      meta: {
        ...columnSiteMeta(site),
        codecId: site.codecId,
        dataType: dataTypeId,
        reason: 'data-type-refused-default',
        ...ifDefined('elementPosition', elementPosition),
      },
    },
  );
}

/**
 * Encodes a literal default with the column's codec and gives it the canonical form of the column's
 * values, as a PSL default is given it. The data type refuses a value it does not hold, and every
 * literal of a data type that has none.
 */
function encodeDefaultValue(
  value: unknown,
  codec: Codec,
  site: ColumnDefaultSite,
  canonicalForm: DefaultCanonicalForm | undefined,
  elementPosition?: number,
): JsonValue {
  let json: JsonValue;
  try {
    json = encodeViaCodec(value, codec);
  } catch (cause) {
    if (cause instanceof InternalError) throw cause;
    throw defaultRefusal(site, cause, elementPosition);
  }
  if (canonicalForm === undefined) return json;
  try {
    return canonicalForm.toCanonicalForm(json);
  } catch (cause) {
    if (cause instanceof InternalError) throw cause;
    if (isStructuredError(cause) && cause.code === LITERAL_VALUES_ABSENT) {
      throw noLiteralValuesRefusal(site, cause);
    }
    throw dataTypeRefusal(site, canonicalForm.dataTypeId, cause, elementPosition);
  }
}

function codecForDefault(
  codecLookup: CodecLookupWithDescriptors,
  resolveCodec: (codecLookup: CodecLookupWithDescriptors) => Codec | undefined,
  site: ColumnDefaultSite,
): Codec {
  const codec = buildCodecForDefault(codecLookup, resolveCodec, site);
  if (codec === undefined) {
    throw contractError(
      'CONTRACT.DEFAULT_INVALID',
      `${columnSiteSubject(site)} has a default, but no pack in the contract declares its codec "${site.codecId}", so the default cannot be checked. List the pack that owns the codec in \`extensions\`.`,
      {
        meta: {
          ...columnSiteMeta(site),
          codecId: site.codecId,
          reason: 'codec-not-found',
        },
      },
    );
  }
  return codec;
}

function buildCodecForDefault(
  codecLookup: CodecLookupWithDescriptors,
  resolveCodec: (codecLookup: CodecLookupWithDescriptors) => Codec | undefined,
  site: ColumnDefaultSite,
): Codec | undefined {
  try {
    return resolveCodec(codecLookup);
  } catch (cause) {
    if (!isStructuredError(cause) || cause.code !== 'RUNTIME.TYPE_PARAMS_INVALID') throw cause;
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `${columnSiteSubject(site)} has type parameters that its codec does not accept: ${cause.message}`,
      {
        cause,
        meta: {
          ...columnSiteMeta(site),
          codecId: site.codecId,
          reason: 'type-params-invalid',
        },
      },
    );
  }
}

export function encodeColumnDefault(
  defaultInput: AuthoredColumnDefault,
  codecLookup: CodecLookupWithDescriptors,
  resolveCodec: (codecLookup: CodecLookupWithDescriptors) => Codec | undefined,
  site: ColumnDefaultSite,
  many = false,
  elementNullable = false,
  canonicalForm?: DefaultCanonicalForm,
): ColumnDefault {
  if (defaultInput.kind === 'function') {
    return { kind: 'function', expression: defaultInput.expression };
  }
  if ('canonical' in defaultInput && defaultInput.canonical === true) {
    return {
      kind: 'literal',
      value: blindCast<
        ColumnDefault extends { kind: 'literal'; value: infer V } ? V : never,
        'a text contract source stores the canonical form its data type produced'
      >(defaultInput.value),
    };
  }
  if (many) {
    if (!Array.isArray(defaultInput.value)) {
      throw contractError(
        'CONTRACT.DEFAULT_INVALID',
        `${columnSiteSubject(site)} is a list field, so its default is an array; received ${typeof defaultInput.value}. Call .many() before .default().`,
        {
          meta: {
            ...columnSiteMeta(site),
            codecId: site.codecId,
            reason: 'list-default-not-array',
          },
        },
      );
    }
    const codec = codecForDefault(codecLookup, resolveCodec, site);
    return {
      kind: 'literal',
      value: defaultInput.value.map((element, index) => {
        if (element !== null) {
          return encodeDefaultValue(element, codec, site, canonicalForm, index + 1);
        }
        if (elementNullable) return null;
        throw new InternalError(
          'Literal default on a strict list column cannot contain null elements.',
        );
      }),
    };
  }
  return {
    kind: 'literal',
    value: encodeDefaultValue(
      defaultInput.value,
      codecForDefault(codecLookup, resolveCodec, site),
      site,
      canonicalForm,
    ),
  };
}
