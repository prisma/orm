import { NotFoundError } from './errors';

export async function firstOrNull<Row>(rows: AsyncIterable<Row>): Promise<Row | null> {
  for await (const row of rows) {
    return row;
  }

  return null;
}

export async function firstOrThrow<Row>(
  rows: AsyncIterable<Row>,
  message = 'Expected at least one row',
): Promise<Row> {
  const row = await firstOrNull(rows);
  if (row === null) {
    throw new NotFoundError(message);
  }

  return row;
}
