import postgresTargetDescriptor from '@internal/target-postgres/control';
import postgresAdapterDescriptor from '../../../src/exports/control';

export const postgresComponents = [postgresTargetDescriptor, postgresAdapterDescriptor] as const;
