import {
  type AuthoringFieldNamespace,
  temporalAuthoringPresets,
  temporalCodecPreset,
} from '@internal/framework-components/authoring';
import { MONGO_DATE_CODEC_ID } from './codec-ids';

const mongoDateStorage = { codecId: MONGO_DATE_CODEC_ID, nativeType: 'date' } as const;

export const mongoAuthoringFieldPresets = {
  temporal: {
    ...temporalAuthoringPresets(mongoDateStorage),
    timestamp: temporalCodecPreset(mongoDateStorage),
  },
} as const satisfies AuthoringFieldNamespace;
