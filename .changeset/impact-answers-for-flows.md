---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

`orglens impact` takes a flow with its elements, since the flow runs them. Where an answer finds an element of a
flow, such as an assignment that writes the field that was asked about, it also holds the flow, at the same depth,
with the reference of that element, and goes on with what refers to the flow, such as a flow that calls it as a
subflow. The line of the flow shows the reference of that element, which has a line of its own after it, and a
line of the text says so. In the JSON, `reference.from` of the flow names the element. An answer about an element
holds what refers to its flow, and the new field `elementOf` of the JSON names the flow. With `--outgoing`, an
answer goes on from a flow that it finds to what the elements of the flow refer to, and `REFERRED TO BY` can name
such an element, which has no line of its own. So an answer can hold more results than before: on the fixture
project, the answer about `Invoice__c.Amount__c` has 28 in place of 23.

An element of a flow can be named by the name of its flow and its own, such as
`Invoice_After_Save.Update_Account`, alone or after `Flow:`, in any case. A key is found in any case too. A name
with one dot that found a field before can now also fit an element of a flow, such as `Account.Name` where a flow
`Account` has an element `Name`. Where neither is an object, the command then ends with `COMPONENT_AMBIGUOUS` and
the exit code `2`, and lists both keys. Named with its type, such as `CustomField:Account.Name`, the field is found
as before.

An answer names each flow in it whose active version has a newer one beside it, such as a draft, in a line below
the results and in the new field `newerVersions` of the JSON. The answer is about the active version, which the
snapshot holds and which is the one that runs. The newer version is not analysed, and naming it changes neither
`complete` nor the exit code. Only a snapshot of an org knows of a newer version.
