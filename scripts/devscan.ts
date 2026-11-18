import * as fs from 'fs';
import * as path from 'path';
import { findDuplicates } from '../src/analysis/duplicates';
import { parseJava } from '../src/java/parser';
import { ALL_SCANNERS } from '../src/registry';
import { Endpoint, ScanContext } from '../src/model';
import { toOpenApi } from '../src/report';
import { parseQuery, rankEndpoints } from '../src/search/score';

const root = process.argv[2] ?? '.';
const filter = process.argv[3] ?? '';
const openapiFlag = process.argv.indexOf('--openapi');
const openapiOut = openapiFlag > 0 ? process.argv[openapiFlag + 1] : '';

const files: string[] = [];

function walk(dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['target', 'node_modules', '.git', 'build', 'out', 'dist'].includes(entry.name)) {
        continue;
      }
      walk(full);
    } else if (entry.name.endsWith('.java')) {
      files.push(full);
    }
  }
}

walk(root);

function moduleOf(file: string): string {
  let dir = path.dirname(file);
  while (dir.length > root.length) {
    if (fs.existsSync(path.join(dir, 'pom.xml'))) {
      return path.basename(dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return '';
}

const started = Date.now();
const all: Endpoint[] = [];
const byKind = new Map<string, number>();

for (const file of files) {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const parsed = parseJava(text);
  const ctx: ScanContext = {
    filePath: file,
    module: moduleOf(file),
    constants: parsed.constants,
    parsed,
    contextPath: ''
  };

  for (const scanner of ALL_SCANNERS) {
    if (scanner.id === 'regexRule') {
      continue;
    }
    const found = scanner.scan(ctx, { rules: [] });
    for (const ep of found) {
      all.push(ep);
      byKind.set(ep.kind, (byKind.get(ep.kind) ?? 0) + 1);
    }
  }
}

const elapsed = Date.now() - started;

console.log(`文件数: ${files.length}`);
console.log(`耗时: ${elapsed} ms`);
console.log(`接口总数: ${all.length}`);
console.log('分类:');
for (const [kind, count] of Array.from(byKind.entries())) {
  console.log(`  ${kind}: ${count}`);
}

if (filter) {
  console.log(`\n--- 匹配 "${filter}" ---`);
  const hit = all.filter((ep) =>
    `${ep.path} ${ep.description ?? ''} ${ep.className} ${ep.methodName}`
      .toLowerCase()
      .includes(filter.toLowerCase())
  );
  console.log(`命中 ${hit.length} 条`);
  for (const ep of hit.slice(0, 25)) {
    console.log(
      `  [${ep.kindLabel}] ${ep.name}  |  ${ep.description ?? '-'}  |  ${ep.className}.${ep.methodName}  |  ${ep.filePath.replace(root, '')}:${ep.line}`
    );
  }

  const unresolved = all.filter((ep) => ep.unresolved.length > 0);
  console.log(`\n含未解析常量: ${unresolved.length} 条`);
  for (const ep of unresolved.slice(0, 5)) {
    console.log(`  ${ep.name} -> ${ep.unresolved.join(', ')}`);
  }
}

if (openapiOut) {
  fs.writeFileSync(openapiOut, toOpenApi(all, (file) => file.replace(root, '').replace(/^[\\/]/, '')));
  console.log(`\nOpenAPI 已写入: ${openapiOut}`);
}

console.log(`\n=== 重复映射 ===`);
const dupGroups = findDuplicates(all);
console.log(`冲突组数: ${dupGroups.length}`);
for (const g of dupGroups.slice(0, 8)) {
  console.log(`  ${g.key}  ->  ${g.endpoints.map((ep) => ep.className + '#' + ep.methodName).join(', ')}`);
}

const probe = (p: string, m: string, cls: string): Endpoint => ({
  id: cls,
  kind: 'rest',
  kindLabel: 'REST',
  name: `${m} ${p}`,
  path: p,
  httpMethod: m,
  description: '',
  tags: [],
  className: cls,
  methodName: 'probe',
  filePath: '/tmp/Probe.java',
  line: 1,
  module: '',
  unresolved: [],
  searchText: ''
});

const probeResult = findDuplicates([
  probe('/audit/list', 'POST', 'A'),
  probe('/audit/list/', 'post', 'B'),
  probe('/audit/list', 'GET', 'C')
]);
console.log(
  probeResult.length === 1 && probeResult[0].endpoints.length === 2
    ? 'PASS  重复检测：大小写与尾斜杠归一后识别为同组'
    : `FAIL  重复检测：得到 ${probeResult.length} 组`
);

console.log('\n=== 搜索能力自检 ===');

const cases: Array<{ label: string; query: string; regex: boolean; expect: string }> = [
  { label: '中文描述', query: '整单反审核', regex: false, expect: 'reverseAudit' },
  { label: '中文模糊词', query: '批量审核', regex: false, expect: '批量审核' },
  { label: '路径前缀', query: '/inspectionResultAudit', regex: false, expect: 'inspectionResultAudit' },
  { label: '方法名模糊', query: 'revau', regex: false, expect: 'reverseAudit' },
  { label: 're: 正则', query: 're:^/inspectionResultAudit/.*Audit$', regex: false, expect: 'inspectionResultAudit' },
  { label: '多词 AND', query: '审核 批量', regex: false, expect: '批量审核' }
];

for (const c of cases) {
  try {
    const parsed = parseQuery(c.query, c.regex, false);
    const result = rankEndpoints(all, parsed, null, 5);
    const top = result.items[0];
    const ok = !!top && `${top.path} ${top.description ?? ''} ${top.methodName}`.includes(c.expect);
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${c.label}  "${c.query}"  命中 ${result.total} 条  首条: ${top ? top.name + ' | ' + (top.description ?? '') : '无'}`
    );
  } catch (err) {
    console.log(`FAIL  ${c.label}  抛出: ${(err as Error).message}`);
  }
}

try {
  parseQuery('re:[', true, false);
  console.log('FAIL  非法正则未报错');
} catch (err) {
  console.log(`PASS  非法正则已报错: ${(err as Error).message}`);
}
