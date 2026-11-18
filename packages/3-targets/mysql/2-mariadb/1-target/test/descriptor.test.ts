import mysqlPack from '@internal/target-mysql/pack';
import { describe, expect, it } from 'vitest';
import { mariadbTargetDescriptorMeta } from '../src/core/descriptor-meta';
import mariadbControlTarget from '../src/core/migrations/control-target';
import mariadbRuntimeTarget from '../src/core/runtime/runtime-target';

describe('the MariaDB target descriptor', () => {
  it('names MariaDB and runs every session in UTC, as MySQL does', () => {
    expect({
      targetId: mariadbTargetDescriptorMeta.targetId,
      id: mariadbTargetDescriptorMeta.id,
      displayName: mariadbTargetDescriptorMeta.displayName,
      sessionSettings: mariadbTargetDescriptorMeta.sessionSettings,
    }).toEqual({
      targetId: 'mariadb',
      id: 'mariadb',
      displayName: 'MariaDB',
      sessionSettings: { time_zone: '+00:00' },
    });
  });

  it("shares MySQL's data types, codecs and PSL authoring under their mysql ids", () => {
    expect({
      dataTypes: mariadbTargetDescriptorMeta.dataTypes,
      authoring: mariadbTargetDescriptorMeta.authoring,
      supportsNamespaces: mariadbTargetDescriptorMeta.supportsNamespaces,
      defaultNamespaceId: mariadbTargetDescriptorMeta.defaultNamespaceId,
    }).toEqual({
      dataTypes: mysqlPack.dataTypes,
      authoring: mysqlPack.authoring,
      supportsNamespaces: mysqlPack.supportsNamespaces,
      defaultNamespaceId: mysqlPack.defaultNamespaceId,
    });
  });

  it('builds a control target whose instance and descriptor carry the MariaDB target id', () => {
    expect({
      instance: mariadbControlTarget.create(),
      targetId: mariadbControlTarget.targetId,
      sessionSettings: mariadbControlTarget.sessionSettings,
    }).toEqual({
      instance: { familyId: 'sql', targetId: 'mariadb' },
      targetId: 'mariadb',
      sessionSettings: { time_zone: '+00:00' },
    });
  });

  it('builds a runtime target that carries the MariaDB target id and display name', () => {
    expect({
      targetId: mariadbRuntimeTarget.targetId,
      displayName: mariadbRuntimeTarget.displayName,
      sessionSettings: mariadbRuntimeTarget.sessionSettings,
      instance: mariadbRuntimeTarget.create(),
    }).toEqual({
      targetId: 'mariadb',
      displayName: 'MariaDB',
      sessionSettings: { time_zone: '+00:00' },
      instance: { familyId: 'sql', targetId: 'mariadb' },
    });
  });
});
