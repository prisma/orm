import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { dirname, join, resolve } from 'pathe';
import type {
  FieldShape,
  KeyKind,
  ModelShape,
  RelationShape,
  SchemaShape,
  VariantShape,
} from './programs';
import {
  discriminatorType,
  generatedKeyType,
  keyTypes,
  oneOfEachScalarType,
  type ScalarType,
} from './scalar-types';

export type Target = keyof typeof oneOfEachScalarType;

export interface Schema {
  readonly target: Target;
  readonly psl: string;
  readonly shape: SchemaShape;
  readonly tables: readonly string[];
  readonly features: readonly string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');
const cli = resolve(packageRoot, '../../packages/1-framework/3-tooling/cli/dist/bin.mjs');

type Action = 'Restrict' | 'Cascade' | 'SetNull' | 'NoAction';

interface ModelPlan {
  readonly keyKind: KeyKind;
  readonly keyTypes: readonly [ScalarType, ScalarType];
  readonly uniqueType: ScalarType | undefined;
  readonly otherFields: number;
  readonly nullable: readonly boolean[];
  readonly variants: readonly VariantPlan[] | undefined;
}

interface VariantPlan {
  readonly ownTable: boolean;
  readonly fields: number;
  readonly nullable: readonly boolean[];
}

interface RelationPlan {
  readonly kind: '1:n' | '1:1' | 'n:m';
  readonly from: number;
  readonly to: number;
  readonly optional: boolean;
  readonly onDelete: Action;
  readonly onUpdate: Exclude<Action, 'SetNull'>;
}

interface Plan {
  readonly models: readonly ModelPlan[];
  readonly relations: readonly RelationPlan[];
}

function planOf(target: Target): fc.Arbitrary<Plan> {
  const keyType = keyTypes[target];
  return fc.record({
    models: fc.array(
      fc.record({
        keyKind: fc.constantFrom<KeyKind>('single', 'single', 'generated', 'composite'),
        keyTypes: fc.tuple(keyType, keyType),
        uniqueType: fc.option(keyType, { nil: undefined, freq: 2 }),
        otherFields: fc.integer({ min: 2, max: 4 }),
        nullable: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
        variants: fc.oneof(
          { weight: 3, arbitrary: fc.constant(undefined) },
          {
            weight: 1,
            arbitrary: fc.array(
              fc.record({
                ownTable: fc.boolean(),
                fields: fc.integer({ min: 1, max: 2 }),
                nullable: fc.array(fc.boolean(), { minLength: 2, maxLength: 2 }),
              }),
              { minLength: 1, maxLength: 3 },
            ),
          },
        ),
      }),
      { minLength: 2, maxLength: 4 },
    ),
    relations: fc.array(
      fc.record({
        kind: fc.constantFrom(
          '1:n' as const,
          '1:n' as const,
          '1:1' as const,
          'n:m' as const,
          'n:m' as const,
        ),
        from: fc.nat(3),
        to: fc.nat(3),
        optional: fc.boolean(),
        onDelete: fc.constantFrom<Action>('Restrict', 'Cascade', 'SetNull', 'NoAction'),
        onUpdate: fc.constantFrom('Cascade' as const, 'Restrict' as const, 'NoAction' as const),
      }),
      { minLength: 1, maxLength: 5 },
    ),
  });
}

interface ModelDraft {
  readonly name: string;
  readonly discriminator: string | undefined;
  readonly variants: VariantShape[];
  readonly fields: FieldShape[];
  readonly key: string[];
  readonly keyKind: KeyKind;
  readonly uniques: string[][];
  readonly relations: RelationShape[];
  readonly relationLines: string[];
}

function fieldLine(model: ModelDraft, { name, type, nullable }: FieldShape): string {
  const single = model.key.length === 1 && model.key[0] === name;
  const generated = model.keyKind === 'generated' ? ' @default(autoincrement())' : '';
  return `  ${name} ${type.psl}${nullable ? '?' : ''}${single ? ` @id${generated}` : ''}`;
}

function variantTable(model: ModelDraft, variant: VariantShape): string {
  return `${model.name}_${variant.value}`;
}

function variantLines(model: ModelDraft, variant: VariantShape): string {
  return [
    `model ${model.name}${variant.value.toUpperCase()} {`,
    ...variant.fields.map(
      ({ name, type, nullable }) => `  ${name} ${type.psl}${nullable ? '?' : ''}`,
    ),
    `  @@base(${model.name}, "${variant.value}")`,
    ...(variant.ownTable ? [`  @@map("${variantTable(model, variant)}")`] : []),
    '}',
  ].join('\n');
}

function modelLines(model: ModelDraft): string {
  const base = [
    `model ${model.name} {`,
    ...model.fields.map((field) => fieldLine(model, field)),
    ...model.relationLines,
    ...(model.key.length > 1 ? [`  @@id([${model.key.join(', ')}])`] : []),
    ...model.uniques.map((fields) => `  @@unique([${fields.join(', ')}])`),
    ...(model.discriminator === undefined ? [] : [`  @@discriminator(${model.discriminator})`]),
    '}',
  ].join('\n');
  return [base, ...model.variants.map((variant) => variantLines(model, variant))].join('\n\n');
}

function keyFields(model: ModelDraft): FieldShape[] {
  return model.key.map((name) => {
    const field = model.fields.find((candidate) => candidate.name === name);
    if (field === undefined) throw new Error(`${model.name} has no key field ${name}`);
    return field;
  });
}

function referencing(
  holder: ModelDraft,
  prefix: string,
  target: ModelDraft,
  nullable: boolean,
): string[] {
  return keyFields(target).map((field, index) => {
    const name = `${prefix}k${index + 1}`;
    holder.fields.push({ name, type: field.type, nullable });
    return name;
  });
}

function draftOf(index: number, plan: ModelPlan, nextType: () => ScalarType): ModelDraft {
  const [first, second] = plan.keyTypes;
  const fields: FieldShape[] = [];
  const key: string[] = [];
  if (plan.keyKind === 'composite') {
    fields.push({ name: 'k1', type: first, nullable: false });
    fields.push({ name: 'k2', type: second, nullable: false });
    key.push('k1', 'k2');
  } else {
    const type = plan.keyKind === 'generated' ? generatedKeyType : first;
    fields.push({ name: 'id', type, nullable: false });
    key.push('id');
  }
  const uniques: string[][] = [];
  if (plan.uniqueType !== undefined) {
    fields.push({ name: 'u1', type: plan.uniqueType, nullable: false });
    uniques.push(['u1']);
  }
  for (let other = 0; other < plan.otherFields; other += 1) {
    fields.push({
      name: `v${other + 1}`,
      type: nextType(),
      nullable: plan.nullable[other] ?? false,
    });
  }
  const variants = (plan.variants ?? []).map(
    (variant, position): VariantShape => ({
      value: 'abc'.charAt(position),
      ownTable: variant.ownTable,
      fields: Array.from({ length: variant.fields }, (_, field) => ({
        name: `w${position + 1}${field + 1}`,
        type: nextType(),
        nullable: variant.nullable[field] ?? false,
      })),
    }),
  );
  if (variants.length > 0) fields.push({ name: 'kind', type: discriminatorType, nullable: false });
  return {
    name: `M${index + 1}`,
    discriminator: variants.length > 0 ? 'kind' : undefined,
    variants,
    fields,
    key,
    keyKind: plan.keyKind,
    uniques,
    relations: [],
    relationLines: [],
  };
}

function linkManyToMany(
  prefix: string,
  left: ModelDraft,
  right: ModelDraft,
  junction: ModelDraft,
): void {
  const sides = [
    { model: left, name: 'left', list: `${prefix}rights`, other: right },
    { model: right, name: 'right', list: `${prefix}lefts`, other: left },
  ] as const;
  const links = new Map<string, readonly string[]>();
  for (const side of sides) {
    const foreignKey = referencing(junction, side.name, side.model, false);
    links.set(side.name, foreignKey);
    junction.key.push(...foreignKey);
    junction.relations.push({
      name: side.name,
      kind: 'n:1',
      to: side.model.name,
      many: false,
      inverse: undefined,
      foreignKey,
      required: true,
    });
    const named = `"${prefix}${side.name}", `;
    junction.relationLines.push(
      `  ${side.name} ${side.model.name} @relation(${named}fields: [${foreignKey.join(', ')}], references: [${side.model.key.join(', ')}], onDelete: Cascade, onUpdate: Cascade)`,
    );
  }
  const [first, second] = sides;
  for (const [side, opposite] of [
    [first, second],
    [second, first],
  ] as const) {
    side.model.relations.push({
      name: side.list,
      kind: 'n:m',
      to: side.other.name,
      many: true,
      inverse: opposite.list,
      foreignKey: undefined,
      required: false,
      through: {
        model: junction.name,
        near: links.get(side.name) ?? [],
        far: links.get(opposite.name) ?? [],
      },
    });
    const named = ` @relation("${prefix}${side.name}")`;
    side.model.relationLines.push(`  ${side.list} ${side.other.name}[]${named}`);
  }
}

function linkToParent(
  prefix: string,
  relation: RelationPlan,
  parent: ModelDraft,
  child: ModelDraft,
  required: boolean,
): readonly string[] {
  const toItself = parent === child;
  const cascades = relation.onDelete === 'SetNull' || relation.onDelete === 'Cascade';
  const onDelete =
    (relation.onDelete === 'SetNull' && required) || (toItself && cascades)
      ? 'Restrict'
      : relation.onDelete;
  const onUpdate = toItself && relation.onUpdate === 'Cascade' ? 'NoAction' : relation.onUpdate;
  const foreignKey = referencing(child, prefix, parent, !required);
  const one = relation.kind === '1:1';
  if (one) child.uniques.push(foreignKey);
  child.relations.push({
    name: `${prefix}parent`,
    kind: one ? '1:1 holder' : 'n:1',
    to: parent.name,
    many: false,
    inverse: `${prefix}children`,
    foreignKey,
    required,
  });
  child.relationLines.push(
    `  ${prefix}parent ${parent.name}${required ? '' : '?'} @relation("${prefix}", fields: [${foreignKey.join(', ')}], references: [${parent.key.join(', ')}], onDelete: ${onDelete}, onUpdate: ${onUpdate})`,
  );
  parent.relations.push({
    name: `${prefix}children`,
    kind: one ? '1:1 other' : '1:n',
    to: child.name,
    many: !one,
    inverse: `${prefix}parent`,
    foreignKey: undefined,
    required: false,
  });
  parent.relationLines.push(
    `  ${prefix}children ${child.name}${one ? '?' : '[]'} @relation("${prefix}")`,
  );
  return foreignKey;
}

function build(target: Target, plan: Plan, nextType: () => ScalarType): Schema {
  const features = new Set<string>();
  const models = plan.models.map((modelPlan, index) => draftOf(index, modelPlan, nextType));
  for (const model of models) {
    features.add(`${model.keyKind} key`);
    if (model.uniques.length > 0) features.add('unique field');
    for (const variant of model.variants) {
      features.add(`variant in ${variant.ownTable ? 'its own' : 'the base'} table`);
    }
  }
  const base = models.length;
  const linkedManyToMany = new Set<string>();
  for (const [index, relation] of plan.relations.entries()) {
    const fromIndex = relation.from % base;
    const toIndex = relation.to % base;
    const parent = models[fromIndex];
    const child = models[toIndex];
    if (parent === undefined || child === undefined) continue;
    const prefix = `r${index + 1}`;
    const toItself = fromIndex === toIndex ? ' to itself' : '';
    if (relation.kind === 'n:m') {
      const pair = [fromIndex, toIndex].sort().join('-');
      if (linkedManyToMany.has(pair)) continue;
      linkedManyToMany.add(pair);
      const junction: ModelDraft = {
        name: `J${index + 1}`,
        discriminator: undefined,
        variants: [],
        fields: [],
        key: [],
        keyKind: 'composite',
        uniques: [],
        relations: [],
        relationLines: [],
      };
      linkManyToMany(prefix, parent, child, junction);
      models.push(junction);
      features.add(`n:m${toItself}`);
      continue;
    }
    const required = !relation.optional && fromIndex < toIndex;
    const foreignKey = linkToParent(prefix, relation, parent, child, required);
    features.add(`${relation.kind}${toItself}`);
    if (foreignKey.length > 1) features.add('composite foreign key');
    if (required) features.add('required relation');
  }
  const shape: SchemaShape = {
    models: models.map(
      ({
        name,
        discriminator,
        variants,
        fields,
        key,
        keyKind,
        uniques,
        relations,
      }): ModelShape => ({
        name,
        discriminator,
        variants,
        fields,
        key,
        keyKind,
        uniques,
        relations,
      }),
    ),
  };
  return {
    target,
    psl: `// use prisma-8\n\n${models.map(modelLines).join('\n\n')}\n`,
    shape,
    tables: models.flatMap((model) => [
      model.name,
      ...model.variants
        .filter((variant) => variant.ownTable)
        .map((variant) => variantTable(model, variant)),
    ]),
    features: [...features],
  };
}

export function typeNameOf(type: ScalarType): string {
  return type.psl.replace(/\(.*$/, '');
}

export function scalarTypeNames(target: Target): string[] {
  const [types] = fc.sample(oneOfEachScalarType[target], { seed: 0, numRuns: 1 });
  return [...(types ?? [])].map(typeNameOf);
}

export function schemas(target: Target, count: number, seed: number): Schema[] {
  const plans = fc.sample(planOf(target), { seed, numRuns: count });
  const everyType: fc.Arbitrary<ScalarType[]> = oneOfEachScalarType[target].chain((types) =>
    fc.shuffledSubarray([...types], { minLength: types.length }),
  );
  let round = 0;
  let remaining: ScalarType[] = [];
  const nextType = (): ScalarType => {
    if (remaining.length === 0) {
      remaining = [...(fc.sample(everyType, { seed: seed + round, numRuns: 1 })[0] ?? [])];
      round += 1;
    }
    const type = remaining.pop();
    if (type === undefined) throw new Error(`${target} has no scalar types`);
    return type;
  };
  return plans.map((plan) => build(target, plan, nextType));
}

export function emitContract(schema: Schema, name: string): unknown {
  const directory = join(here, 'fixtures/generated', name);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(join(directory, 'contract.prisma'), schema.psl);
    writeFileSync(
      join(directory, 'prisma.config.ts'),
      `import { defineConfig as ormConfig } from '@internal/${schema.target}/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({ contract: './contract.prisma', output: 'emitted' }),
});
`,
    );
    execFileSync(
      process.execPath,
      [cli, 'contract', 'emit', '--config', join(directory, 'prisma.config.ts')],
      { cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
    );
    return JSON.parse(readFileSync(join(directory, 'emitted/contract.json'), 'utf8'));
  } catch (error) {
    throw new Error(`the schema could not be emitted:\n${schema.psl}`, { cause: error });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
