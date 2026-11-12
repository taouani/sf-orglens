/**
 * The `api` layer: the only layer clients see.
 *
 * It may import from every other layer. No other layer may import from it.
 *
 * A name is exported here once a client uses it, not before. Every export is
 * a contract, recorded in `test/golden/api-surface.json`. Component keys and
 * the reference vocabulary of `core` are exported with the first command
 * that takes or returns them.
 */
export { engineVersion } from '../core/version.ts';

export { EngineError, ERROR_CODES, isEngineError } from '../core/errors.ts';
export type { EngineErrorJson, EngineErrorOptions, ErrorCode, JsonValue } from '../core/errors.ts';

export { initWorkspace, openWorkspace } from './workspace.ts';
export type {
  InitOptions,
  InitResult,
  SnapshotSummary,
  SourceInput,
  SourceLink,
  SourceStatus,
  StoreStatus,
  Workspace,
  WorkspaceLocator,
  WorkspaceStatus,
} from './workspace.ts';
export type { GitSource, OrgSource, SandboxSource, SourceDeclaration } from '../core/config/config.ts';

export type { CoverageReport, SnapshotInfo, SnapshotIssue, TypeCoverage } from './snapshot.ts';
export type { GitCheck, OrgCheck, SourceCheck } from './check.ts';

export { doctor } from './doctor.ts';
export type { DoctorCheck, DoctorReport } from './doctor.ts';
