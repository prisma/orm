import { describe, expect, it } from 'vitest';
import { pgVectorDescriptor } from '../src/core/codecs';

describe('pgvector codec renderOutputType', () => {
  const renderOutputType = pgVectorDescriptor.renderOutputType as
    | ((typeParams: Record<string, unknown>) => string | undefined)
    | undefined;

  // The descriptor's `renderOutputType` runs *after* `paramsSchema` validation so it can assume either a well-formed `length` or none at all. Negative-shape inputs (missing / NaN / non-integer) are rejected upstream by `paramsSchema` and never reach this renderer.

  it('renders Vector when when length is not present', () => {
    expect(renderOutputType?.({})).toBe('Vector');
  });

  it('renders Vector<length> when length is present', () => {
    expect(renderOutputType?.({ length: 1536 })).toBe('Vector<1536>');
  });

  it('renders Vector<length> with small dimension', () => {
    expect(renderOutputType?.({ length: 3 })).toBe('Vector<3>');
  });
});
