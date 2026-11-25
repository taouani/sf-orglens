---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

Email templates, report types and quick actions are analysed. An email template reads the fields of its merge
fields, in its subject and in its body, which is read as text in UTF-8, or in ISO-8859-1 where its `encodingKey`
says so and the bytes are no UTF-8: a classic template writes `{!Object.Field}`, a Lightning template
`{{{Name.Field}}}` or `{!Name.Field}`, and a Visualforce template `{!relatedTo.Field}`, whose object its markup names.
A merge field that holds a formula is read as one. A template also refers to the object it is written for, its
letterhead and the documents it attaches. A report type refers to its object, to the lookup field behind each child
relationship it joins, and to each field it lists. A quick action refers to the object and the record type of the
records it creates, writes each field it sets, the lookup to the record it runs on and the fields its layout lets the
user type in, reads the names in the formula of a value it sets and the fields its layout shows, and calls the flow
or names the email template, component, page or canvas app it opens. A name that is not read, a child relationship
that is not known and a field of a record of no known object are warnings, as elsewhere. The three types join the
logic tier, so an org that lists one and does not hand it out has a partial snapshot. A folder of email templates
(`EmailFolder`) stays outside it. The cross-check compares the rows from an email template, and counts a pair of a
report type or a quick action without a row with the new reasons `report-type` and `quick-action`. An impact answer
holds them as any other result, and no longer lists `EmailTemplate` among the types it does not cover. A snapshot
that is already there is analysed again with `orglens analyse`. Decision record 0077. Not done: the icon of a quick
action. Not verified on an org: the forms of the Lightning and the Visualforce templates, the fields of the owner as a
classic template writes them, and what the Dependency API reports of report types and quick actions.
