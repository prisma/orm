import { blindCast } from '@internal/utils/casts';
import { parse as parsePostgresArray } from 'postgres-array';

export type PostgresListDecoder = (
  wireValue: unknown,
  decodeElement: (value: unknown) => Promise<unknown>,
) => Promise<readonly unknown[]>;

export function parsePostgresListText(wireValue: unknown): readonly unknown[] {
  if (typeof wireValue !== 'string') {
    throw new TypeError(`expected raw text for a Postgres array, got ${typeof wireValue}`);
  }

  return blindCast<
    readonly unknown[],
    'postgres-array parses raw Postgres array text into elements'
  >(parsePostgresArray(wireValue));
}

export async function decodePostgresListText(
  wireValue: unknown,
  decodeElement: (value: unknown) => Promise<unknown>,
): Promise<readonly unknown[]> {
  const decoded: unknown[] = [];
  for (const element of parsePostgresListText(wireValue)) {
    if (element === null) {
      decoded.push(null);
      continue;
    }

    decoded.push(await decodeElement(element));
  }

  return decoded;
}
