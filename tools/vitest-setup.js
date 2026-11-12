/*
 * Runs in every test process before the tests of a file.
 *
 * The Salesforce libraries keep logins in the home folder, and a mistake in
 * a test could change a real login of the person who runs the tests. So no
 * test ever sees the real home folder: each test file gets an empty one of
 * its own, which is removed when the process ends.
 *
 * The variables that steer the Salesforce libraries and the login with a
 * key are removed, so that a test behaves the same on every machine. So are
 * the proxy variables: the libraries would send requests for a test server
 * on this machine to the proxy. On macOS the libraries are told to keep
 * their encryption key in a file of the home folder, as they do on Linux,
 * and not in the keychain of the person.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'orglens-home-')));

for (const name of Object.keys(process.env)) {
  if (/^(?:SF_|SFDX_|ORGLENS_JWT_)/i.test(name) || /^(?:https?|all|no)_proxy$/i.test(name)) {
    Reflect.deleteProperty(process.env, name);
  }
}
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.SF_USE_GENERIC_UNIX_KEYCHAIN = 'true';

process.on('exit', () => {
  rmSync(home, { recursive: true, force: true, maxRetries: 3 });
});
