'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compileTheme } = require('../theme-engine');

const directory = path.join(__dirname, '..', 'integration-profiles');
for (const filename of fs.readdirSync(directory).filter((name) => name.endsWith('.json'))) {
  const filePath = path.join(directory, filename);
  const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  profile.xrTheme = compileTheme(profile);
  fs.writeFileSync(filePath, `${JSON.stringify(profile, null, 2)}\n`);
  process.stdout.write(`Built ${profile.xrTheme.name}\n`);
}
