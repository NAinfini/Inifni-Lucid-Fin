/**
 * macOS notarization script for electron-builder afterSign hook.
 * Requires APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID env vars.
 * Skipped in non-CI or non-macOS environments.
 */
exports.default = async function notarize(context) {
  if (process.platform !== 'darwin') return;
  if (!process.env.APPLE_ID) {
    console.log('Skipping notarization — APPLE_ID not set');
    return;
  }

  const { notarize } = require('@electron/notarize');
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;

  console.log(`Notarizing ${appPath}...`);
  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
  console.log('Notarization complete.');
};
