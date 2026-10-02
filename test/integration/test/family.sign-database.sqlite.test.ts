import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { defineContract, field, model } from '@internal/sqlite/contract-builder';
import sqliteTarget from '@internal/target-sqlite/control';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const familyInstance = sql.create(
  createControlStack({
    family: sql,
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensions: [],
  }),
);

const firstContract = familyInstance.deserializeContract(
  defineContract({
    models: {
      User: model('User', { fields: { id: field.column(integerColumn).id() } }).sql({
        table: 'user',
      }),
    },
  }),
);

const secondContract = familyInstance.deserializeContract(
  defineContract({
    models: {
      User: model('User', {
        fields: {
          id: field.column(integerColumn).id(),
          email: field.column(textColumn),
        },
      }).sql({ table: 'user' }),
    },
  }),
);

describe('family instance signSpaces on SQLite', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-sign-spaces-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('leaves every marker as it was when a later marker write fails', async () => {
    const driver = await sqliteDriver.create(join(directory, 'test.db'));
    try {
      await familyInstance.signSpaces({
        driver,
        spaces: [{ space: APP_SPACE_ID, contract: firstContract, verifiedMarker: null }],
      });
      await driver.query(`
        CREATE TRIGGER refuse_extension_marker BEFORE INSERT ON _prisma_marker
        WHEN NEW.space = 'ext'
        BEGIN SELECT RAISE(ABORT, 'marker write refused'); END
      `);

      await expect(
        familyInstance.signSpaces({
          driver,
          spaces: [
            {
              space: APP_SPACE_ID,
              contract: secondContract,
              verifiedMarker: {
                storageHash: firstContract.storage.storageHash,
                profileHash: firstContract.profileHash,
              },
            },
            { space: 'ext', contract: secondContract, verifiedMarker: null },
          ],
        }),
      ).rejects.toThrow(/marker write refused/);

      const markers = await familyInstance.readAllMarkers({ driver });
      expect([...markers].map(([space, marker]) => [space, marker.storageHash])).toEqual([
        [APP_SPACE_ID, firstContract.storage.storageHash],
      ]);
      expect(secondContract.storage.storageHash).not.toBe(firstContract.storage.storageHash);
    } finally {
      await driver.close();
    }
  });
});
