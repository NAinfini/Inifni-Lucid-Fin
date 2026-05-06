/**
 * FFmpeg binary download and checksum verification script.
 *
 * Usage:
 *   npx tsx scripts/fetch-ffmpeg.ts                    # Download + verify for current platform
 *   npx tsx scripts/fetch-ffmpeg.ts --verify           # Verify existing binaries only
 *   npx tsx scripts/fetch-ffmpeg.ts --compute-checksums # Compute SHA-256 for existing binaries
 *   npx tsx scripts/fetch-ffmpeg.ts --platform win32-x64 # Target a specific platform
 *
 * Binaries are placed in resources/bin/<platform>/
 * Checksums are read from packages/media-engine/ffmpeg-checksums.json
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface BinaryEntry {
  filename: string;
  sha256: string;
}

interface PlatformBinaries {
  ffmpeg: BinaryEntry;
  ffprobe: BinaryEntry;
}

interface ChecksumManifest {
  version: string;
  license: string;
  licenseNote: string;
  sourceUrls: Record<string, string>;
  binaries: Record<string, PlatformBinaries>;
  upgradePlaybook: string[];
}

const REPO_ROOT = resolve(import.meta.dirname ?? '.', '..');
const MANIFEST_PATH = join(REPO_ROOT, 'packages', 'media-engine', 'ffmpeg-checksums.json');
const BIN_DIR = join(REPO_ROOT, 'resources', 'bin');

function loadManifest(): ChecksumManifest {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Checksum manifest not found: ${MANIFEST_PATH}`);
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ChecksumManifest;
}

async function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function getCurrentPlatform(): string {
  return `${process.platform}-${process.arch}`;
}

async function verifyPlatform(
  manifest: ChecksumManifest,
  platformKey: string,
): Promise<boolean> {
  const platformBinaries = manifest.binaries[platformKey];
  if (!platformBinaries) {
    console.error(`[ERROR] Platform "${platformKey}" not found in manifest.`);
    return false;
  }

  const platformDir = join(BIN_DIR, platformKey);
  if (!existsSync(platformDir)) {
    console.error(`[ERROR] Binary directory not found: ${platformDir}`);
    console.error(
      `  Download FFmpeg ${manifest.version} for ${platformKey} and place binaries in ${platformDir}/`,
    );
    return false;
  }

  let allValid = true;

  for (const [name, entry] of Object.entries(platformBinaries) as [string, BinaryEntry][]) {
    const filePath = join(platformDir, entry.filename);
    if (!existsSync(filePath)) {
      console.error(`[MISSING] ${name}: ${filePath}`);
      allValid = false;
      continue;
    }

    if (entry.sha256.startsWith('PLACEHOLDER')) {
      console.warn(`[SKIP] ${name}: checksum is a placeholder — run --compute-checksums first`);
      continue;
    }

    const actual = await computeSha256(filePath);
    if (actual !== entry.sha256) {
      console.error(`[MISMATCH] ${name}: expected ${entry.sha256}, got ${actual}`);
      allValid = false;
    } else {
      console.log(`[OK] ${name}: ${entry.filename} (${actual.slice(0, 12)}...)`);
    }
  }

  return allValid;
}

async function computeChecksums(
  manifest: ChecksumManifest,
  platformKey: string,
): Promise<void> {
  const platformBinaries = manifest.binaries[platformKey];
  if (!platformBinaries) {
    console.error(`Platform "${platformKey}" not found in manifest.`);
    return;
  }

  const platformDir = join(BIN_DIR, platformKey);
  if (!existsSync(platformDir)) {
    console.error(`Binary directory not found: ${platformDir}`);
    return;
  }

  console.log(`Computing SHA-256 checksums for ${platformKey}:\n`);

  for (const [name, entry] of Object.entries(platformBinaries) as [string, BinaryEntry][]) {
    const filePath = join(platformDir, entry.filename);
    if (!existsSync(filePath)) {
      console.error(`  ${name}: file not found at ${filePath}`);
      continue;
    }

    const hash = await computeSha256(filePath);
    console.log(`  "${name}": "${hash}"`);
  }

  console.log(
    '\nCopy these values into packages/media-engine/ffmpeg-checksums.json and replace the PLACEHOLDER entries.',
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes('--verify');
  const computeOnly = args.includes('--compute-checksums');
  const platformFlag = args.indexOf('--platform');
  const targetPlatform =
    platformFlag >= 0 && args[platformFlag + 1]
      ? args[platformFlag + 1]
      : getCurrentPlatform();

  const manifest = loadManifest();

  console.log(`FFmpeg version: ${manifest.version} (${manifest.license})`);
  console.log(`Target platform: ${targetPlatform}\n`);

  if (computeOnly) {
    await computeChecksums(manifest, targetPlatform);
    return;
  }

  if (verifyOnly) {
    const valid = await verifyPlatform(manifest, targetPlatform);
    if (!valid) {
      console.error('\nChecksum verification FAILED.');
      process.exitCode = 1;
    } else {
      console.log('\nAll checksums verified.');
    }
    return;
  }

  // Default: check if binaries exist, verify if they do, guide if they don't
  const platformDir = join(BIN_DIR, targetPlatform);
  if (!existsSync(platformDir)) {
    mkdirSync(platformDir, { recursive: true });
    console.log(`Created binary directory: ${platformDir}`);
  }

  const platformBinaries = manifest.binaries[targetPlatform];
  if (!platformBinaries) {
    console.error(`Platform "${targetPlatform}" is not in the supported platform matrix.`);
    console.error(`Supported platforms: ${Object.keys(manifest.binaries).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const sourceUrl = manifest.sourceUrls[targetPlatform];
  const anyMissing = Object.values(platformBinaries).some(
    (entry) => !existsSync(join(platformDir, entry.filename)),
  );

  if (anyMissing) {
    console.log('FFmpeg binaries not found locally. Manual download required:\n');
    console.log(`  1. Download FFmpeg ${manifest.version} from:`);
    console.log(`     ${sourceUrl}\n`);
    console.log(`  2. Extract and place binaries in: ${platformDir}/`);
    console.log(
      `     Required files: ${Object.values(platformBinaries)
        .map((e) => e.filename)
        .join(', ')}\n`,
    );
    console.log('  3. Run this script again with --compute-checksums to generate hashes.');
    console.log('  4. Update packages/media-engine/ffmpeg-checksums.json with the hashes.');
    console.log('  5. Run this script again with --verify to confirm.\n');
    process.exitCode = 1;
    return;
  }

  // Binaries exist — verify checksums
  const valid = await verifyPlatform(manifest, targetPlatform);
  if (!valid) {
    console.error('\nChecksum verification FAILED.');
    process.exitCode = 1;
  } else {
    console.log('\nAll binaries present and verified.');
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
