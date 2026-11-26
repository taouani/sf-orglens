---
'sf-orglens': patch
'@sf-orglens/engine': patch
---

`orglens impact Invoice_After_Save` answers about the flow in a snapshot of an org, where it ended with
`COMPONENT_AMBIGUOUS` and the exit code `2`: an org lists a definition of every flow under the name of the flow, and a
name alone that fits the flow and its definition and nothing else now means the flow. `sameName` names the definition,
and the text says that the answer is about the flow. The reader of flows reads two more kinds of names: a flow refers
to the flow it overrides (`overriddenFlow`), and an action of a generic Apex class refers to the object it is given
records of (`dataTypeMappings`). A path of which only the field `Id` was not followed no longer gives the warning
`PATH_NOT_FOLLOWED`, since `Id` gives no reference where its object is known. For the same reason, a record of a
custom metadata type whose value `Id` names the definition of a field no longer refers to the field `Id`. A snapshot
analysed by an older version keeps its references and warnings until it is analysed again (`orglens analyse`).
Decision record 0082 has the details.
