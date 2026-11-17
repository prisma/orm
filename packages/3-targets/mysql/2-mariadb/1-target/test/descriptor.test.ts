import mysqlPack from '@internal/target-mysql/pack';
import { describe, expect, it } from 'vitest';
import { mariadbTargetDescriptorMeta } from '../src/core/descriptor-meta';
import mariadbControlTarget from '../src/core/migrations/control-target';

describe('the MariaDB target descriptor', () => {
  it('names MariaDB and sets tx_isolation, since MariaDB 10.11 has no transaction_isolation', () => {
    expect({
      targetId: mariadbTargetDescriptorMeta.targetId,
      id: mariadbTargetDescriptorMeta.id,
      displayName: mariadbTargetDescriptorMeta.displayName,
      sessionSettings: mariadbTargetDescriptorMeta.sessionSettings,
    }).toEqual({
      targetId: 'mariadb',
      id: 'mariadb',
      displayName: 'MariaDB',
      sessionSettings: { time_zone: '+00:00', tx_isolation: 'READ-COMMITTED' },
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
      sessionSettings: { time_zone: '+00:00', tx_isolation: 'READ-COMMITTED' },
    });
  });
});
