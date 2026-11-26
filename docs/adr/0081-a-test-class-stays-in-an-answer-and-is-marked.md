# 0081. A test class stays in an impact answer and is marked as a test

- Status: Accepted
- Date: 2026-11-26
- Decisions: none (an answer of the maintainer to the Phase 3 plan)

## Context

A test class that names a field is a real dependency: Salesforce does not let a field be deleted while Apex names it
outside a text, tests included. Tests also make an answer long. By the count of the author, 396 of the 1,035 class
files of the package folder of NPSP hold `@isTest`.

The question was put to the maintainer as Q3 of the [Phase 3 plan](../plans/phase-3.md), with three options: (a) a
test class is kept in an answer and marked as a test, and the summary counts them, (b) a test class is left out of
an answer about what refers to a component, counted, and an option of `impact` keeps it, as for the components of a
package (record [0076](0076-a-component-is-of-a-package-where-the-org-lists-it-as-one.md)), (c) kept and not
marked. The maintainer chose (a) on 26 November 2026, with the recommended answers to the other five questions of the
plan.

## Decision

1. **A test class and its members stay in an impact answer**, as any other component.
2. **Each result that is a test is marked as one.**
3. **The summary of an answer counts the test classes in it.**

That is all the maintainer decided.

## What goes further than the answer of the maintainer

Five statements below are conclusions of the author of this record. The maintainer can strike any of them.

- **What is a test is what Salesforce treats as test code.** A class is a test where it carries the annotation
  `@isTest`. A method is a test where it carries `@isTest` or the older keyword `testMethod`. A member of a test
  class is marked with its class, so that a helper method of a test class is a test too. `@TestVisible` and a call
  of `Test.isRunningTest()` make nothing a test.
- **The count is of test classes.** A class counts once, whether the answer holds the class, members of it or both.
  Every result that is a test is marked, the class and each of its members.
- **The mark is kept in the store with the component**, from work package 3, so that `analyse` and `impact` read it
  without parsing again. How it is kept gets a record with work package 3.
- **No option of `impact` leaves tests out.** That was option (b), which the maintainer did not choose. If work
  package 9 shows that answers on NPSP and EDA are too long to read, the author comes back to the maintainer.
- **The mark and the count are part of the JSON output**, written into `docs/cli.md` and the schema of the output in
  the pull request of work package 7 that builds them, with a changeset. The text output marks a test on its line.

## Consequences

- Before a change, an answer names the tests to touch, and the mark lets a reader pass over them.
- An answer about a field that many tests name is long. Its depth and its limit stay as they are.
- A test class that names a component is never left out of an answer for being a test. It can still be left out as
  a component of a package (record 0076), or by the depth and the limit of the answer, as any other component.
