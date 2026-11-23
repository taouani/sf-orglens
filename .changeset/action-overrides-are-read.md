---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

An object refers to the page or component that overrides one of its actions: a Lightning page, such as the record
page of the object, a Visualforce page, an s-control or a Lightning component. The analysis reads the name of each,
and not the page itself. Before, a snapshot of an org whose Dependency API reports the Lightning page of an object
had the error `REFERENCE_MISSED` for each, and its analysis was not complete. A Lightning component is taken for an
Aura component, or for a Lightning web component where the snapshot defines only that. An override of a type that
is not known here, or without a type, is not read, with the warning `NAME_NOT_READ`. The cross-check has one more
reason, `action-override`, for an override by a Visualforce page, a Lightning component or an s-control without a
row: whether the API reports those was not measured.
