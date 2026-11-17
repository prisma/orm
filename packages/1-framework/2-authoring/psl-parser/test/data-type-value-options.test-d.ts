import type { DataTypeSupport } from '@internal/framework-components/authoring';
import type { DataTypeId } from '@internal/framework-components/codec';
import { test } from 'vitest';
import { dataTypeValue } from '../src/exports';

declare const dataType: DataTypeId;
declare const support: DataTypeSupport;

test('dataTypeValue takes its own label or a label that lists its suggestions, not both', () => {
  dataTypeValue(dataType, support, { label: 'a number' });
  dataTypeValue(dataType, support, { suggestions: ['4', '7'], labelIsUnion: true });
  // @ts-expect-error a label that lists the suggestions leaves no room for a label of its own
  dataTypeValue(dataType, support, { label: 'x', suggestions: ['4'], labelIsUnion: true });
});
