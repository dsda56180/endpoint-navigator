import { findDuplicates } from '../src/analysis/duplicates';
import { parseJava } from '../src/java/parser';
import { Endpoint, ScanContext } from '../src/model';
import { ALL_SCANNERS } from '../src/registry';
import { parseQuery, rankEndpoints } from '../src/search/score';

let failed = 0;
let passed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (ok) {
    passed++;
  } else {
    failed++;
  }
}

const source = `
package demo;

@RestController
@RequestMapping("/audit")
public class AuditController {

    @ApiOperation("整单反审核")
    @PostMapping(value = {"/reverse", "/reverse2"})
    public Result reverse(@PathVariable Long id) {
        return null;
    }
}
`;

const parsed = parseJava(source);
check('解析类型数量', parsed.types.length === 1, `实际 ${parsed.types.length}`);

const ctx: ScanContext = {
  filePath: '/tmp/AuditController.java',
  module: 'demo',
  constants: parsed.constants,
  parsed,
  contextPath: ''
};

const restScanner = ALL_SCANNERS.find((s) => s.id === 'rest');
check('找到 rest 扫描器', !!restScanner);

const found: Endpoint[] = restScanner ? restScanner.scan(ctx, { rules: [] }) : [];
check('数组路径展开为 2 条', found.length === 2, `实际 ${found.length}`);
check(
  '类级前缀拼接',
  found.every((ep) => ep.path.startsWith('/audit/')),
  found.map((ep) => ep.path).join(',')
);
check(
  'Swagger 中文描述',
  found.some((ep) => ep.description === '整单反审核'),
  found.map((ep) => ep.description ?? '-').join(',')
);

const terms = parseQuery('audit reverse', false, false);
check('多词 AND 解析', terms.terms.length === 2, terms.terms.join('|'));

const ranked = rankEndpoints(found, parseQuery('reverse', false, false), null, 10);
check('文本模糊搜索命中', ranked.total > 0, `命中 ${ranked.total}`);

const regexRanked = rankEndpoints(
  found,
  parseQuery('re:^/audit/.*Reverse$', true, false),
  null,
  10
);
check('锚点正则命中', regexRanked.total === 1, `命中 ${regexRanked.total}`);

let regexThrew = false;
try {
  parseQuery('re:[', true, false);
} catch {
  regexThrew = true;
}
check('非法正则抛错', regexThrew);

const probe = (path: string, method: string, cls: string): Endpoint => ({
  id: cls,
  kind: 'rest',
  kindLabel: 'REST',
  name: `${method} ${path}`,
  path,
  httpMethod: method,
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

const duplicates = findDuplicates([
  probe('/audit/list', 'POST', 'A'),
  probe('/audit/list/', 'post', 'B'),
  probe('/audit/list', 'GET', 'C')
]);
check('重复检测大小写与尾斜杠归一', duplicates.length === 1 && duplicates[0].endpoints.length === 2);
check('不同 method 不算重复', findDuplicates([probe('/x', 'GET', 'A'), probe('/x', 'POST', 'B')]).length === 0);

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exitCode = failed > 0 ? 1 : 0;
