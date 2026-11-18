import { describe, expect, it } from 'vitest';
import mariadb from '../src/exports/runtime';
import { emitContractFile, emitFixture } from './emit';
import { contract } from './fixtures/example-contract';

describe('defineContract for MariaDB', () => {
  it('builds a contract for target mariadb with the storage, storage hash and capabilities the same models emit from PSL', async () => {
    const { contract: fromPsl } = await emitFixture('example');
    const fromTypeScript = contract;
    expect({
      target: fromTypeScript.target,
      capabilities: fromTypeScript.capabilities,
      storage: JSON.parse(JSON.stringify(fromTypeScript.storage)),
    }).toEqual({
      target: 'mariadb',
      capabilities: fromPsl.capabilities,
      storage: JSON.parse(JSON.stringify(fromPsl.storage)),
    });
  });

  it('emits through defineConfig and the TypeScript provider as a contract for target mariadb, identical to the one written in PSL', async () => {
    const [fromTypeScript, fromPsl] = await Promise.all([
      emitContractFile('example-contract.ts'),
      emitFixture('example'),
    ]);
    expect({
      target: fromTypeScript.contract.target,
      contractJson: fromTypeScript.contractJson,
    }).toEqual({ target: 'mariadb', contractJson: fromPsl.contractJson });
  });

  it('gives a contract mariadb() accepts', () => {
    const db = mariadb({ contract });
    expect(db.toSql(db.sql.Event.select('id').build()).sql).toBe(
      'SELECT `id` AS `id` FROM `Event`',
    );
  });
});
