/**
 * The things the analysis of the fixture project says it does not know, which the answer key lists among its
 * unknowns: a path through the output of a subflow, DML on a list of `SObject`, whose object is known only when the
 * code runs, and names that the code of Apex holds in texts it does not know (decision record 0090). Every analysis
 * of the whole project holds a warning for each place. `extraction-flows.test.ts` and
 * `extraction-apex-resolver.test.ts` hold these warnings against the key, word for word.
 */
const KNOWN_GAPS = [
  { component: 'Flow:invoice_after_save#element:check_result', count: 1 },
  { component: 'ApexClass:dynamicaccess#method:fieldof(sobject)', count: 1 },
  { component: 'ApexClass:dynamicaccess#method:copyfield(sobject,sobject,string)', count: 2 },
  { component: 'ApexClass:invoiceevents#method:saveall(list<sobject>)', count: 1 },
  { component: 'ApexClass:invoiceevents#method:describebyname(string)', count: 1 },
  { component: 'ApexClass:invoicenotifications#method:byname(string)', count: 1 },
  { component: 'ApexClass:invoiceselector#method:anyobject(string,string)', count: 2 },
] as const;

interface Reported {
  readonly severity: string;
  readonly code: string;
  readonly component: string | null;
}

const gapOf = (issue: Reported): number =>
  issue.severity === 'warning' && issue.code === 'PATH_NOT_FOLLOWED'
    ? KNOWN_GAPS.findIndex((gap) => issue.component === gap.component)
    : -1;

/**
 * The issues of a report on the fixture project without those warnings. Each has to be among them as often as it
 * has places: a test that leaves one out says with that that the analysis read the flows and the code of the classes.
 */
export function besidesKnownGap<T extends Reported>(issues: readonly T[]): T[] {
  KNOWN_GAPS.forEach((gap, index) => {
    const count = issues.filter((issue) => gapOf(issue) === index).length;
    if (count !== gap.count) {
      throw new Error(`The warning PATH_NOT_FOLLOWED of ${gap.component} is reported ${String(count)} times.`);
    }
  });
  return issues.filter((issue) => gapOf(issue) === -1);
}
