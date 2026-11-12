import { join, relative, sep } from 'node:path';
import { MetadataResolver, type SourceComponent } from '@salesforce/source-deploy-retrieve';

/**
 * What the resolver of Salesforce finds when it reads folders from disk
 * itself: every component and every part of one, by `Type:FullName`, with
 * the files it names for it, as paths below `root` with forward slashes.
 *
 * This is the reading OrgLens is compared with. It throws where the
 * library throws.
 */
export function libraryReading(root: string, dirs: readonly string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const visit = (component: SourceComponent): void => {
    const id = `${component.type.name}:${component.fullName}`;
    const files = found.get(id) ?? [];
    found.set(id, files);
    for (const file of [component.xml, ...component.walkContent()]) {
      if (file !== undefined) files.push(relative(root, file).split(sep).join('/'));
    }
    component.getChildren().forEach(visit);
  };
  for (const dir of dirs) {
    new MetadataResolver().getComponentsFromPath(join(root, ...dir.split('/'))).forEach(visit);
  }
  return found;
}

/** Every file the library names for any component, sorted and once each. */
export function libraryFiles(reading: Map<string, string[]>): string[] {
  return [...new Set([...reading.values()].flat())].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
