import type { DataTypeLookup } from '@internal/framework-components/codec';
import type { CapabilityMatrix } from '@internal/framework-components/components';
import type { AnyQueryAst } from '@internal/sql-relational-core/ast';
import type { PostgresCodecDescriptorRegistry } from '@internal/target-postgres/codec-descriptor';
import { renderLoweredSql } from '../src/exports/sql-renderer';
import type { PostgresContract } from '../src/exports/types';

declare const ast: AnyQueryAst;
declare const contract: PostgresContract;
declare const codecs: PostgresCodecDescriptorRegistry;
declare const dataTypeLookup: DataTypeLookup;
declare const capabilities: CapabilityMatrix;

renderLoweredSql(ast, contract, codecs, dataTypeLookup);

renderLoweredSql(ast, contract, codecs, dataTypeLookup, capabilities);
