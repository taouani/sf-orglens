/**
 * The one thing the analysis of the fixture project says it does not know: a path through the output of a
 * subflow, which the answer key lists among its unknowns. Every analysis of the whole project holds a warning
 * for it. `extraction-flows.test.ts` holds that warning against the key, word for word.
 */
export const KNOWN_GAP = {
  severity: 'warning',
  code: 'PATH_NOT_FOLLOWED',
  component: 'Flow:invoice_after_save#element:check_result',
} as const;

interface Reported {
  readonly severity: string;
  readonly code: string;
  readonly component: string | null;
}

/**
 * The issues of a report on the fixture project without that warning. It has to be among them exactly once: a
 * test that leaves it out says with that that the analysis read the flows.
 */
export function besidesKnownGap<T extends Reported>(issues: readonly T[]): T[] {
  const isGap = (issue: Reported): boolean =>
    issue.severity === KNOWN_GAP.severity && issue.code === KNOWN_GAP.code && issue.component === KNOWN_GAP.component;
  const gaps = issues.filter(isGap).length;
  if (gaps !== 1) throw new Error(`The warning about the output of the subflow is reported ${String(gaps)} times.`);
  return issues.filter((issue) => !isGap(issue));
}
