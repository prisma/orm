import type { Contract } from '@internal/contract/types';
import type {
  CodecControlHooks,
  SqlControlExtensionDescriptor,
} from '@internal/family-sql/control';
import { contractSpaceFromJson } from '@internal/migration-tools/spaces';
import type { SqlStorage } from '@internal/sql-contract/types';
import installMetadata from '../../migrations/20261029T1520_create_citext_extension/migration.json' with {
  type: 'json',
};
import installOps from '../../migrations/20261029T1520_create_citext_extension/ops.json' with {
  type: 'json',
};
import searchPathMetadata from '../../migrations/20261106T1036_find_citext_on_search_path/migration.json' with {
  type: 'json',
};
import searchPathOps from '../../migrations/20261106T1036_find_citext_on_search_path/ops.json' with {
  type: 'json',
};
import searchPathInstallMetadata from '../../migrations/20261106T1401_install_citext_on_search_path/migration.json' with {
  type: 'json',
};
import searchPathInstallOps from '../../migrations/20261106T1401_install_citext_on_search_path/ops.json' with {
  type: 'json',
};
import headRef from '../../migrations/refs/head.json' with { type: 'json' };
import contractJson from '../contract.json' with { type: 'json' };
import { CITEXT_CODEC_ID } from '../core/constants';
import {
  CITEXT_INSTALL_MIGRATION_NAME,
  CITEXT_SEARCH_PATH_INSTALL_MIGRATION_NAME,
  CITEXT_SEARCH_PATH_MIGRATION_NAME,
  CITEXT_SPACE_ID,
} from '../core/contract-space-constants';
import { citextPackMeta } from '../core/descriptor-meta';

const citextContractSpace = contractSpaceFromJson<Contract<SqlStorage>>({
  contractJson,
  migrations: [
    {
      dirName: CITEXT_INSTALL_MIGRATION_NAME,
      metadata: installMetadata,
      ops: installOps,
    },
    {
      dirName: CITEXT_SEARCH_PATH_MIGRATION_NAME,
      metadata: searchPathMetadata,
      ops: searchPathOps,
    },
    {
      dirName: CITEXT_SEARCH_PATH_INSTALL_MIGRATION_NAME,
      metadata: searchPathInstallMetadata,
      ops: searchPathInstallOps,
    },
  ],
  headRef,
});

const citextControlPlaneHooks: CodecControlHooks = {
  resolveIdentityValue: () => "''",
};

const citextExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...citextPackMeta,
  id: CITEXT_SPACE_ID,
  contractSpace: citextContractSpace,
  types: {
    ...citextPackMeta.types,
    codecTypes: {
      ...citextPackMeta.types.codecTypes,
      controlPlaneHooks: {
        [CITEXT_CODEC_ID]: citextControlPlaneHooks,
      },
    },
  },
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { citextExtensionDescriptor };
export default citextExtensionDescriptor;
