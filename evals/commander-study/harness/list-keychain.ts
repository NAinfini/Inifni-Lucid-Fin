/**
 * Lists ALL credentials under the 'lucid-fin' service name so we can discover
 * the real custom-provider ids. The Settings renderer assigns ids at creation
 * time (often `custom-<timestamp>`) and we don't have access to Redux here.
 */
import keytar from 'keytar';

async function main() {
  const SERVICE_NAME = 'lucid-fin';
  const creds = await keytar.findCredentials(SERVICE_NAME);
  if (creds.length === 0) {
    console.log(`No credentials under service '${SERVICE_NAME}'.`);
    console.log('Make sure you ran the app at least once and configured providers.');
    process.exit(1);
  }
  console.log(`Found ${creds.length} credential(s) under '${SERVICE_NAME}':\n`);
  for (const c of creds) {
    console.log(`  account=${c.account}  password-len=${c.password.length}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
