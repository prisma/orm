import { type AnyExpression, LiteralExpr, OperationExpr } from '@internal/sql-relational-core/ast';
import { type Expression, toExpr } from '@internal/sql-relational-core/expression';
import { InternalError } from '@internal/utils/internal-error';
import { paradeDbError } from './errors';

const TEXT = 'pg/text@1' as const;
const TEXT_REF = { codecId: TEXT } as const;

export type ProximityTerm = unknown;

export interface ProximityWithinOptions {
  readonly ordered?: boolean;
}

interface ProximityStep {
  readonly distance: number;
  readonly term: ProximityTerm;
  readonly ordered: boolean;
}

// https://docs.paradedb.com/documentation/full-text/proximity
export class ParadeDbProximityChain
  implements Expression<{ codecId: 'pg/text@1'; nullable: false }>
{
  readonly returnType = { codecId: TEXT, nullable: false } as const;

  private readonly start: ProximityTerm;
  private readonly steps: readonly ProximityStep[];

  constructor(start: ProximityTerm, steps: readonly ProximityStep[] = []) {
    this.start = start;
    this.steps = steps;
  }

  within(
    distance: number,
    term: ProximityTerm,
    options?: ProximityWithinOptions,
  ): ParadeDbProximityChain {
    if (!Number.isInteger(distance) || distance < 0) {
      throw paradeDbError(
        'PARADEDB.ARGUMENT_INVALID',
        `paradeDbProximity.within: distance must be a non-negative integer; got ${String(distance)}`,
        {
          meta: { helper: 'paradeDbProximity.within', argument: 'distance', received: distance },
        },
      );
    }
    return new ParadeDbProximityChain(this.start, [
      ...this.steps,
      { distance, term, ordered: options?.ordered === true },
    ]);
  }

  buildAst(): AnyExpression {
    if (this.steps.length === 0) {
      throw paradeDbError(
        'PARADEDB.ARGUMENT_INVALID',
        'paradeDbProximity: chain must have at least one .within(distance, term) step',
        {
          fix: 'Chain at least one .within(distance, term) call before using the proximity expression.',
          meta: { helper: 'paradeDbProximity', argument: 'steps' },
        },
      );
    }
    const args: AnyExpression[] = [toExpr(this.start, TEXT_REF)];
    let template = '({{self}}';
    this.steps.forEach((step, i) => {
      const op = step.ordered ? '##>' : '##';
      args.push(LiteralExpr.of(step.distance));
      args.push(toExpr(step.term, TEXT_REF));
      template += ` ${op} {{arg${2 * i}}} ${op} {{arg${2 * i + 1}}}`;
    });
    template += ')';
    const [self, ...rest] = args;
    if (!self) {
      throw new InternalError('paradeDbProximity: invariant violation — empty args');
    }
    return new OperationExpr({
      method: 'paradeDbProximity',
      self,
      args: rest.length > 0 ? rest : undefined,
      returns: this.returnType,
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template,
      },
    });
  }
}
