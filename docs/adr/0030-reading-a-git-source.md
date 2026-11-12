# 0030. How a Git source is read into a snapshot

- Status: Accepted
- Date: 2026-11-12
- Decisions: none (made during the build)

## Context

[0007](0007-immutable-snapshots.md) makes every source an immutable snapshot, and [0009](0009-one-ingestion-path.md)
gives orgs and repositories one path into the engine. A Git source is the first source that is read. It comes in
two forms: the folders as they are on disk, and a commit, named by a branch, a tag or an id, that need not be
checked out.

The Salesforce source library (`@salesforce/source-deploy-retrieve`) knows which files make up which component,
for every metadata type. It is the same knowledge the Salesforce CLI deploys with, and writing it again would be
the largest avoidable source of errors. But the library reads from the disk: its project and `.forceignore`
handling look for files from the current folder upwards, read the global configuration, and ask the file system
what a path is. A commit that is not checked out has no place on the disk, and checking it out would change the
repository of the user.

Four questions had to be settled: how a commit is read without touching the repository, how much of the library
is used, which files a snapshot holds, and when a snapshot may claim to hold a commit.

## Decision

**Every source becomes a tree of files first.** A tree is a sorted list of paths with forward slashes and a
function that returns the bytes of one of them. A folder on disk and a commit both become one. Everything after
that, from finding the components to storing them, works on the tree and does not know where it came from. A
retrieve from an org will produce the same shape.

**A commit is read from the object database of Git, by the `git` program.** `ls-tree` lists the files and
`cat-file --batch` returns their content in batches of bounded size. What is read is exactly what the commit
holds: no checkout, no line-ending conversion, no filters. Only commands that read are used. Git is started
without the variables that point it at another repository, index or object store (`GIT_DIR` and its relatives),
because Git sets them for every hook it runs and a program started from a hook inherits them. Git is told not to
prompt, not to take optional locks, not to honour replacement objects, not to fetch missing objects, not to use
any transport, not to run a file-system monitor of the repository, and to read every path as it is written. The
name of the commit is passed as one argument after the end of the options. A source without `ref` is read from
disk and needs no Git.

**The library resolves components, on our tree.** Its resolver accepts a tree in place of the disk, and gets ours
under a made-up absolute root. Only the resolver and the registry of metadata types are used. The library is
loaded on first use. Its log file in the home folder of the user is switched off before it loads, by setting
`SF_DISABLE_LOG_FILE` in the environment of the process, where it stays set.

**A failure of the library is narrowed down.** The library gives up on a whole folder for one file it cannot
place, such as the `-meta.xml` file of a class that was deleted. OrgLens then resolves that folder entry by
entry, down to the file or folder that is the cause, reports it, and keeps everything beside it.

**`sfdx-project.json` and `.forceignore` are read by OrgLens.** The project file is parsed as JSON, and only for
its package directories. A package directory that lies in another one is read with that one. The folder of the
file itself (`"path": "."`) is refused as a package directory. `.forceignore` is evaluated with the library the
Salesforce library uses, and with a copy of its default rules that a test compares with the installed version.
Files it excludes are removed before the resolver sees the tree. Without a `.forceignore`, nothing is excluded.
One thing differs from the Salesforce CLI: the file is searched from a package directory upwards to the folder
that `repo` names, and not above it. That folder is the source. It need not be the top of the repository.

**Symbolic links are not followed.** A link can point outside the source, and a snapshot must hold nothing that
the source does not. The same goes for submodules and special files, and for a folder on disk that is a Git
repository of its own, which is what a submodule is once it is checked out. Each one that was left out is
reported. A folder of the source that is itself a link, a submodule or a file is a folder that is missing, and a
source with no folder left to read fails. A `.forceignore` or a project file that is a link is not followed
either, and the issue names it.

**A path is text.** A file or folder whose name is not UTF-8 is not read and is reported as an error. Read
loosely, two such names can become one, and a snapshot would then hold one file where the source has two.

**A snapshot holds the files of components, and nothing else.** A file belongs to the smallest component that
claims it: a field owns its file, not the object. A file in a package directory that belongs to no component is
not stored. It is counted in an issue: an error if it is an Apex file, because that means a class is missing from
the picture, and a warning otherwise.

