---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

`orglens impact` counts a warning of the analysis only where it can bear on the answer, not every warning of the
snapshot. For `--outgoing`, a warning counts where it is about the component, something it contains, a result or an
element of a flow of the answer. For what refers to a component, a warning about the component itself, about
something it contains, or about the flow of an element that is asked about does not count, and a path that was not
followed counts only where the answer holds a record type, a field whose name the names of the path can be, or an
object where the path ends at one: the record that an element of a flow writes or deletes. A field that such an
element sets behind a record of no known object now has a warning of its own, and the warning `PATH_NOT_FOLLOWED`
says what its path ends at (`details.endsAt`). A snapshot analysed by an earlier version counts every such warning
as before, until `orglens analyse` analyses it again. So more answers are complete: on the fixture project, the one
warning counts for the answers about `Invoice__c.Amount__c` and the object `Invoice__c`, and no longer for an answer
about `Account.Tier__c`, nor for what `Invoice__c.Total__c` refers to. The field `notCovered.analysisWarnings` of
the JSON keeps its shape and counts fewer warnings. `mayMiss` and the exit code do not change. The text says "1
warning of the analysis bears on the answer" where it said "the analysis had 1 warning". The line of a complete
answer about what refers to a component now reads "every type that can refer to it was analysed, and the analysis
had no error and no warning that bears on it".
