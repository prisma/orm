import mysqlAdapter from '@internal/adapter-mysql/control';
import type { Contract } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import mysql from '@internal/target-mysql/control';
import {
  autoincrement,
  defineContract,
  enumType,
  member,
  rel,
} from '../src/exports/contract-builder';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

/** The components of a MySQL stack that `contractToSchema` reads data types and codecs from. */
export const frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'mysql'>> = [
  mysql,
  mysqlAdapter,
];

/** The project's example contract, emitted for MySQL and loaded as the CLI loads it. */
export function loadExampleContract(): Contract<SqlStorage> {
  return mysql.contractSerializer.deserializeContract(contractJson);
}

/** The schema IR the example contract describes. */
export function exampleContractSchema(): SqlSchemaIR {
  return mysql.migrations.contractToSchema(
    loadExampleContract(),
    frameworkComponents,
  ) as SqlSchemaIR;
}

/** The example contract written with `defineContract` instead of PSL. */
export function exampleContractFromTypeScript() {
  const Role = enumType(
    'Role',
    { codecId: 'mysql/enum@1' },
    member('USER', 'USER'),
    member('ADMIN', 'ADMIN'),
  );
  return defineContract({ enums: { Role } }, ({ field, model, type }) => {
    const User = model('User', {
      fields: {
        id: field.column(type.Int()).id().default(autoincrement()),
        email: field.column(type.String()).unique(),
        role: field.namedType(Role),
      },
    });
    const Post = model('Post', {
      fields: {
        id: field.column(type.Int()).id().default(autoincrement()),
        title: field.column(type.String()),
        authorId: field.column(type.Int()),
      },
    });
    return {
      models: {
        User: User.relations({ posts: rel.hasMany(Post, { by: 'authorId' }) }),
        Post: Post.relations({ author: rel.belongsTo(User, { from: 'authorId', to: 'id' }) }).sql(
          ({ cols, constraints }) => ({
            foreignKeys: [constraints.foreignKey(cols.authorId, User.refs.id)],
          }),
        ),
      },
    };
  });
}

/** The tables of the example contract, written by hand as a MySQL user would create them. */
export const exampleTablesDdl = [
  `CREATE TABLE \`User\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`email\` varchar(191) NOT NULL,
    \`role\` enum('USER','ADMIN') NOT NULL,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`User_email_key\` (\`email\`)
  )`,
  `CREATE TABLE \`Post\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`title\` varchar(191) NOT NULL,
    \`authorId\` int NOT NULL,
    PRIMARY KEY (\`id\`),
    KEY \`Post_authorId_idx_e47547ed\` (\`authorId\`),
    CONSTRAINT \`Post_authorId_fkey\` FOREIGN KEY (\`authorId\`) REFERENCES \`User\` (\`id\`)
  )`,
] as const;
