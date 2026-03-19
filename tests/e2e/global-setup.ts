import { FullConfig } from '@playwright/test';
import { exec } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup(_config: FullConfig) {
  // Build the extension with WXT before tests
  const buildDir = path.resolve(__dirname, '../../.output/chrome-mv3');

  try {
    rmSync(buildDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; continue if the folder doesn't exist.
  }

  await new Promise<void>((resolve, reject) => {
    exec('pnpm build', { cwd: path.resolve(__dirname, '../../'), windowsHide: true }, (error, stdout, stderr) => {
      process.stdout.write(stdout || '');
      process.stderr.write(stderr || '');
      if (error) reject(new Error(`wxt build failed: ${error.message}`));
      else resolve();
    });
  });

  if (!existsSync(buildDir)) {
    throw new Error(`Build output not found at ${buildDir}`);
  }
}
