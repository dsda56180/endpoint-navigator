import { applyConstants } from '../src/analysis/constants';
import { findDuplicates } from '../src/analysis/duplicates';
import { findHoverTargets } from '../src/analysis/hover';
import { applyInheritance, ifacesOf } from '../src/analysis/inheritance';
import { parseJava } from '../src/java/parser';
import { AnnotationNode, Endpoint, ScanContext } from '../src/model';
import { ALL_SCANNERS } from '../src/registry';
import { toOpenApi } from '../src/report';
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
check(
  '路径变量名差异视为同一路由',
  findDuplicates([probe('/order/{id}', 'GET', 'A'), probe('/order/{orderId}', 'GET', 'B')]).length === 1
);

const withConst: Endpoint = {
  ...probe('/api/{ApiConstants.VERSION}/list', 'GET', 'X'),
  unresolved: ['ApiConstants.VERSION']
};
const resolved = applyConstants(withConst, new Map([['VERSION', 'v2']]));
check('跨文件常量按末段解析', resolved.path === '/api/v2/list', resolved.path);
check(
  '无匹配常量保留占位',
  applyConstants(withConst, new Map()).path === '/api/{ApiConstants.VERSION}/list'
);

const ifaceParsed = parseJava(`
public interface AuditApi {
    @GetMapping("/list")
    Result list();
}
`);

const implParsed = parseJava(`
@RestController
@RequestMapping("/audit")
public class AuditController implements AuditApi {
    public Result list() { return null; }
}
`);

const registry = new Map<string, Map<string, AnnotationNode[]>>();
for (const info of ifacesOf(ifaceParsed)) {
  registry.set(info.name, new Map(info.methods.map((m) => [m.name, m.annotations])));
}
applyInheritance(implParsed, registry);

const implCtx: ScanContext = {
  filePath: '/tmp/AuditController.java',
  module: 'demo',
  constants: implParsed.constants,
  parsed: implParsed,
  contextPath: ''
};
const implFound: Endpoint[] = restScanner ? restScanner.scan(implCtx, { rules: [] }) : [];
check(
  '接口映射被实现类继承',
  implFound.some((ep) => ep.path === '/audit/list'),
  implFound.map((ep) => ep.path).join(',')
);

const filterProbes = [
  probe('/audit/list', 'GET', 'A'),
  probe('/audit/delete', 'POST', 'B'),
  probe('/audit/delete', 'GET', 'C')
];
check(
  'method: 过滤',
  rankEndpoints(filterProbes, parseQuery('method:GET', false, false), null, 10).total === 2
);
check(
  'kind: 过滤',
  rankEndpoints(filterProbes, parseQuery('kind:xxljob', false, false), null, 10).total === 0
);
check(
  '排除词 -delete',
  rankEndpoints(filterProbes, parseQuery('-delete', false, false), null, 10).items.every(
    (ep) => ep.path === '/audit/list'
  )
);
check(
  '条件与关键词组合',
  rankEndpoints(filterProbes, parseQuery('method:GET -delete audit', false, false), null, 10)
    .total === 1
);

const xxlJobParsed = parseJava(`
public class JobHandler {
    @XxlJob("autoInspectionRoundJobHandler")
    public void autoInspection() {
    }
}
`);
const xxlJobScanner = ALL_SCANNERS.find((s) => s.id === 'xxljob');
const xxlJobFound = xxlJobScanner
  ? xxlJobScanner.scan(
      {
        filePath: '/tmp/JobHandler.java',
        module: '',
        constants: xxlJobParsed.constants,
        parsed: xxlJobParsed,
        contextPath: ''
      },
      { rules: [] }
    )
  : [];
check(
  'xxl-job 扫描',
  xxlJobFound.length === 1 && xxlJobFound[0].path === 'autoInspectionRoundJobHandler',
  xxlJobFound.map((ep) => ep.path).join(',')
);

const mapperParsed = parseJava(`
@Mapper
public interface UserMapper {
    int insert(User user);
    User selectById(Long id);
}
`);
const mapperScanner = ALL_SCANNERS.find((s) => s.id === 'mybatis');
const mapperFound = mapperScanner
  ? mapperScanner.scan(
      {
        filePath: '/tmp/UserMapper.java',
        module: '',
        constants: mapperParsed.constants,
        parsed: mapperParsed,
        contextPath: ''
      },
      { rules: [] }
    )
  : [];
check('MyBatis Mapper 扫描', mapperFound.length === 2, `实际 ${mapperFound.length}`);

const wsParsed = parseJava(`
public class WsConfig {
    public void configure() {
        registry.addEndpoint("/ws").withSockJS();
    }
    @MessageMapping("/chat.send")
    public void send(String msg) {
    }
}
`);
const wsScanner = ALL_SCANNERS.find((s) => s.id === 'stomp');
const wsFound = wsScanner
  ? wsScanner.scan(
      {
        filePath: '/tmp/WsConfig.java',
        module: '',
        constants: wsParsed.constants,
        parsed: wsParsed,
        contextPath: ''
      },
      { rules: [] }
    )
  : [];
check(
  'WebSocket 端点扫描',
  wsFound.some((ep) => ep.path === '/ws') && wsFound.some((ep) => ep.path === '/chat.send'),
  wsFound.map((ep) => ep.path).join(',')
);

const mqParsed = parseJava(`
public class Listener {
    @RabbitListener(queues = "order.queue")
    public void onOrder(String msg) {
    }
    @KafkaListener(topics = {"topic.a", "topic.b"})
    public void onKafka(String msg) {
    }
    @Scheduled(cron = "0 0 * * * ?")
    public void tick() {
    }
}
`);
const mqScanner = ALL_SCANNERS.find((s) => s.id === 'messaging');
const mqFound = mqScanner
  ? mqScanner.scan(
      {
        filePath: '/tmp/Listener.java',
        module: '',
        constants: mqParsed.constants,
        parsed: mqParsed,
        contextPath: ''
      },
      { rules: [] }
    )
  : [];
check(
  'RabbitMQ / Kafka / 定时任务扫描',
  mqFound.filter((ep) => ep.kind === 'mq').length === 3 &&
    mqFound.filter((ep) => ep.kind === 'scheduled').length === 1,
  mqFound.map((ep) => `${ep.kind}:${ep.path}`).join(',')
);

const openapi = JSON.parse(toOpenApi(found, (p) => p));
check(
  'OpenAPI 生成路径',
  !!openapi.paths['/audit/reverse']?.post,
  Object.keys(openapi.paths).join(',')
);
check(
  'OpenAPI 保留中文描述',
  openapi.paths['/audit/reverse']?.post?.description === '整单反审核'
);
check(
  'OpenAPI 使用模块作为标签',
  openapi.paths['/audit/reverse']?.post?.tags?.[0] === 'demo'
);
check(
  'OpenAPI 路径变量生成参数',
  JSON.parse(
    toOpenApi([probe('/order/{id}', 'GET', 'OrderController')], (p) => p)
  ).paths['/order/{id}'].get.parameters.length === 1
);

const hoverParsed = parseJava(`
@RestController
@RequestMapping("/audit")
public class AuditController {
    @GetMapping("/list")
    public Result list() {
        return null;
    }
}
`);
const hoverTargets = findHoverTargets(hoverParsed, 5);
check(
  '悬浮定位到注解行',
  hoverTargets.length === 1 &&
    hoverTargets[0].methodName === 'list' &&
    hoverTargets[0].className === 'AuditController',
  hoverTargets.map((t) => `${t.className}.${t.methodName}`).join(',')
);

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exitCode = failed > 0 ? 1 : 0;
