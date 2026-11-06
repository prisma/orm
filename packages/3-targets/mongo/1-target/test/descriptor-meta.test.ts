import {
  assembleGeneratorFunctions,
  type GeneratorFunctionCall,
} from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { mongoTargetDescriptorMeta } from '../src/core/descriptor-meta';
import mongoTargetPack from '../src/exports/pack';
import mongoRuntimeTargetDescriptor from '../src/exports/runtime';

describe('mongoTargetDescriptorMeta', () => {
  it('has the expected identity shape', () => {
    expect(mongoTargetDescriptorMeta).toMatchObject({
      kind: 'target',
      familyId: 'mongo',
      targetId: 'mongo',
      id: 'mongo',
      version: '0.0.1',
      capabilities: {},
      defaultNamespaceId: '__unbound__',
    });
  });

  it('carries its target codec descriptors for build-time authoring', () => {
    const codecIds = mongoTargetDescriptorMeta.types.codecTypes.codecDescriptors.map(
      (d) => d.codecId,
    );
    expect(codecIds).toContain('mongo/string@1');
    expect(codecIds).toContain('mongo/objectId@1');
  });

  it('declares namespace support, so emitted model names keep their namespace segment', () => {
    expect(mongoTargetDescriptorMeta.supportsNamespaces).toBe(true);
  });
});

describe('mongo control-plane generators', () => {
  it('registers the timestampNow generator for control-plane checks', () => {
    expect(
      mongoTargetDescriptorMeta.controlMutationDefaults.generatorDescriptors.map((d) => d.id),
    ).toEqual(['timestampNow']);
  });

  it('keeps authoring contributions out of the runtime descriptor', () => {
    expect(mongoRuntimeTargetDescriptor).not.toHaveProperty('authoring');
    expect(mongoRuntimeTargetDescriptor).not.toHaveProperty('controlMutationDefaults');
  });
});

describe('mongo temporal type aliases', () => {
  it('generate timestampNow on create, and on update', () => {
    const { CreatedAt, UpdatedAt } = mongoTargetDescriptorMeta.authoring.type.temporal;
    const field = { codecId: 'mongo/date@1', typeParams: undefined, length: undefined };
    const generatorFunctions = assembleGeneratorFunctions([mongoTargetDescriptorMeta]);
    const resolved = (call: GeneratorFunctionCall | undefined) =>
      call === undefined ? undefined : generatorFunctions.resolve(call, field);
    const timestampNow = { ok: true, generator: { kind: 'generator', id: 'timestampNow' } };
    expect({
      createdAt: [CreatedAt.output.type, resolved(CreatedAt.output.onCreate)],
      updatedAt: [
        UpdatedAt.output.type,
        resolved(UpdatedAt.output.onCreate),
        resolved(UpdatedAt.output.onUpdate),
      ],
    }).toEqual({
      createdAt: [{ codecId: 'mongo/date@1' }, timestampNow],
      updatedAt: [{ codecId: 'mongo/date@1' }, timestampNow, timestampNow],
    });
  });
});

describe('mongo temporal type alias documentation', () => {
  it('says what each alias sets and the value it gives', () => {
    const { CreatedAt, UpdatedAt } = mongoTargetDescriptorMeta.authoring.type.temporal;
    expect([CreatedAt.documentation, UpdatedAt.documentation]).toEqual([
      'A timestamp the client sets to now when a row is created. Its value is a JavaScript Date.',
      'A timestamp the client sets to now when a row is created and every time it is updated. Its value is a JavaScript Date.',
    ]);
  });
});

describe('mongoTargetPack', () => {
  it('matches the descriptor metadata', () => {
    expect(mongoTargetPack).toEqual(mongoTargetDescriptorMeta);
  });
});
