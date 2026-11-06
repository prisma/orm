import {
  type AuthoringTypeNamespace,
  temporalTypeAliases,
} from '@internal/framework-components/authoring';
import { MONGO_DATE_CODEC_ID } from './codec-ids';

export const mongoAuthoringTypes = {
  temporal: temporalTypeAliases({ codecId: MONGO_DATE_CODEC_ID }, 'a JavaScript Date'),
} as const satisfies AuthoringTypeNamespace;
