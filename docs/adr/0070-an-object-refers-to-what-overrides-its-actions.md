# 0070. An object refers to the page or component that overrides one of its actions

- Status: Accepted
- Date: 2026-11-23
- Decisions: none (a correction made after a snapshot of a large org, with the choices the author made in it)

## Context

Record [0041](0041-components-and-names-written-in-xml.md) lists what the file of an object names and the analysis
does not read. Among it is what overrides an action of the object: the Lightning page that shows its records, a
Visualforce page that edits one, a Lightning component that creates one. Salesforce keeps each override in the
file of the object, as an element `actionOverrides` with the action (`actionName`), the type of the override
(`type`), the name of what overrides it (`content`) and, for a Lightning page or component, the size of screen it
is for (`formFactor`). Most of these elements have the type `Default` and no name: the files of the four public
codebases hold more than a thousand of them, for actions that are not overridden.

On 2026-11-23 the maintainer took a snapshot of a large org. Its Dependency API reported pairs from objects to the
Lightning pages that override their actions, and the analysis had none of them. Each was the error
`REFERENCE_MISSED`, so the analysis of the snapshot was not complete.

The [Phase 2 plan](../plans/phase-2.md) keeps Lightning pages in Phase 6, and Visualforce and Lightning components in
Phase 3. It also says that a flow that calls an Apex action, or a screen that shows a component, gets a reference to
it by name. An override is the same kind of thing: the object names the page, and what the page holds is read in its
own phase.

The documentation of Salesforce gives six types of override, written in lowercase: `default`, `flexipage`,
`lightningcomponent`, `scontrol`, `standard` and `visualforce`. Files write them with capitals, such as `Flexipage`
and `LightningComponent`, and a file of NPSP outside its package folder writes `lightningcomponent`. The
documentation says that `content` names the Lightning page, Lightning component, s-control or Visualforce page, and
a component of an installed package as `namespace__name`. It describes `default` as an override that an installed
package provides, and `standard` as the behaviour of Salesforce. It does not say whether a Lightning component is an
Aura component or a Lightning web component.

## Decision

1. **An object `references` what each of its overrides names**, with the way `action-override`, at the place of the
   name in `content`, at the tier `confirmed`, from the reader of XML. A Lightning page is a `FlexiPage`, a
   Visualforce page an `ApexPage` and an s-control an `Scontrol`. Each override is a reference of its own, also where
   two name the same page for two sizes of screen, as a record page for the desktop and for the phone. The action
   and the size are not kept. The page or component is a target by its name, and is not read.
2. **A Lightning component is an `AuraDefinitionBundle`, or a `LightningComponentBundle` where a file of the snapshot
   defines it as that and none defines it as the first.** The file of the object does not say which. Where neither
   is defined, the reference is to an Aura component: `external` with its key for a name with the prefix of a
   package, and `unresolved` without one, as for any name that is not found. Both Lightning components that override
   an action in the public codebases, one in PMM and one in a file of NPSP outside its package folder, are Aura
   components that implement `lightning:actionOverride`.
3. **The type is compared without case.** `Default` and `Standard` name nothing and give nothing, also where a file
   gives them a name. An override of another type, or without a type, is not read, and the warning `NAME_NOT_READ`
   says so, as for an action of a workflow rule of an unknown type (record
   [0063](0063-the-parts-of-a-file-of-workflow-rules.md)). A name that is no name, such as `c:createInvoice`, is not
   read either, with the warning that any other value of the file gets.
4. **Of the cross-check, a pair from an object to a Lightning page is of a kind the Dependency API reports**, as the
   large org showed. Whether it reports a Visualforce page, a Lightning component or an s-control that overrides an
   action was not measured. Such a pair without a row is counted with the new reason `action-override`, and is not
   listed in `onlyOrgLens`. Where a row reports it, the pair agrees, as any other.

## Consequences

- The public codebases have 25 overrides in the package folders the tests read: in Nebula Logger the record pages
  of five objects, each for the desktop and for the phone; in NPSP 11 overrides by four Visualforce pages, and the
  record page of one object; in PMM the record pages of two objects and an Aura component that overrides the action
  `New` of a third. Apex Recipes has none. Each was checked by hand against the files on 2026-11-23, and each names a
  page or a component that the codebase defines.
- The fixture project has no override, so no run of the test org shows what its Dependency API reports for one. A
  Lightning page in the fixture belongs with the presentation tier, and it would be deployed to the test org.
  Whether the overrides explain every pair the large org reported from an object is known only when the maintainer
  takes a snapshot of it again.
- An impact answer about a Lightning page, a Visualforce page or a Lightning component names the objects whose
  actions it overrides. The answer still says that the type of the page is not analysed: what the page refers to is
  not read.
- Nothing changes in the database. The JSON output has one more value of `reason`, which the contract allows: a
  later version can add one.
- An org can also give a Lightning page to an app, a record type or a profile. Salesforce keeps that in the file of
  the app (`actionOverrides` and `profileActionOverrides` of a `CustomApplication`), which is not analysed.
- Of what record 0041 lists as not read, the rest stays: the name field and the search layouts of an object, what a
  list view, a compact layout, a web link and an index name, and the field an indirect lookup matches on.
