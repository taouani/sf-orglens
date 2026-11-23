# 0033. What the live-org workflow may do in the test org, and what it may print

- Status: Accepted
- Date: 2026-11-12
- Decisions: none (made during the build)

## Context

The project has one real Salesforce org: a Developer Edition org that holds nothing but the fixture project
(`docs/live-org-setup.md`). One workflow reaches it, with secrets that the environment `live-org` hands only to a
run from `main`. The repository is public, so the log of every run can be read by everyone.

Until now a step of that workflow printed codes and sentences of its own, and no text that OrgLens, a Salesforce
library or Salesforce wrote. That was enough for a step that only logs in. The Phase 0 plan asks for more: deploy
the fixture project, take a first real snapshot, and report what Salesforce does. A report that may hold no name of
a metadata type and no path of a file can say almost nothing. And a deploy changes an org, which nothing in this
repository did before.

A code review of the first version of these steps showed how easily a name of the org gets out: a step took a code
out of a sentence of the engine, and the name of a folder of the org stood where the code was expected.

## Decision

**What a step may do.** The fixture project `fixtures/billing-sfdx` is the only thing that is ever deployed, and
only to the test org. It is deployed as a whole, taken back as a whole on an error, and without running tests.
The deploy is a tool of the tests of the engine. OrgLens itself only reads, as before. A step may read the
metadata of the org through the engine. It keeps and uploads no file of the org: a snapshot goes to a temporary
folder and is removed. A step may also read what Salesforce knows about references through the Tooling API: the
rows of the Dependency API and the symbol tables of the Apex compiler, with the names behind their ids. These are
objects that describe metadata. No record of the data of the org is read, and nothing but the deploy writes. A
symbol table is read as the org holds it for a class that is saved. The other way to one, compiling a copy of a
class in the org, writes to the org and is not taken.

**What a step may print.** Sentences of its own, with values of these kinds, each checked by its form in one
place (`packages/engine/test/live/public-log.ts`):

- numbers,
- codes of OrgLens, of Salesforce and of the network,
- names of metadata types, of elements of a metadata file and of folders of the source format. They are the
  vocabulary of the Metadata API and the same in every org.
- names and paths of the fixture project, which the repository holds,
- a message of Salesforce only if its whole text has a form the step lists and, where the form holds a name, the
  name is a word of the fixture project or of the platform,
- of a message in another form, the words of a short list of everyday words and nothing else: every other word,
  every number, everything in quotes or brackets and every path of a file is left out,
- of a component that is not of the fixture project, how its name is built: every run of letters, digits and
  underscores is written as `a`,
- of a file that could not be read as metadata, its first folder and the ending of its name where they are
  words of the source format, and how deep it lies,
- of a symbol table of a class of the fixture project, the names of its fields, and a method or a type whose
  every word is a word of the fixture project or of Apex,
- of a query of the Dependency API that failed, its condition: the three fields the engine asks by, the names
  of metadata types, and the number of ids in the place of the ids.

Never: a name of a component that is not of the fixture project, the address or the id of the org, a user name,
a token, a key, or any other message of Salesforce, of a library or of OrgLens.

**How that is kept.**

- A code is read from a field that holds a code, never out of a sentence. The engine therefore keeps the code of
  a refusal of Salesforce apart from its text (`details.code` of an issue).
- A line that holds a word of the settings of the login, of the address of the org or of its id is replaced as a
  whole.
- The work is done in a second process whose standard streams lead nowhere. It can only send lines of the log of
  the tool to the process of the step (`own-output.ts`). What a library writes, in whatever way, and what an error
  nobody caught says, cannot reach the log of the run.
- Tests run the tools against a mock org that holds components beside the fixture project, in the kinds of
  observation a snapshot makes, and check that none of their names comes out.

## Consequences

- A real run can be read by everyone, and says enough to be useful: types, counts, codes, times, and how the
  files of the fixture project come back.
- What Salesforce says in a form the step does not know is "not shown". It has to be read in the Setup of the org
  by the maintainer, and the list of forms grows from that.
- The guarantee rests on the log of the tool and on the lists of forms. A new sentence in a tool is a place where
  a value can get out, so every value goes through a check of its form, and a change to these files is reviewed
  with that in mind.
- The test org is changed by a workflow of this repository. It must stay an org that holds nothing else.
- Not verified: anything here against Salesforce itself before the first runs. The forms of the problems of a
  deploy are written from memory and from the documentation.

