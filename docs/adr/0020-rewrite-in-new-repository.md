# 0020. A rewrite in a new repository, harvesting ideas from the prototypes

- Status: Accepted
- Date: 2026-11-11
- Decisions: M1, M2
- Supersedes: By reference, legacy record 0003 (LiteLLM), whose replacement is [0003](0003-llm-optional.md). See [legacy.md](legacy.md).

## Context

Three private prototypes of OrgLens exist, each built from scratch in Python with a different storage design and a
different identity scheme. None shares a language, a store or a key format with the target architecture, and none
was proven at the target scale of 10,000 or more components.

## Decision

- **M1.** OrgLens is rewritten. The prototypes are input, not a baseline. What is taken from them is design and
  knowledge: the list of metadata edge cases their parsers handle, lessons from retrieving a large org, the
  coverage manifest, the engine facade, data-policy and secret-scanning rules, golden-question evaluations, the
  CI and release setup, and the flow from a Git diff to a pull request comment.
- **M2.** The rewrite lives in a new repository with a clean history. The prototypes stay private and untouched.
  They may be archived later, and only with the maintainer's explicit go-ahead.

## Consequences

- Clean history and a clean licence from the first commit.
- Research found that the prototypes hold test inputs but no reusable expected outputs, so every expected answer
  in this repository is written fresh.
- No file is copied from the prototypes: no code, no fixtures and no recorded API responses. This keeps
  anything derived from a real org out of the public repository.
- Hard-won parser fixes in the prototypes have to be carried over as test cases, deliberately, or they are lost.
