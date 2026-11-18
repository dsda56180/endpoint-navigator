import { Endpoint, ScanContext, Scanner, makeSearchText } from '../model';
import { buildLineIndex, lineAt } from '../util';

interface StompRule {
  re: RegExp;
  label: string;
  description: string;
}

const RULES: StompRule[] = [
  {
    re: /addEndpoint\s*\(\s*"([^"]+)"/g,
    label: 'STOMP',
    description: 'STOMP 连接端点'
  },
  {
    re: /@MessageMapping\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/g,
    label: 'IN',
    description: 'WebSocket 入站消息'
  },
  {
    re: /@SubscribeMapping\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/g,
    label: 'SUB',
    description: 'WebSocket 订阅'
  },
  {
    re: /@SendTo\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/g,
    label: 'OUT',
    description: 'WebSocket 广播目的地'
  },
  {
    re: /convertAndSend\s*\(\s*"([^"]+)"/g,
    label: 'PUSH',
    description: 'WebSocket 推送目的地'
  }
];

function nearestClass(types: ScanContext['parsed']['types'], line: number): string {
  let name = '';
  let bestLine = -1;
  for (const t of types) {
    if (t.line <= line && t.line > bestLine) {
      bestLine = t.line;
      name = t.className;
    }
  }
  return name;
}

export const stompScanner: Scanner = {
  id: 'stomp',
  label: 'WebSocket',
  scan(ctx: ScanContext): Endpoint[] {
    const endpoints: Endpoint[] = [];
    const src = ctx.parsed.masked;
    const index = buildLineIndex(src);
    const seen = new Set<string>();

    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.re.exec(src)) !== null) {
        const path = m[1];
        if (!path) {
          continue;
        }
        const line = lineAt(index, m.index);
        const key = `${rule.label}|${path}|${line}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const className = nearestClass(ctx.parsed.types, line);

        endpoints.push({
          id: `${ctx.filePath}#${line}#websocket#${rule.label}#${path}`,
          kind: 'websocket',
          kindLabel: 'WebSocket',
          name: `${rule.label} ${path}`,
          path,
          description: rule.description,
          tags: [rule.label],
          className,
          methodName: '',
          filePath: ctx.filePath,
          line,
          module: ctx.module,
          unresolved: [],
          searchText: makeSearchText([path, rule.label, rule.description, className, 'websocket stomp'])
        });
      }
    }

    return endpoints;
  }
};
