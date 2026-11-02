import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('public commits exclude local credentials and generated account configuration, not source or examples', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'auth-publication-ignore-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: directory });
    await writeFile(path.join(directory, '.gitignore'),
      await readFile(new URL('../.gitignore', import.meta.url)));
    const privatePaths = [
      '.dliu_token', '.dliu_token (1)', 'dliu_token', 'dliu_token (2).txt',
      '.dliu_credentials', 'dliu_credentials.txt', 'local/.dliu_token',
      '.env', '.env.local', 'cdk.context.json', 'cdk-outputs.json',
      'cdk-outputs-production.json', 'build/web/config.json',
      'cdk.out/manifest.json', 'node_modules/example/index.js',
    ];
    const publicPaths = [
      '.env.example', 'package.json', 'package-lock.json', 'README.md',
      'web/token-console.mjs', 'web/docs.html', 'lib/token-console-stack.ts',
      'test/token-console.test.mjs',
    ];
    const ignored = execFileSync('git', [
      '-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '--stdin',
    ], {
      cwd: directory,
      input: [...privatePaths, ...publicPaths].join('\n') + '\n',
      encoding: 'utf8',
    }).trim().split('\n');
    assert.deepEqual(ignored, privatePaths);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
