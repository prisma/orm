import type { ContractWithDomain } from '@internal/contract/types';
import type {
  KeepDataEdit,
  MigrationDataLossKind,
  MigrationSubject,
} from '@internal/framework-components/control';
import { ok } from '@internal/utils/result';
import { questionText, refusalText } from '../../../src/control-api/statements/plan-question-text';
import {
  askPlanQuestions,
  type KeepDataEditAdvice,
  ORIGIN_SNAPSHOT_RECOVERY,
  type PlannedQuestions,
  type PlanQuestion,
} from '../../../src/control-api/statements/plan-questions';
import type { StatementText } from '../../../src/control-api/statements/statement-text';

export const NO_FLAGS = { unmatched: [], misdirected: [], confirm: [], yes: false };

/** The questions a run asks about a plan's losses and access changes, each answered with delete or allow. */
export async function askedAbout(input: {
  readonly origin: ContractWithDomain;
  readonly destination: ContractWithDomain;
  readonly losses?: readonly {
    readonly label: string;
    readonly subject: MigrationSubject;
    readonly loss?: MigrationDataLossKind;
    readonly keepDataAdvice?: string;
    readonly keepDataEdit?: KeepDataEdit;
  }[];
  readonly accessChanges?: readonly {
    readonly label: string;
    readonly subject: MigrationSubject;
    readonly widens: boolean;
  }[];
  readonly namespaces?: PlannedQuestions['namespaces'];
  readonly canConvert?: boolean;
  readonly originKnown?: boolean;
  readonly keepDataEditAdvice?: KeepDataEditAdvice;
  readonly temporaryValues?: readonly { readonly subject: MigrationSubject }[];
  /** The renames the plan carries out. */
  readonly statements?: readonly StatementText[];
  readonly destinationRef?: string;
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
      temporaryValues: input.temporaryValues ?? [],
      ...(input.namespaces === undefined ? {} : { namespaces: input.namespaces }),
    },
    askAccess: true,
    canConvert: input.canConvert ?? true,
    statements: input.statements ?? [],
    preAnswers: [],
    consentAll: { delete: false, allow: false },
    origin: input.origin,
    originKnown: input.originKnown ?? true,
    destination: input.destination,
    ...(input.destinationRef === undefined ? {} : { destinationRef: input.destinationRef }),
    ...(input.keepDataEditAdvice === undefined
      ? {}
      : { keepDataEditAdvice: input.keepDataEditAdvice }),
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
    prompts: questions.map((question, index) =>
      questionText(question, {
        withNamespace:
          question.removedNamespace !== undefined &&
          questions.findIndex(
            ({ removedNamespace }) => removedNamespace === question.removedNamespace,
          ) === index,
      }),
    ),
    refusal: refusalText(questions, NO_FLAGS),
  };
}

/** The steps that store the contract before this change, as the prompt gives them. */
export const RECOVERY_AT_PROMPT = [
  'If it was renamed, stop this command and keep its data: store a snapshot of the contract before this change, which is the contract the database was last updated to, then run this command again, and it gives the --rename to use.',
  ...ORIGIN_SNAPSHOT_RECOVERY.slice(1),
]
  .join('\n')
  .replaceAll('{bin}', 'prisma');
