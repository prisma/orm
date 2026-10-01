import { describe, expect, it } from 'vitest';
import { SourceFile } from '../src/source-file';

describe('SourceFile', () => {
  it('maps an offset to a 0-based position', () => {
    const file = new SourceFile('test.psl', 'abc\ndef\nghi');
    expect(file.positionAt(0)).toEqual({ line: 0, character: 0 });
    expect(file.positionAt(5)).toEqual({ line: 1, character: 1 });
    expect(file.positionAt(10)).toEqual({ line: 2, character: 2 });
  });

  it('maps a position back to its offset', () => {
    const file = new SourceFile('test.psl', 'abc\ndef\nghi');
    expect(file.offsetAt({ line: 0, character: 0 })).toEqual(0);
    expect(file.offsetAt({ line: 1, character: 1 })).toEqual(5);
    expect(file.offsetAt({ line: 2, character: 2 })).toEqual(10);
  });

  it('maps an offset that lands on a line start', () => {
    const file = new SourceFile('test.psl', 'abc\ndef\nghi');
    expect(file.positionAt(4)).toEqual({ line: 1, character: 0 });
    expect(file.positionAt(8)).toEqual({ line: 2, character: 0 });
  });

  it('reports line metadata for the source', () => {
    const file = new SourceFile('test.psl', 'abc\ndef\nghi');
    expect(file.length).toEqual(11);
    expect(file.lineCount).toEqual(3);
    expect(file.lineStartOffsets()).toEqual([0, 4, 8]);
    expect(file.lineStartOffset(0)).toEqual(0);
    expect(file.lineStartOffset(1)).toEqual(4);
    expect(file.lineStartOffset(2)).toEqual(8);
    expect(file.lineStartOffset(3)).toEqual(11);
    expect(file.text).toEqual('abc\ndef\nghi');
  });

  it('treats empty input as a single empty line', () => {
    const file = new SourceFile('test.psl', '');
    expect(file.length).toEqual(0);
    expect(file.lineCount).toEqual(1);
    expect(file.lineStartOffsets()).toEqual([0]);
    expect(file.positionAt(0)).toEqual({ line: 0, character: 0 });
    expect(file.offsetAt({ line: 0, character: 0 })).toEqual(0);
    expect(file.positionAt(5)).toEqual({ line: 0, character: 0 });
  });

  it('clamps an out-of-range offset into the source', () => {
    const file = new SourceFile('test.psl', 'abc\ndef\nghi');
    expect(file.positionAt(-5)).toEqual({ line: 0, character: 0 });
    expect(file.positionAt(1000)).toEqual({ line: 2, character: 3 });
  });

  it('clamps an out-of-range position into the source', () => {
    const file = new SourceFile('test.psl', 'abc\ndef\nghi');
    expect(file.offsetAt({ line: -1, character: -1 })).toEqual(0);
    expect(file.offsetAt({ line: 100, character: 100 })).toEqual(11);
    expect(file.offsetAt({ line: 0, character: 100 })).toEqual(3);
  });

  it('round-trips every offset through position and back', () => {
    const file = new SourceFile('test.psl', 'first\nsecond\n\nfourth line');
    for (let offset = 0; offset <= file.length; offset++) {
      expect(file.offsetAt(file.positionAt(offset))).toEqual(offset);
    }
  });

  it('positions an LF-only document', () => {
    const file = new SourceFile('test.psl', 'abc\ndef\nghi');
    expect(file.lineStartOffsets()).toEqual([0, 4, 8]);
    expect(file.positionAt(4)).toEqual({ line: 1, character: 0 });
    expect(file.positionAt(7)).toEqual({ line: 1, character: 3 });
  });

  it('maps the \\r of a CRLF pair to the preceding line', () => {
    const file = new SourceFile('test.psl', 'a\r\nb\r\nc');
    expect(file.lineStartOffsets()).toEqual([0, 3, 6]);
    expect(file.positionAt(1)).toEqual({ line: 0, character: 1 });
    expect(file.positionAt(2)).toEqual({ line: 0, character: 2 });
    expect(file.positionAt(3)).toEqual({ line: 1, character: 0 });
    expect(file.positionAt(6)).toEqual({ line: 2, character: 0 });
  });

  it('positions a mixed-ending document', () => {
    const file = new SourceFile('test.psl', 'a\nb\r\nc');
    expect(file.lineStartOffsets()).toEqual([0, 2, 5]);
    expect(file.positionAt(2)).toEqual({ line: 1, character: 0 });
    expect(file.positionAt(3)).toEqual({ line: 1, character: 1 });
    expect(file.positionAt(4)).toEqual({ line: 1, character: 2 });
    expect(file.positionAt(5)).toEqual({ line: 2, character: 0 });
  });

  it('reports line end offsets before LF and CRLF newline sequences', () => {
    const file = new SourceFile('test.psl', 'abc\ndef\r\nghi');
    expect(file.lineEndOffset(0)).toEqual(3);
    expect(file.lineEndOffset(1)).toEqual(7);
    expect(file.lineEndOffset(2)).toEqual(12);
    expect(file.lineEndOffset(3)).toEqual(12);
  });

  it('reports an empty line end at the following newline sequence', () => {
    const file = new SourceFile('test.psl', 'first\n\nthird');
    expect(file.lineStartOffset(1)).toEqual(6);
    expect(file.lineEndOffset(1)).toEqual(6);
  });
});
