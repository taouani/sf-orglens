---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

`orglens impact` takes a flow with its elements, since the flow runs them. Where an answer finds an element of a
flow, such as an assignment that writes the field that was asked about, it also holds the flow, at the same depth,
with the reference of that element, and goes on with what refers to the flow, such as a flow that calls it as a
subflow. The line of the flow shows the element its reference starts at, and a line of the text says so. An
answer about an element holds what refers to its flow, and the new field `elementOf` of the JSON names the flow.
With `--outgoing`, an answer goes on from a flow that it finds to what the elements of the flow refer to. So an
answer can hold more results than before: on the fixture project, the answer about `Invoice__c.Amount__c` has 28
in place of 23.

An element of a flow can be named by the name of its flow and its own, such as
`Invoice_After_Save.Update_Account`, alone or after `Flow:`.

An answer names each flow in it whose active version has a newer one beside it, such as a draft, in a line below
the results and in the new field `newerVersions` of the JSON. The answer is about the active version, which the
snapshot holds and which is the one that runs. The newer version is not analysed, and naming it changes neither
`complete` nor the exit code. Only a snapshot of an org knows of a newer version.
