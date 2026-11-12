/*
 * Writes one login of the Salesforce CLI into the home folder of this process, as `sf org login` leaves it
 * behind. A test that starts a process with a home folder of its own gives it a login this way: the library
 * encrypts a login with a key it keeps in the home folder, so the login has to be written where it is read.
 *
 *   node seed-login.ts <user name> <alias> <org id> <address of the org> <session>
 */
import { seedCliLogin } from './cli-logins.ts';

const [username, alias, orgId, instanceUrl, accessToken] = process.argv.slice(2);
if (
  username === undefined ||
  alias === undefined ||
  orgId === undefined ||
  instanceUrl === undefined ||
  accessToken === undefined
)
  throw new Error('usage: seed-login.ts <user name> <alias> <org id> <address of the org> <session>');

await seedCliLogin({ username, alias, orgId, instanceUrl, accessToken });
