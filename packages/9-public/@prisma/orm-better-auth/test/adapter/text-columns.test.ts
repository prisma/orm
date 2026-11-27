import type { CleanedWhere } from '@better-auth/core/db/adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAdapter } from '../../src/adapter';
import { createModelCollections } from '../../src/collections';
import { whereFilter } from '../../src/filters';
import type { TargetSupport } from '../../src/target-support';
import { shippedTargetSupports } from '../../src/targets/shipped';
import {
  type AdapterDatabases,
  createAdapterDatabases,
  probeOptions,
  probePsl,
  type TestClient,
} from '../helpers/adapter-databases';
import { targets } from '../helpers/databases';
import { timeouts } from '../timeouts';

let databases: AdapterDatabases;

beforeAll(async () => {
  databases = await createAdapterDatabases();
}, timeouts.devServerStart);

afterAll(() => databases?.dispose(), timeouts.devServerClose + timeouts.hook);

describe.each(targets)('which fields hold text on %s', (target) => {
  let client: TestClient;
  let support: TargetSupport;

  beforeAll(async () => {
    client = await databases.open(target, probePsl(databases, target));
    const shipped = shippedTargetSupports.find((candidate) => candidate.target === target);
    if (shipped === undefined) throw new Error(`No support for ${target}`);
    support = { ...shipped, valueKind: () => undefined };
    const adapter = prismaAdapter(client)(probeOptions);
    await adapter.create({
      model: 'probe',
      data: { id: '1', text: 'abc', n: 1 },
      forceAllowId: true,
    });
  }, timeouts.hook);

  async function ids(where: CleanedWhere[]): Promise<string[]> {
    const collections = createModelCollections(client.contract, undefined);
    const found = collections.model('probe');
    const rows = await collections
      .collection(client.orm, found)
      .where(whereFilter(found, support, where))
      .select('id')
      .all();
    return rows.map((row) => String(row['id']));
  }

  const contains = (field: string): CleanedWhere => ({
    field,
    operator: 'contains',
    value: 'b',
    mode: 'sensitive',
    connector: 'AND',
  });

  it("follows the ORM's like method, not the support's value kinds", async () => {
    expect(await ids([contains('text')])).toEqual(['1']);
    await expect(ids([contains('n')])).rejects.toThrow(
      expect.objectContaining({
        name: 'BetterAuthError',
        message: expect.stringMatching(/^Field "Probe\.n" \(.+\) does not support contains\.$/),
      }),
    );
  });
});
