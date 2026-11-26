/**
 * The two things the analysis of the fixture project says it does not know, which the answer key lists among its
 * unknowns: a path through the output of a subflow, and DML on a list of `SObject`, whose object is known only when
 * the code runs. Every analysis of the whole project holds a warning for each. `extraction-flows.test.ts` and
 * `extraction-apex-resolver.test.ts` hold these warnings against the key, word for word.
 */
const KNOWN_GAPS = [
  { severity: 'warning', code: 'PATH_NOT_FOLLOWED', component: 'Flow:invoice_after_save#element:check_result' },
  {
    severity: 'warning',
    code: 'PATH_NOT_FOLLOWED',
    component: 'ApexClass:invoiceevents#method:saveall(list<sobject>)',
  },
] as const;

interface Reported {
  readonly severity: string;
  readonly code: string;
  readonly component: string | null;
}

const gapOf = (issue: Reported): number =>
  KNOWN_GAPS.findIndex(
    (gap) => issue.severity === gap.severity && issue.code === gap.code && issue.component === gap.component,
  );

/**
 * The issues of a report on the fixture project without those warnings. Each has to be among them exactly once: a
 * test that leaves one out says with that that the analysis read the flows and the code of the classes.
 */
export function besidesKnownGap<T extends Reported>(issues: readonly T[]): T[] {
  KNOWN_GAPS.forEach((gap, index) => {
    const count = issues.filter((issue) => gapOf(issue) === index).length;
    if (count !== 1) throw new Error(`The warning ${gap.code} of ${gap.component} is reported ${String(count)} times.`);
  });
  return issues.filter((issue) => gapOf(issue) === -1);
}
