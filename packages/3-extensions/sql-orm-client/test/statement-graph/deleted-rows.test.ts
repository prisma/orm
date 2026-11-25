import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { DeletedRows } from '../../src/statement-graph/deleted-rows';
import { recordingRun } from './statements';

describe('DeletedRows', () => {
  it('fails with an internal error when a read row lacks an identity column', () => {
    const execute = () =>
      new DeletedRows(['id']).execute(
        { found: [{ name: 'Ada' }], deleted: [{ id: 1, name: 'Ada' }] },
        recordingRun(),
      );

    expect(execute).toThrow(InternalError);
    expect(execute).toThrow('lacks identity column(s) id');
  });
});
