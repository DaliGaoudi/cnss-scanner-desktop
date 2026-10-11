#!/usr/bin/env node
/*
 * Rotate the single shared office password.
 *
 *   npm run set-password -- <newPassword>
 *
 * Writes the new bcrypt hash into config.json in the SAME user-data dir the
 * installed app uses (%APPDATA%/CNSS Scanner on Windows), so the change takes
 * effect on the next login. No reinstall needed.
 */
const { setPassword, configPath } = require('../server/config');

const pw = process.argv[2];
if (!pw) {
    console.error('Usage: npm run set-password -- <newPassword>');
    process.exit(1);
}

setPassword(pw);
console.log('Password updated in', configPath());