**A component that is defined twice is reported, not decided.** Two package directories of one source can hold a
class or a field of the same name. Both sets of files are stored under the one component, and a warning names
them. It is a warning because nothing is missing, and because repositories that hold several packages do this on
purpose: 3 of the 20 public codebases that were read have such components. Only components without parts are
looked at. An object whose own file is in two package directories is common in projects in use, and Salesforce
puts such an object together.

**Paths are relative to the repository.** A file is stored under the path it has in the repository, with forward
slashes. Two sources are never compared by path. They are compared by component, because an org has no folders.

**A snapshot names a commit only if it holds exactly that commit.** For a source with `ref` that is the commit
the name resolved to at that moment. For folders on disk, every file that decides the snapshot is compared with
the commit that is checked out, by the id Git gives its content: the files of the folders that `.forceignore`
does not exclude, the project file, and every place a `.forceignore` can be at. This includes files that end up
in no component: the claim is about the folders, not only about what is stored. If one of them differs or is on
one side only, or if Git cannot tell which commit is checked out, the snapshot names no commit and an issue says
why. The files are read a second time when they are stored, so what is stored is compared with the commit again,
and the commit is dropped if a file changed in between. Git is not asked whether the working tree is clean, because its answer is about something else: it calls a
file unchanged whose line endings it converted on checkout, a file it was told to assume unchanged, and a file
that a sparse checkout left out.

**A snapshot is written in one transaction.** The source is read first. A source that cannot be read at all
(no repository, no project file, an unknown name of a commit, none of the folders) fails before the database is
opened. Otherwise the snapshot is stored with all its files, its coverage and its issues, or not at all. It is
`partial` if any issue has the severity `error`, and `complete` otherwise.

## Consequences

- `@salesforce/source-deploy-retrieve` and `ignore` are runtime dependencies of the engine. The first brings
  `@salesforce/core` and its dependencies with it, which is most of the installed size. It is imported only by
  the `sources` layer, and only when a snapshot is taken, so commands that take none do not pay for it at
  start-up.
- Reading a commit needs the `git` program, version 2.30 or newer. An older one is told apart and named in the
  error. Only Git 2.43 on Linux and the versions on the CI machines were run. Reading folders from disk needs no
  Git: without it, the snapshot is taken and names no commit.
- A partial clone that lacks a file of the commit fails with a message that says so. Nothing is fetched. The
  folders of such a clone can still be compared with the commit, because that needs the names of the files and
  not their content.
- Git for Windows can be set to check a symbolic link out as a small text file. Read from disk, that file is
  stored as the file it is. This is not detected.
- A file name that Windows or macOS stores in another form than the commit has it (upper and lower case,
  composed and decomposed letters) differs between a reading from disk and a reading of the commit. This was not
  tried on those systems.
- A file that Git converts on checkout (line endings, filters) is stored as the commit holds it when a commit is
  read, and as it is on disk when the folders are read. On a machine that converts line endings, which is the
  default of Git for Windows, a snapshot of the folders therefore names no commit. Its issue says that line
  endings are the only difference, and that a source with `ref` reads the commit itself. The component lists are
  the same either way.
- Comparing the folders with the commit reads every file once more, to compute its id. On NPSP this is not
  noticeable beside the reading itself.
- The copy of the default ignore rules has to follow the library. The test that compares them fails when an
  upgrade of the library changes them.
- A `.forceignore` above the repository is not honoured. This is deliberate: a snapshot must not depend on files
  outside its source.
- On NPSP (11,707 components in 12,056 files) reading and resolving takes about 3 seconds from disk and from a
  commit on the development machine, and the database grows by about 22 MB. These numbers were measured once by
  hand and are not a benchmark that CI holds.
- Components and the files they own are compared with the library's own reading from disk by a test on the
  fixture project and on a small project with labels, bundles and parts in two folders. That test runs in CI.
  The same comparison on the three public codebases of `fixtures/corpora.toml` is skipped where they are not
  downloaded, which includes CI. By hand, 20 public codebases were compared once: equal in all 19 that the library
  can read, and in the one it cannot read because of a stray `-meta.xml` file, OrgLens reads everything else.
- Not decided here: whether a comparison of two snapshots treats files that differ only in line endings as equal.
  That belongs to the comparison engine.
- Not decided here: how a snapshot of an org is written (it cannot be one transaction, because a retrieve is
  resumed), and which files the Salesforce libraries touch in the home folder when they log in. Both belong to
  the second part of Salesforce connectivity.
