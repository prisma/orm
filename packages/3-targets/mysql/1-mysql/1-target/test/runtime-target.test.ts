import { describe, expect, it } from 'vitest';
import { mysqlTargetDescriptorMetaRuntime } from '../src/core/descriptor-meta-runtime';
import mysqlRuntimeTarget, {
  createMysqlRuntimeTargetDescriptor,
} from '../src/core/runtime/runtime-target';

describe('the MySQL runtime target descriptor', () => {
  it('creates a MySQL target instance and contributes no runtime codecs of its own', () => {
    expect({
      kind: mysqlRuntimeTarget.kind,
      targetId: mysqlRuntimeTarget.targetId,
      displayName: mysqlRuntimeTarget.displayName,
      codecs: mysqlRuntimeTarget.codecs(),
      instance: mysqlRuntimeTarget.create(),
    }).toEqual({
      kind: 'target',
      targetId: 'mysql',
      displayName: 'MySQL',
      codecs: [],
      instance: { familyId: 'sql', targetId: 'mysql' },
    });
  });

  it('builds the runtime target of a target that extends MySQL from its metadata', () => {
    const target = createMysqlRuntimeTargetDescriptor({
      descriptorMeta: {
        ...mysqlTargetDescriptorMetaRuntime,
        targetId: 'other',
        id: 'other',
        displayName: 'Other',
      },
    });
    expect({
      targetId: target.targetId,
      displayName: target.displayName,
      dataTypes: target.dataTypes,
      instance: target.create(),
    }).toEqual({
      targetId: 'other',
      displayName: 'Other',
      dataTypes: mysqlTargetDescriptorMetaRuntime.dataTypes,
      instance: { familyId: 'sql', targetId: 'other' },
    });
  });
});
