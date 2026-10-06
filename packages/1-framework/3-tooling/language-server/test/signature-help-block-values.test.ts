import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { providePslSignatureHelp } from '../src/signature-help';
import { testBinder } from './helpers/binder';
import { blockValueDescriptors, blockValueSource } from './helpers/block-value-descriptors';

function help(markedBlock: string) {
  const markedSource = `${blockValueSource}\n${markedBlock}`;
  const offset = markedSource.indexOf('|');
  expect(offset).toBeGreaterThanOrEqual(0);
  const { document, sources } = parse(markedSource.replace('|', ''), 'language-server-test.psl');
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable } = buildSymbolTable({ documents: [document], sources });
  return providePslSignatureHelp({
    document,
    sourceFile,
    position: sourceFile.positionAt(offset),
    clientSupportsLabelOffsets: false,
    candidates: {
      binder: testBinder({ sources, symbolTable, pslBlockDescriptors: blockValueDescriptors }),
      pslBlockDescriptors: blockValueDescriptors,
      symbolTable,
    },
  });
}

function schedule(entry: string) {
  return help(['schedule nightly {', `  ${entry}`, '}'].join('\n'));
}

function active(entry: string) {
  const result = schedule(entry);
  const signature = result?.signatures[result.activeSignature ?? 0];
  return {
    label: signature?.label,
    parameter: signature?.parameters?.[result?.activeParameter ?? -1]?.label,
  };
}

const everyLabel = 'every(integer, unit: seconds | minutes, jitter?: boolean)';

describe('generic block value signature help', () => {
  it('renders the function signature with the first positional parameter active', () => {
    expect(active('run = every(|')).toEqual({ label: everyLabel, parameter: 'integer' });
  });

  it.each([
    ['run = every(5, |', 'unit: seconds | minutes'],
    ['run = every(5, unit: seconds, |', 'jitter?: boolean'],
  ])('moves the active parameter to the next unfilled slot: %s', (entry, parameter) => {
    expect(active(entry)).toEqual({ label: everyLabel, parameter });
  });

  it('activates the named argument under the cursor', () => {
    expect(active('run = every(5, unit: |')).toEqual({
      label: everyLabel,
      parameter: 'unit: seconds | minutes',
    });
  });

  it('returns null for a function-valued parameter outside the call', () => {
    expect(schedule('run = |')).toBeNull();
  });

  it.each(['target = |', 'roles = [admin, |', 'permissive = |', 'using = |'])(
    'returns null for a block value without a function call: %s',
    (entry) => {
      expect(help(['policy_select read_own {', `  ${entry}`, '}'].join('\n'))).toBeNull();
    },
  );
});
