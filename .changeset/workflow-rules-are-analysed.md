---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

Workflow rules are analysed. A file of workflow rules is a component with the name of its object
(`Workflow:Invoice__c`), and each rule, field update, email alert, outbound message and task in it is a component
under the name Salesforce gives it (`WorkflowRule:Invoice__c.Remind_When_Sent`). The file contains them, so an
impact answer about the file is about its rules and actions. A rule refers to the fields of its criteria and of its
formula, to the actions it starts, at once and after a time, and to the date field a time trigger counts from. A
field update writes its field, also on the parent of the record through a relationship field, and reads the fields
of its formula. An email alert reads the fields that hold its recipients and refers to its email template. An
outbound message reads the fields it sends, and a task the date field its due date counts from. A rule says whether
it is active. A project laid out with the preset `decomposeWorkflowBeta` gives the same.

`orglens impact` with a name alone that fits an object and other components, such as `Invoice__c`, which the file
of its workflow rules has too, answers for the object and no longer ends with `COMPONENT_AMBIGUOUS`. The line below
the first one names the others, and the new field `sameName` of the JSON lists their keys. A name that fits
several components and no object is still that error.

What a file of workflow rules does not say is reported and not guessed. An action of a type that is not known, or
of none, and an email template named without its folder are the warning `NAME_NOT_READ`. A field update that
writes on a parent through a relationship that leads nowhere known, or that would lead to the object of the record
itself, such as `ParentId` of an email message, is the warning `PATH_NOT_FOLLOWED`. The actions of a workflow rule
are outside the logic tier, and are the first analysed types that are: a warning of a snapshot of an org that one
of them is missing counts for every impact answer, which then says that it may miss something.

Of these files, the Dependency API reports only the custom fields the formula of a field update reads. The
cross-check compares its rows as for every analysed type, and counts the other references of these files with the
new reasons `workflow-rule`, `workflow-action` and `field-update`.

The workspace database moves to schema version 8, which gives the rules and actions a snapshot already holds their
file. A command that writes to the workspace, such as `orglens analyse` or `orglens snapshot`, migrates it. A
snapshot that was taken before has to be analysed again with `orglens analyse` for its workflow rules to be read.

Not read: a flow action, an action that publishes an article or that sends, and a recipient, an address or a user
named by itself.
