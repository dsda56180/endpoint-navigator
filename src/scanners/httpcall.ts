import { buildValueFields } from '../analysis/appconfig';
import { evalStrings } from '../java/expr';
import { skipQuoted } from '../java/lexer';
import { Endpoint, ParsedFile, ScanContext, Scanner, makeSearchText } from '../model';

const REST_METHODS: Record<string, string> = {
  getForObject: 'GET',
  getForEntity: 'GET',
  postForObject: 'POST',
  postForEntity: 'POST',
  postForLocation: 'POST',
  put: 'PUT',
  delete: 'DELETE',
  patchForObject: 'PATCH',
  exchange: 'ALL',
  execute: 'ALL'
};

const REST_CALL_RE =
  /([A-Za-z_$][\w$]*)\s*\.\s*(getForObject|getForEntity|postForObject|postForEntity|postForLocation|put|delete|patchForObject|exchange|execute)\s*\(/g;
const CHAIN_CALL_RE = /\.\s*(uri|url)\s*\(/g;
const HUTOOL_RE = /HttpUtil\s*\.\s*(get|post|createGet|createPost)\s*\(/g;
const HTTP_REQUEST_RE = /HttpRequest\s*\.\s*(get|post)\s*\(/g;

interface Candidate {
  index: number;
  open: number;
  method: string;
  receiver: string;
}

function readFirstArg(text: string, open: number): string | undefined {
  let i = open + 1;
  let depth = 0;
  let buf = '';

  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const quoted = skipQuoted(text, i);
      buf += text.slice(i, quoted.end);
      i = quoted.end;
      continue;
    }
    if (c === '(') {
      depth++;
      buf += c;
      i++;
      continue;
    }
    if (c === ')') {
      if (depth === 0) {
        break;
      }
      depth--;
      buf += c;
      i++;
      continue;
    }
    if ((c === ',' || c === ';') && depth === 0) {
      break;
    }
    buf += c;
    i++;
  }

  const expr = buf.trim();
  return expr.length > 0 ? expr : undefined;
}

function inferVerb(text: string, index: number): string {
  const start = Math.max(0, index - 300);
  const chunk = text.slice(start, index);
  const re = /\.\s*(get|post|put|delete|patch)\s*\(/gi;
  let last = 'ALL';
  let match: RegExpExecArray | null;
  while ((match = re.exec(chunk)) !== null) {
    last = match[1].toUpperCase();
  }
  return last;
}

function locate(parsed: ParsedFile, line: number): { className: string; methodName: string } {
  let type = undefined as ParsedFile['types'][number] | undefined;
  for (const candidate of parsed.types) {
    if (candidate.line <= line && (!type || candidate.line >= type.line)) {
      type = candidate;
    }
  }
  if (!type) {
    return { className: '', methodName: '' };
  }
  let method = undefined as ParsedFile['types'][number]['methods'][number] | undefined;
  for (const candidate of type.methods) {
    if (candidate.line <= line && (!method || candidate.line >= method.line)) {
      method = candidate;
    }
  }
  return { className: type.className, methodName: method?.name ?? '' };
}

function collectCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];

  let match: RegExpExecArray | null;
  REST_CALL_RE.lastIndex = 0;
  while ((match = REST_CALL_RE.exec(text)) !== null) {
    const receiver = match[1];
    const name = match[2];
    const open = match.index + match[0].length - 1;
    if (
      (name === 'put' || name === 'delete' || name === 'exchange' || name === 'execute') &&
      !/rest|template|client|http/i.test(receiver)
    ) {
      continue;
    }
    candidates.push({ index: match.index, open, method: REST_METHODS[name], receiver });
  }

  // WebClient.uri / OkHttp.url：方法名从链式调用推断
  CHAIN_CALL_RE.lastIndex = 0;
  while ((match = CHAIN_CALL_RE.exec(text)) !== null) {
    candidates.push({
      index: match.index,
      open: match.index + match[0].length - 1,
      method: inferVerb(text, match.index),
      receiver: ''
    });
  }

  HUTOOL_RE.lastIndex = 0;
  while ((match = HUTOOL_RE.exec(text)) !== null) {
    candidates.push({
      index: match.index,
      open: match.index + match[0].length - 1,
      method: match[1].toLowerCase().includes('post') ? 'POST' : 'GET',
      receiver: 'HttpUtil'
    });
  }

  HTTP_REQUEST_RE.lastIndex = 0;
  while ((match = HTTP_REQUEST_RE.exec(text)) !== null) {
    candidates.push({
      index: match.index,
      open: match.index + match[0].length - 1,
      method: match[1].toLowerCase() === 'post' ? 'POST' : 'GET',
      receiver: 'HttpRequest'
    });
  }

  candidates.sort((a, b) => a.index - b.index || a.open - b.open);
  return candidates;
}

/**
 * 识别 RestTemplate / WebClient / Hutool / OkHttp 的调用点。
 * 支持字面量、类常量、@Value 注入字段与 + 拼接；配置占位符在索引阶段统一解析。
 */
export const httpcallScanner: Scanner = {
  id: 'httpcall',
  label: 'HTTP 调用',
  scan(ctx: ScanContext): Endpoint[] {
    const text = ctx.text;
    if (!text) {
      return [];
    }

    const scope = new Map(ctx.parsed.constants);
    const config = ctx.config ?? new Map<string, string>();
    for (const [name, value] of buildValueFields(text, config)) {
      scope.set(name, value);
    }

    const endpoints: Endpoint[] = [];
    const seen = new Set<string>();
    let cursor = 0;
    let line = 1;

    const lineOf = (index: number): number => {
      while (cursor < index) {
        if (text[cursor] === '\n') {
          line++;
        }
        cursor++;
      }
      return line;
    };

    for (const candidate of collectCandidates(text)) {
      const expr = readFirstArg(text, candidate.open);
      if (!expr) {
        continue;
      }
      const values = evalStrings(expr, scope, []);
      const value = values[0]?.trim();
      if (!value || value.length > 500) {
        continue;
      }
      if (!/^(https?:\/\/|\/|\$\{)/i.test(value)) {
        continue;
      }

      const position = lineOf(candidate.index);
      const key = `${position}#${candidate.method}#${value}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const owner = locate(ctx.parsed, position);
      const host = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
      const tags = host ? [host] : [];
      endpoints.push({
        id: `${ctx.filePath}#${position}#httpcall#${candidate.method}#${endpoints.length}`,
        kind: 'httpcall',
        kindLabel: 'HTTP 调用',
        direction: 'out',
        name: `${candidate.method} ${value}`,
        path: value,
        httpMethod: candidate.method,
        tags,
        className: owner.className,
        methodName: owner.methodName,
        filePath: ctx.filePath,
        line: position,
        module: ctx.module,
        unresolved: [],
        searchText: makeSearchText([
          value,
          owner.className,
          owner.methodName,
          tags.join(' '),
          candidate.method,
          candidate.receiver
        ])
      });
    }

    return endpoints;
  }
};
