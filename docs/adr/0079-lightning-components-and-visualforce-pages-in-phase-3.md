# 0079. Lightning web components, Aura components and Visualforce pages are analysed with Apex, and pages join the logic tier

- Status: Accepted
- Date: 2026-11-26
- Decisions: none (an answer of the maintainer to the Phase 3 plan)

## Context

The roadmap of the [overall plan](../plans/re-architecture-plan.md#roadmap) has "LWC and Aura links to Apex" in
Phase 3. Lightning web components (`LightningComponentBundle`) and Aura components (`AuraDefinitionBundle`) are in
the logic tier since record [0004](0004-metadata-coverage-tiers.md). A snapshot reads them, and no analyser does.

A Visualforce page (`ApexPage`) is in neither tier of record 0004, and the roadmap does not name it. Record
[0046](0046-complete-over-the-logic-tier.md) lists it among the types that stand near the words of the tier and are
not on its list. Its controller and its extensions are Apex, so a controller cannot be changed without looking at
the pages that use it. Since record [0070](0070-an-object-refers-to-what-overrides-its-actions.md) an object refers
to a page that overrides one of its actions, by its name, and the page itself is not read. The package folders of
the public codebases hold 103 pages at their pinned commits, by the count of the author.

The question was put to the maintainer as Q1 of the [Phase 3 plan](../plans/phase-3.md), with three options: (a)
Lightning web components and Aura components refer to the Apex they call, the fields and objects they import or name
in an attribute, the labels, and the components they hold, and a Visualforce page refers to its controller, its
extensions and its standard controller and joins the logic tier, (b) as (a) without Visualforce, (c) as (a), and the
merge fields of a page and the expressions in the markup of an Aura component are read too. The maintainer chose (a)
on 26 November 2026, with the recommended answers to the other five questions of the plan.

## Decision

1. **A Lightning web component and an Aura component** refer to the Apex they call, the fields and objects they
   import or name in an attribute, the labels, and the components they hold.
2. **A Visualforce page** refers to its controller, its extensions and its standard controller.
3. **`ApexPage` joins the logic tier.**
4. **A page is found by an answer about its controller, and not by one about a method of it.** The methods a page
   calls, as in `action="{!init}"`, are merge expressions.
5. **The merge fields of a page and those of the markup of an Aura component are not read** in this phase.

That is all the maintainer decided. Point 3 changes record 0004 in one point: the logic tier gets a type it did
not name.

## What goes further than the answer of the maintainer

Nine statements below are conclusions of the author of this record. The maintainer can strike any of them.

- **`ApexPage` joins the tier with its analyser**, in the pull request of work package 6 that reads pages, as every
  analysed type did since record [0058](0058-a-type-counts-for-complete-once-it-is-analysed.md). From that version
  on, a page that an org lists and does not hand out makes a snapshot `partial`. Until then it is a warning. The
  record written with that pull request changes the list of the tier in `core/tiers.ts`, which records
  [0068](0068-every-analysed-type-is-of-the-logic-tier.md) and
  [0077](0077-email-templates-report-types-and-quick-actions.md) hold.
- **What each form names is set in work package 6 of the plan.** A Lightning web component names the Apex, the
  fields, the objects, the labels and the components it imports, and the components of its markup. The fields and
  objects named in an attribute of a base component, such as `lightning-record-form`, are `probable`. An Aura
  component names its controller, the methods its JavaScript calls with `component.get('c.method')`, the object of
  an attribute of an object type, the fields of `force:recordData` and the components of its markup.
- **A Lightning web component also refers to the custom permissions it imports**
  (`@salesforce/customPermission/Name`). The answer does not name them. They are imported as labels are, and the
  fixture gets one in work package 1.
- **An Aura component names a label only in an expression**: `{!$Label.c.Name}` in its markup and
  `$A.get('$Label.c.Name')` in its JavaScript. Of those expressions the name of the label is read, and nothing else,
  so that the labels of point 1 are read for both kinds. Point 5 holds for everything else in them.
- **An answer about a method of a controller, a field or an object keeps pages on its list of what it does not
  cover**, for their merge expressions. So do Aura components, for the expressions of their markup, and Lightning
  web components, for the names in their JavaScript and their markup outside the imports, the tags and the
  attributes that work package 6 reads.
- **The JavaScript of a Lightning web component is read for its imports and nothing else, and that of an Aura
  component for its calls `component.get('c.method')` and its labels**, with a reader of the engine for the forms
  that the public codebases show. No parser of JavaScript becomes a dependency. A form the reader does not know is
  a warning, never a guess. Where the public codebases show that this is not enough, the author comes back to the
  maintainer before a dependency is added.
- **Visualforce components (`ApexComponent`), s-controls and static resources stay outside the tier** and are not
  analysed in Phase 3. The roadmap names them in no later phase yet, and record 0004 does not list them in the
  presentation tier.
- **A named credential refers to the external credential it uses**, by its name. `ExternalCredential` is not
  analysed and stays outside the tier, as record 0046 has it. The fixture project gets a named credential for the
  callout it already makes, and the external credential only where the deploy needs one.
- **The markup and the JavaScript get origins of their own**, `parser:markup` and `parser:javascript`. The list of
  origins is closed and the store keeps it as a table, so they come with a store migration and a record in work
  package 6.

## Consequences

- An impact answer about an Apex class names the pages that use it as controller or extension, and an answer about
  an Apex method names the Lightning components that call it.
- The row of Phase 3 in the roadmap gets Visualforce pages. The estimate of the plan, about 10 weeks, holds about 4
  days for this answer.
- A snapshot of an org that lists a page it does not hand out becomes `partial` with the version that analyses
  pages. The fixture project holds no page today and gets two in work package 1.
- From the same version on, `exclude_types` refuses `ApexPage`, as it refuses every type of the tier (record
  [0048](0048-types-a-snapshot-leaves-out.md)): a file `orglens.toml` that names it there, which left the pages out
  before, is refused, and the message names the type.
- What the Dependency API reports from a Lightning component, an Aura component or a page is measured on the test
  org in work package 1. Until it is, a pair of them without a row is counted with a reason, and not listed.
- The merge fields of pages can still be read later, with the presentation tier. Nothing in this decision rules it
  out.
