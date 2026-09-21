/**
 * The data type this extension owns. A vector is one value holding several numbers, so it takes a
 * written list through a list cast rather than casting from any scalar type. ADR 254.
 */

import { dataTypeId } from '@internal/framework-components/codec';

export const PGVECTOR_VECTOR = dataTypeId('pgvector/vector');
