// Removes build and coverage output. Works the same on every platform.
import { rmSync } from 'node:fs';

for (const path of ['packages/engine/dist', 'packages/cli/dist', 'coverage']) {
  rmSync(new URL(`../${path}`, import.meta.url), { recursive: true, force: true });
}
