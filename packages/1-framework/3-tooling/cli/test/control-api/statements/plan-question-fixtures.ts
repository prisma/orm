import type { ContractWithDomain } from '@internal/contract/types';
import type {
  MigrationDataLossKind,
  MigrationSubject,
} from '@internal/framework-components/control';
import { ok } from '@internal/utils/result';
import { refusalText } from '../../../src/control-api/statements/plan-question-text';
import {
  askPlanQuestions,
  type PlannedQuestions,
  type PlanQuestion,
} from '../../../src/control-api/statements/plan-questions';

export const NO_FLAGS = { unmatched: [], confirm: [], yes: false };

/** The questions a run asks about a plan's losses and access changes, each answered with delete or allow. */
export async function askedAbout(input: {
  readonly origin: ContractWithDomain;
  readonly destination: ContractWithDomain;
  readonly losses?: readonly {
    readonly label: string;
    readonly subject: MigrationSubject;
    readonly loss?: MigrationDataLossKind;
  }[];
  readonly accessChanges?: readonly {
    readonly label: string;
    readonly subject: MigrationSubject;
    readonly widens: boolean;
  }[];
  readonly namespaces?: PlannedQuestions['namespaces'];
  readonly canConvert?: boolean;
  readonly originKnown?: boolean;
}): Promise<readonly PlanQuestion[]> {
  const asked: PlanQuestion[] = [];
  await askPlanQuestions<PlannedQuestions, never>({
    plan: {
      dataLoss: (input.losses ?? []).map((loss, operationIndex) => ({
        operationIndex,
        loss: 'drop',
        ...loss,
      })),
      accessChanges: (input.accessChanges ?? []).map((change, operationIndex) => ({
        operationIndex,
        ...change,
      })),
      temporaryValues: [],
      ...(input.namespaces === undefined ? {} : { namespaces: input.namespaces }),
    },
    askAccess: true,
    canConvert: input.canConvert ?? true,
    statements: [],
    preAnswers: [],
    consentAll: { delete: false, allow: false },
    origin: input.origin,
    originKnown: input.originKnown ?? true,
    destination: input.destination,
    answer: async (batch) => {
      asked.push(...batch);
      return batch.map(({ subject, verbs }) => ({
        verb: verbs.includes('allow') ? 'allow' : 'delete',
        text: subject,
      }));
    },
    replan: async () => ok({ dataLoss: [], accessChanges: [], temporaryValues: [] }),
  });
  return asked;
}

/** The prompt text of each question, and the refusal when nobody can answer them. */
export function textsOf(questions: readonly PlanQuestion[]) {
  return {
    prompts: questions.map(({ question }) => question),
    refusal: refusalText(questions, NO_FLAGS),
  };
}
