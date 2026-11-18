#!/usr/bin/env node
/**
 * 发布脚本
 *
 *   node scripts/publish.mjs --check          仅做发布前校验（构建 + 打包 + 清单核对）
 *   node scripts/publish.mjs                  校验通过后发布到 Open VSX，令牌取自 OVSX_PAT 环境变量
 *   node scripts/publish.mjs --token <TOKEN>  同上，令牌直接传入
 *   node scripts/publish.mjs --bump patch     发布前提升版本号（patch / minor / major）
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');

const tokenFlagIndex = argv.indexOf('--token');
const token = tokenFlagIndex >= 0 ? argv[tokenFlagIndex + 1] : process.env.OVSX_PAT;

const bumpIndex = argv.indexOf('--bump');
const bump = bumpIndex >= 0 ? argv[bumpIndex + 1] : null;

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv }
  });
  if (result.status !== 0) {
    throw new Error(`命令失败（退出码 ${result.status}）：${command} ${args.join(' ')}`);
  }
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const pkgPath = resolve('package.json');
if (!existsSync(pkgPath)) {
  fail('未找到 package.json，请在插件项目根目录执行');
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

console.log('\n=== Endpoint Navigator 发布 ===');
console.log(`  名称      ${pkg.name}`);
console.log(`  版本      ${pkg.version}`);
console.log(`  发布者    ${pkg.publisher}`);
console.log(`  模式      ${checkOnly ? '仅校验' : '发布'}`);

if (!pkg.publisher || pkg.publisher === 'undefined') {
  fail('package.json 缺少 publisher 字段');
}
if (!pkg.repository?.url) {
  fail('package.json 缺少 repository.url，Open VSX 要求提供源码地址');
}
if (!existsSync('README.md')) {
  fail('缺少 README.md，无法发布');
}
if (!existsSync('LICENSE')) {
  fail('缺少 LICENSE，无法发布');
}

if (bump) {
  if (!['patch', 'minor', 'major'].includes(bump)) {
    fail(`--bump 只接受 patch / minor / major，收到：${bump}`);
  }
  console.log(`\n[1/5] 提升版本号（${bump}）`);
  run('npm', ['version', bump, '--no-git-tag-version']);
}

console.log('\n[2/5] 构建');
run('npm', ['run', 'build']);

if (!existsSync('dist/extension.js')) {
  fail('构建产物 dist/extension.js 不存在');
}
const bundleSize = statSync('dist/extension.js').size;
console.log(`      dist/extension.js ${(bundleSize / 1024).toFixed(1)} KB`);

console.log('\n[3/5] 打包 VSIX');
run('npx', ['--yes', '@vscode/vsce', 'package', '--no-dependencies', '--allow-missing-repository', '--skip-license']);

const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
const vsix = `${pkg.name}-${version}.vsix`;
if (!existsSync(vsix)) {
  fail(`未生成 ${vsix}`);
}
const vsixSize = statSync(vsix).size;
console.log(`      ${vsix} ${(vsixSize / 1024).toFixed(1)} KB`);

console.log('\n[4/5] 核对打包清单');
run('npx', ['--yes', '@vscode/vsce', 'ls', '--no-dependencies']);

if (checkOnly) {
  console.log('\n=== 校验完成 ===');
  console.log(`  待发布文件：${vsix}`);
  if (!token) {
    console.log('  令牌：未设置（发布时需提供 OVSX_PAT 或 --token）');
  } else {
    console.log('  令牌：已提供');
  }
  console.log('\n正式发布：npm run publish:ovsx\n');
  process.exit(0);
}

console.log('\n[5/5] 发布到 Open VSX');
if (!token) {
  fail(
    '未提供令牌。请在 https://open-vsx.org/user-settings/tokens 生成访问令牌，' +
      '然后执行：$env:OVSX_PAT="<令牌>"; npm run publish:ovsx'
  );
}

run('npx', ['--yes', 'ovsx', 'verify-pat', pkg.publisher], { OVSX_PAT: token });

console.log('      确保命名空间存在');
try {
  run('npx', ['--yes', 'ovsx', 'create-namespace', pkg.publisher], { OVSX_PAT: token });
} catch {
  console.log('      （命名空间已存在，或无权创建，继续发布）');
}

run('npx', ['--yes', 'ovsx', 'publish', vsix, '--skip-duplicate'], { OVSX_PAT: token });

console.log('\n=== 发布成功 ===');
console.log(`  扩展页面：https://open-vsx.org/extension/${pkg.publisher}/${pkg.name}`);
console.log(`  版本：${version}\n`);
