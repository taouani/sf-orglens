# 0066. An impact answer takes a flow with its elements, since the flow runs them

- Status: Accepted
- Date: 2026-11-23
- Decisions: none (the answers of work package 6 of the Phase 2 plan)

## Context

Each element and resource of a flow is a component below the flow, and a reference starts at the element that
writes it (record [0061](0061-the-elements-of-a-flow.md)). The walk of an impact answer follows a component that is
found from itself only, not from what contains it (record [0044](0044-an-impact-answer.md)). So an answer about a
field that an element writes held the element and stopped there. The flow was not in the answer, and neither was
what calls the flow as a subflow, though it runs the element. On the fixture project, the answer about
`Invoice__c.Amount__c` held `Flow:invoice_recalculate#element:set_amount`, and neither `Invoice_Recalculate` nor
the element of `Invoice_After_Save` that calls it.

Work package 6 of the [Phase 2 plan](../plans/phase-2.md) asks that an answer show an element with the flow it is
of, that an answer for a flow be about its elements too, as one for an object is about its fields, and that a name
such as `Invoice_After_Save.Update_Account` find an element. The second holds already: the start of an answer is
the component and everything it contains. Record
[0062](0062-the-active-version-of-a-flow-is-fetched-by-its-number.md) left to the same work package that an answer
says when a flow in it has a newer version than the active one, which the snapshot holds.

## Decision

**A flow runs its elements. What an element refers to, its flow refers to, and an answer takes the two together.**

That is what the plan asks. The statements below are choices of the author of this record. The maintainer can
strike any of them.

What refers to a component:

1. **An element that is found brings its flow.** The flow is a result of the same depth, with the confidence and
   the reference of that element, and the walk goes on from the flow to what refers to it, such as an element of
   another flow that calls it as a subflow. A component that is found is followed from what contains it where it
   is an element of a flow. A field that is found is still not followed from its object.
2. **The flow has the depth of its element**, not one more. The file of the flow holds the reference, and a step
   from the element to its flow would count a reference that no file has.
3. **The flow is shown with the reference of one of its elements**: the one that makes the chain most certain, and
   among those the element whose key comes first. Its `from` is that element, which is a result of its own, so the
   answer names the decision or the assignment as well as the flow. A flow that the same level finds by a
   reference of its own keeps that reference, unless the way through an element is more certain. A flow that an
   earlier level found keeps its way.
4. **An element that is asked about brings its flow into the start**: what calls the flow runs the element. The
   flow is no result, and `parts` does not count it, since the element does not contain it. The JSON names it in
   the new field `elementOf`, which is `null` for any other component, and the text says it in the second line.

What a component refers to (`--outgoing`):

5. **A flow that is found brings its elements.** The walk goes on from what they refer to, with the depth and the
   confidence of the flow. They are no results: the component refers to the flow, which runs them. The nearer end
   of a reference found that way is an element of a result, and the chain goes on at its flow. An element that is
   asked about is walked from alone: it refers to what it names, not to its flow.

Naming and the rest of the answer:

6. **A name finds an element by the name of its flow and its own**, `Invoice_After_Save.Update_Account`, alone or
   after `Flow:`, in any case. Neither the name of a flow nor that of an element can hold a dot, so a name with
   one dot is read as both a flow with its element and an object with its field. Where it fits both, and neither
   is an object, the name is the error `COMPONENT_AMBIGUOUS`, as record
   [0064](0064-a-name-alone-that-fits-an-object-means-the-object.md) says.
7. **An answer names the flows in it that have a newer version** (`newerVersions`), from the notes
   `FLOW_NEWER_VERSION` of the snapshot: the flow that was asked about, the flow of an element that was asked
   about, and the flow of each result, with the number of the active version and the state of the newer one. It is
   information and not a gap: neither `complete` nor `mayMiss` changes, because the answer is about the version
   that runs, which the snapshot holds. A flow whose version is not known (`FLOW_VERSION_UNKNOWN`) stays a warning
   that an answer about flows counts, as before.
8. **The text of `impact` says what a reader would otherwise have to work out**: below the count of the results,
   "A flow is listed with the reference of one of its elements, which is listed after it.", for `--outgoing` "A
   flow refers to what its elements refer to: REFERRED TO BY can name an element of a listed flow, which is not
   listed itself.", and below the results, one line for each flow with a newer version.

## Consequences

- This changes four rules of record 0044, for flows only, and that record says so in its header. A component that
  is found is followed from what contains it where it is an element of a flow (item 1), and with `--outgoing` from
  what it contains where it is a flow (item 5). The start holds the flow of an element that is asked about, which
  the element does not contain (item 4). The reference of a result has the result at one end, and at the other a
  result of the depth before, the start or a part of the start, except in two cases: a flow that is found through
  an element holds the reference of that element (item 3), and with `--outgoing` the nearer end can be an element
  of a flow of the depth before (item 5).
- A name with one dot that found a field before can now fit an element of a flow too, and then ends with
  `COMPONENT_AMBIGUOUS` (item 6): `Account.Name`, where a flow `Account` has an element `Name`. Named with its
  type, such as `CustomField:Account.Name`, the field is found as before.
- This changes the contract of the command `impact`: an answer holds more results, and the JSON has the two fields
  `elementOf` and `newerVersions`. The schema of the output, `docs/cli.md` and a changeset say so. Nothing of the
  contract is fixed before the first version without a pre-release part (record
  [0053](0053-a-pre-release-is-published-on-npm.md)).
- On the fixture project, no result of an answer was removed or changed. The answer about `Invoice__c.Amount__c`
  has 28 results in place of 23: four flows beside their elements, and the element of `Invoice_After_Save` that
  calls `Invoice_Recalculate`, at depth 2. The answers about `Account.Tier__c`, `User.Department`, `Invoice__c`
  and `Invoice_Line__c.Quantity__c` gain 2, 2, 6 and 4 results. Six new golden questions hold the rest: a field a
  flow writes, a field a flow reads through a relationship, a field a field update writes, a record type, a flow
  and an element. The test that works out every answer from the answer key follows the same rules, and gives 602
  results for its 169 questions, 438 before.
- A test asks a snapshot of the mock org with a draft of `Invoice_Recalculate`: the answers about the flow, an
  element of it, a field it writes and what `Invoice_After_Save` refers to name the newer version, and are
  otherwise the answers of the org without the draft.
- A flow is found through any one of its elements, so a flow with many elements is in many answers. That is what
  runs: a change to any field that one of its elements reads or writes can change what the flow does.
- What starts a flow other than a subflow is not followed here. A record-triggered flow refers to its object, so it
  is in the answer about the object. A button, a Lightning page, an action or Apex that starts a flow is of a type
  that is not analysed yet, and the answer names that type in `notCovered`.
- Record 0044 says that whether a found component should be followed from what contains it is looked at again
  when methods of Apex classes become components, in Phase 3. This record decides it for flows only.
- Not verified: no answer about a real org was asked. The answers are held against the answer key of the fixture
  project.
