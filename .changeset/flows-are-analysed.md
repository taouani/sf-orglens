---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

Flows are analysed. A flow is a component, and each of its elements and resources is a component below it, with
the key `Flow:<flow>#element:<name>`: a decision, an assignment, a lookup, a create, an update or a delete of
records, a screen, a loop, an action, a subflow, a variable, a formula, a text template and the others. The start
of a flow is the element `flow-start`. A process of the Process Builder is a flow.

An element refers to the object it reads or writes records of, to the fields in its filters, assignments and
conditions, to the fields in its formulas and merge fields, and to the Apex class, the flow or the email alert it
starts. `orglens impact` shows the elements of flows that refer to a component, and `Flow` is no longer among the
types an answer does not cover. The database keeps with a reference to an object from a record element what the
element does to its records: `lookup`, `create`, `update`, `upsert` or `delete`. No output shows it yet.

What a flow does not say is reported and not guessed. A path from a resource of which the object is not known,
such as what an Apex action gives back, and a name of a field where no object is named, are the warning
`PATH_NOT_FOLLOWED`. A resource the flow does not have is the new warning `RESOURCE_NOT_FOUND`, an element of a
kind that is not known the new warning `FLOW_ELEMENT_UNKNOWN`, with the names in it read at the tier `probable`,
and a merge field that is not closed the new warning `MERGE_FIELD_NOT_CLOSED`. The work of an analysis has a
third row, `parser:flow`.

A snapshot that was taken before has to be analysed again with `orglens analyse` for its flows to be read.

Also changed: the line of an impact answer that gives its reasons says "the analysis had 1 error and 1 warning"
where both are there. An alert that a flow names and the snapshot does not hold is reported as missing, and no
longer as the alert of a package. The line of the cross-check about the rows that are not compared says "or from
a flow" where one of them is from a flow.

Not done: the rows of the Dependency API from flows are counted and not compared in the cross-check.
