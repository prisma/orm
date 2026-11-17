import type { OperationDescriptor, OperationDescriptors } from '@internal/operations';
import { MONGO_VECTOR_CODEC_ID } from '@internal/target-mongo/codec-ids';

export const mongoVectorNearOperation: OperationDescriptor = Object.freeze({
  self: { codecId: MONGO_VECTOR_CODEC_ID },
  impl: () => undefined as never,
});

export const mongoVectorOperationDescriptors: OperationDescriptors = {
  near: mongoVectorNearOperation,
};
