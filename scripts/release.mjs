// npm run release — tag the next version and commit package.json.
//
// Versions step by 0.0.1 and each place rolls over at 9, like a decimal:
// 1.0.8 → 1.0.9 → 1.1.0, and 1.9.9 → 2.0.0 (operator, 2026-10-30). A place
// already past 9 rolls over on its next step, which is how 1.0.24 → 1.1.0.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export function nextVersion(current) {
  let [major, minor, patch] = current.split('.').map(Number)
  patch += 1
  if (patch > 9) { patch = 0; minor += 1 }
  if (minor > 9) { minor = 0; major += 1 }
  return `${major}.${minor}.${patch}`
}

if (process.argv[1]?.endsWith('release.mjs')) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const next = nextVersion(version)
  // --force because .hallmark/log.json is always dirty. On Windows npm is a
  // .cmd and has to go through the shell, which splits an unquoted message.
  const win = process.platform === 'win32'
  const message = win ? '"Release %s"' : 'Release %s'
  execFileSync('npm', ['version', next, '--force', '-m', message], { stdio: 'inherit', shell: win })
}
