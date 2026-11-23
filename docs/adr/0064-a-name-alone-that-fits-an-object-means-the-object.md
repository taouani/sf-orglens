# 0064. A name alone that fits an object means the object, and the answer names the other components of that name

- Status: Accepted
- Date: 2026-11-23
- Decisions: none (an answer of the maintainer to work package 4 of the Phase 2 plan)

## Context

`orglens impact` takes the component it is asked about by its key, by its type and name, or by its name alone
(record [0044](0044-an-impact-answer.md)). A name alone is looked up in every type of the snapshot and in every
type the engine knows by name. Until now, a name that fit components of several types was the error
`COMPONENT_AMBIGUOUS`, which lists their keys: the engine did not choose.

Salesforce names some components after the object they belong to: the file of the workflow rules of an object
(`Workflow:Invoice__c`), its custom tab and its sharing rules. Work package 4 of the
[Phase 2 plan](../plans/phase-2.md) makes the first of them a component that is analysed (record
[0063](0063-the-parts-of-a-file-of-workflow-rules.md)), and the fixture project has such files. So
`orglens impact Invoice__c` ended with that error on the fixture project, as it does on every org that has
workflow rules, a custom tab or sharing rules for the object. The plan said that the work package decides what
the name alone of an object means, and that a choice that changes what a command answers for a name comes to the
maintainer first.

The question was put to the maintainer on 23 November 2026 with two options: the object, with the other
components of that name listed in the answer, or the error as it was, so that on most orgs an object has to be
named as `CustomObject:Invoice__c`. The maintainer chose the first.

## Decision

**A name alone that fits an object and other components means the object, and the answer lists the other
components of that name.**

That is all the maintainer decided.

## What goes further than the answer of the maintainer

The statements below are choices of the author of this record. The maintainer can strike any of them.

1. **An object is a component of the type `CustomObject`**, which is the type of a standard object too. An
   object that the snapshot does not hold and that something in it refers to counts as one the name fits.
2. **Where no object is among the components the name fits, nothing changes.** A name that fits one component
   means it, and a name that fits several is the error `COMPONENT_AMBIGUOUS`. Its words say now that no object was
   among them, in the error, in `docs/cli.md` and in the list of the codes of the engine.
3. **The JSON of `impact` gets the field `sameName`**: the keys of the other components the name fits, sorted. It
   is empty where the component was named by its key or by its type and name, and where the name fits one
   component. It is always there, so that a script does not have to ask whether it is.
4. **The text of `impact` says it in the line below the first one**: "The name also fits Workflow:invoice__c. The
   answer is about the object. To ask about the other, name it by its key."
5. **Record 0044 changes in this one point.** Its other rules for naming a component stand.

## Consequences

- This changes the contract of the command `impact`: a name that ended with the exit code `2` now gives an
  answer, and the JSON has one field more. The schema of the output and `docs/cli.md` change with it. Nothing of
  the contract is fixed before the first version without a pre-release part (record
  [0053](0053-a-pre-release-is-published-on-npm.md)), and the release notes of the next pre-release say it.
- On the fixture project, the answer for `Invoice__c` is the one for `CustomObject:Invoice__c`, with
  `Workflow:invoice__c` in `sameName`. A test holds that, and that the key and the type with the name give the same
  answer with `sameName` empty. The golden files of that answer, of the engine and of the command line, were
  changed with this record.
- A person who meant the file of workflow rules gets the answer for the object, with the line that names the
  file. A script that wants the file names it by its key, or by its type and name.
- A name that fits a field and a validation rule of the same name, which a test makes, is still the error: neither
  is an object.
- Not verified: which components share the name of an object on a real org. That a custom tab and sharing rules
  have the name of their object is how Salesforce names them, and was not looked up in a snapshot of the test
  org.