## What the first runs changed

The first runs on 2026-11-12 showed what the rule above had no answer for, and the record was extended on the
same day.

- A real org lists components it does not hand out: the first snapshot was partial for 223 components that are
  not of the fixture project, and six remarks of Salesforce had a form the step did not know. With "not shown"
  for all of them, the run could not say why. Hence the everyday words of a message and the form of a name in
  the list above. The words of the list are words a message is made of whatever it is about, and no other word
  comes out. A name that stands in a message without quotes can leave behind the words of the list it holds, and
  a name made of such words alone would be printed. This is the one place where a part of a name of the org can
  reach the log. It is kept because such words say nothing that the list does not hold.
- The step that reads the org failed for a partial snapshot. On a real org that is every run. It now fails when
  the snapshot does not end or when the fixture project is not whole in it, and says the rest in a warning.
- The probes of the Dependency API and of the symbol tables were added to what a step may do.
- The code review of these changes showed that the line about a file that could not be read printed the ending
  of the name of the file as the org wrote it. The first folder and the ending are now shown only where they are
  words of the source format, which no org chooses.
- The deploy of 15 November 2026 was the first that Salesforce refused. The step said "not shown" for both
  problems, whose messages had no form of the list, so the run could not say why. The step of the deploy now
  shows the everyday words of such a message, as the step that reads the org does, and a name in a known form may
  begin with `$`, as a global variable of a formula does. The list of everyday words got thirteen words of a
  problem with a formula (`formula`, `function`, `parameter`, `default`, `syntax`, `reference`, `use` and their
  forms). A problem of a known form that holds a name and is about something that is not a component of the
  fixture project is not searched for everyday words: the name itself could be one. The rule above is not
  changed by this.
- The first reading of the Dependency API in parts, on 17 November 2026, failed for 6 queries, and the run could
  not say which. The step that reads the org now shows the condition of a query that failed. A type is shown
  where its name has the form of a name of a metadata type, letters and digits, as the step already does for
  the types of rows. The name of a custom metadata type, which is a name of the org, has an underscore and is
  not shown. An id is never shown.

Phase 2 added to what a step may do, on 23 November 2026.

- The project is no longer sent as its files are: the outbound message of the project names a made-up user,
  because no user name of an org may stand in the repository, and the step of the deploy writes the user it logs
  in as in its place, in the copy it sends. That name reaches no line of the log.
- A step of its own sends one flow of the fixture project once more, as a draft that differs from the version the
  project holds, so that the org holds a flow with an active version and a newer one. That is the second thing
  that is ever deployed, and it is made of a file of the fixture project.
- The probe reads two more objects of the Tooling API that describe metadata, `FlowDefinition` and `Flow`: the
  flows of the org and their versions, for the names behind the ids of rows and for the number and the state of
  the versions of the flows of the fixture project. A flow that is not of the fixture project is counted and
  not named. The state of a version is shown where it has the form of a name of the Metadata API.
- The probe asks the Metadata API for the flow of the fixture project that has a draft, by its name, by its name
  with the number of a version, five at most, and for the file of its `FlowDefinition`, each in a retrieve of
  its own (`flow-versions.ts`, 23 November 2026). The maintainer decided that day that the active version of a flow is
  the one that is analysed, and an org hands out the draft for the name alone, so it has to be measured whether
  the active version can be asked for. A file that comes back is read in memory and not kept. The log shows of
  it its name where that is the name of the flow with or without a number, its size, its state, which of the two
  versions of the project it is, and the number of the active version a definition names. A file with another
  name is counted and not read. The state of a file and of a retrieve is shown only where it is one of the words
  the Metadata API has for it.
- The first deploy of the larger project, on 23 November 2026, was refused for two flows, and of both problems
  only the everyday words came out. The list of known forms got one for a flow in which an element is not
  supported when another element is set to a value. It is written from the everyday words of that run, not from a
  message that was seen, so it shows nothing until a problem has that form. Its three places take whatever has the
  form of a name, in quotes or not, and the check of the words lets through only words of the fixture project and
  of the platform, as for every form. Names of elements of a flow file and their values are such words. The rule
  above is not changed by this. The second deploy, on the same day, printed a problem of that form: it named a
  path of the fixture project that Salesforce does not support in a flow that runs before the save. That sentence
  of Salesforce is quoted in a test, in the README of the fixtures and in the note of the runs. It holds words of the platform and names
  of the fixture project and nothing else, and the public log had printed it.
