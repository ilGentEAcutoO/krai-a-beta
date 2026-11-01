#!/usr/bin/env node
// scripts/check-public.js — CI gate for the public repo.
// Fails when: .gitignore misses a real env file, git tracks one, or a
// tracked file contains a secret-looking value. Dependency-free.
// Run: node scripts/check-public.js
// Import: { scanText } for unit tests (app/test/check-public.test.mjs).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLACEHOLDER_HINTS = [
  'your',
  'xxx',
  'example',
  'changeme',
  'placeholder',
  'localhost',
  'test_',
  '....',
];
const isPlaceholder = (v) => {
  const s = String(v).toLowerCase();
  // Real keys/tokens are long; 1–7 char values are test stubs ('k', 'x').
  return s.replace(/[,;]$/, '').length < 8 || PLACEHOLDER_HINTS.some((h) => s.includes(h));
};

// In source code an UNQUOTED right-hand side that is an identifier or member
// path (`sitekey: siteKey,` / `apiKey = env.META_KEY;`) is a reference, not a
// literal secret. Env-style files (.env, .dev.vars, .toml, .ini, .yaml…) have
// no identifiers there, so the exemption never applies to them.
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx', '.html', '.vue', '.svelte', '.astro']);
const IDENT_REF = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*[,;)]?$/;

const SECRET_PATTERNS = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key block' },
  { re: /\b(ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/, label: 'github token' },
  { re: /\b(sk-ant-[A-Za-z0-9_-]{10,}|sk-proj-[A-Za-z0-9_-]{10,})\b/, label: 'model vendor key' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'aws access key' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, label: 'slack token' },
  {
    // KEY=VALUE assignments: flag only values that look real (long, no placeholder hints).
    re: /^\s*([A-Za-z_][A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD))\s*[:=]\s*(["']?)([^"'\s#]+)["']?\s*[,;]?\s*$/gim,
    label: 'assigned secret',
    valueGroup: 3,
    quoteGroup: 2,
  },
];

// Pure scanner: returns one finding string per pattern hit in `text`.
export function scanText(text, file = 'file') {
  const found = [];
  const isCode = CODE_EXT.has(extname(file).toLowerCase());
  for (const p of SECRET_PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : `${p.re.flags}g`);
    for (const m of text.matchAll(re)) {
      if (p.valueGroup) {
        const value = m[p.valueGroup];
        if (isPlaceholder(value)) continue;
        if (isCode && !m[p.quoteGroup] && IDENT_REF.test(value)) continue;
      }
      found.push(`${p.label} in ${file}: ${String(m[0]).slice(0, 48)}…`);
      break;
    }
  }
  return found;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const failures = [];
  const fail = (msg) => failures.push(msg);

  // --- 1. .gitignore must cover real env files ------------------------------
  const giPath = join(root, '.gitignore');
  const gi = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
  for (const p of ['.env', '.env.local', '.dev.vars', 'dev.vars', 'node_modules/', '.wrangler/']) {
    const covered = gi.split('\n').some((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return false;
      return t === p || t === `/${p}` || (p.startsWith('.') && t === `*${p}`);
    });
    if (!covered) fail(`.gitignore misses pattern for: ${p}`);
  }

  // --- 2. git must not track real env/secret files --------------------------
  let tracked = [];
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    tracked = out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    fail('git ls-files failed — run inside the repo with git available');
  }
  const FORBIDDEN_NAMES = new Set(['.env', '.env.local', '.dev.vars', 'dev.vars']);
  for (const f of tracked) {
    const base = basename(f);
    if (FORBIDDEN_NAMES.has(base)) fail(`real env file is visible to git: ${f}`);
    if (/\.pem$|\.key$|\.p12$|\.pfx$/i.test(base)) fail(`key material is visible to git: ${f}`);
  }

  // --- 3. scan visible files for secret-looking values ----------------------
  let scanned = 0;
  for (const f of tracked) {
    if (/\.(png|jpe?g|gif|webp|ico|mp4|mp3|wav|pdf|zip|woff2?)$/i.test(f)) continue;
    let text;
    try {
      text = readFileSync(join(root, f), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue;
    scanned += 1;
    for (const finding of scanText(text, f)) fail(finding);
  }

  if (failures.length > 0) {
    console.error(`check-public: FAIL (${failures.length})`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`check-public: OK (${scanned} files scanned)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
