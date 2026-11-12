/**
 * Runs `work` with variables of the environment set or, with `undefined`,
 * removed, and puts them back afterwards, also when `work` is
 * asynchronous. The engine starts Git with the environment of this
 * process, so this is how a test gives Git another one.
 */
export function withEnvironment<T>(changes: Record<string, string | undefined>, work: () => T): T {
  const before = Object.keys(changes).map((name) => [name, process.env[name]] as const);
  const set = (name: string, value: string | undefined): void => {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  };
  const restore = (): void => {
    for (const [name, value] of before) set(name, value);
  };
  for (const [name, value] of Object.entries(changes)) set(name, value);
  let result: T;
  try {
    result = work();
  } catch (error) {
    restore();
    throw error;
  }
  if (result instanceof Promise) return result.finally(restore) as T;
  restore();
  return result;
}

/** The name of the variable programs are found with. On Windows it is usually written `Path`. */
const PATH_NAME = Object.keys(process.env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';

/** Runs `work` with a search path on which there is no `git`: `emptyDir` is a folder with nothing in it. */
export function withoutGit<T>(emptyDir: string, work: () => T): T {
  return withEnvironment({ [PATH_NAME]: emptyDir }, work);
}
