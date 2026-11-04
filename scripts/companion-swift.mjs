// Runs the portable Swift core tests. On macOS with Swift installed it uses the
// local toolchain; elsewhere it uses a pinned Swift container (Docker required).
// Usage: pnpm companion:test
import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
const root = new URL('../', import.meta.url).pathname;
const pkg = new URL('../apps/jarvis-mac-companion/', import.meta.url).pathname;
const image = process.env.JARVIS_SWIFT_IMAGE ?? 'swift:6.1.2-noble';
const mode = process.argv[2] ?? 'test';
if (mode !== 'test') throw new Error('Only "test" is supported.');
if (platform() === 'darwin') {
  execFileSync('swift', ['test', '--package-path', pkg], { stdio: 'inherit' });
} else {
  // Read-only source mount; build products go to a container-local scratch path.
  execFileSync('docker', ['run', '--rm', '--network', 'none', '-v', `${root}:/src:ro`, '-w', '/src/apps/jarvis-mac-companion', image,
    'swift', 'test', '--scratch-path', '/tmp/jarvis-companion-build'], { stdio: 'inherit' });
}
