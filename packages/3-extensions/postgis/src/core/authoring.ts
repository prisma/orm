import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { POSTGIS_GEOMETRY_CODEC_ID } from './constants';

export const postgisAuthoringTypes = {
  postgis: {
    Geometry: {
      kind: 'typeConstructor',
      inferred: true,
      args: [{ kind: 'number', name: 'srid', integer: true, optional: true }],
      output: {
        codecId: POSTGIS_GEOMETRY_CODEC_ID,
        typeParams: {
          srid: { kind: 'arg', index: 0 },
        },
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;
