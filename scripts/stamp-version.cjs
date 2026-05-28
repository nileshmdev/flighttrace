'use strict';

// Reads the nearest git tag and writes it into package.json version so that
// electron-builder uses it for the output filename (e.g. FlightTrace-1.2.0.AppImage).
// Mirrors what the CI "Set version from tag" step does for local desktop builds.
// Exits silently with no changes when no tag is found.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let tag;
try {
  tag = execSync('git describe --tags --abbrev=0', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
} catch {
  process.exit(0);
}

const version = tag.startsWith('v') ? tag.slice(1) : tag;
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (pkg.version === version) process.exit(0);

pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[stamp-version] package.json version → ${version}`);
