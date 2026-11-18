import { skipQuoted } from './lexer';

/** 按分隔符切分，忽略括号/花括号/方括号内部与字符串内部的分隔符 */
export function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let i = 0;
  let round = 0;
  let curly = 0;
  let square = 0;

  while (i < text.length) {
    const c = text[i];

    if (c === '"' || c === "'") {
      const r = skipQuoted(text, i);
      buf += text.slice(i, r.end);
      i = r.end;
      continue;
    }

    if (c === '(') round++;
    else if (c === ')') round--;
    else if (c === '{') curly++;
    else if (c === '}') curly--;
    else if (c === '[') square++;
    else if (c === ']') square--;

    if (c === sep && round === 0 && curly === 0 && square === 0) {
      parts.push(buf);
      buf = '';
      i++;
      continue;
    }

    buf += c;
    i++;
  }

  if (buf.trim().length > 0 || parts.length > 0) {
    parts.push(buf);
  }

  return parts;
}

function findTopLevelEquals(text: string): number {
  let i = 0;
  let round = 0;
  let curly = 0;

  while (i < text.length) {
    const c = text[i];

    if (c === '"' || c === "'") {
      const r = skipQuoted(text, i);
      i = r.end;
      continue;
    }

    if (c === '(') round++;
    else if (c === ')') round--;
    else if (c === '{') curly++;
    else if (c === '}') curly--;

    if (c === '=' && round === 0 && curly === 0) {
      const prev = text[i - 1];
      const next = text[i + 1];
      if (prev !== '=' && prev !== '!' && prev !== '<' && prev !== '>' && next !== '=') {
        return i;
      }
    }

    i++;
  }

  return -1;
}

/** 解析注解参数为「参数名 → 原始表达式」，裸值归到 value */
export function parseArgs(args: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!args || args.trim().length === 0) {
    return map;
  }

  for (const raw of splitTopLevel(args, ',')) {
    const part = raw.trim();
    if (!part) {
      continue;
    }
    const eq = findTopLevelEquals(part);
    if (eq < 0) {
      map.set('value', part);
    } else {
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key) {
        map.set(key, value);
      }
    }
  }

  return map;
}

const IDENT_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

function readStringLiteral(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith('"')) {
    return null;
  }
  let i = 1;
  let out = '';
  while (i < t.length) {
    const c = t[i];
    if (c === '\\') {
      const next = t[i + 1];
      switch (next) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        default: out += next ?? '';
      }
      i += 2;
      continue;
    }
    if (c === '"') {
      return out;
    }
    out += c;
    i++;
  }
  return out;
}

function evalConcat(
  expr: string,
  constants: Map<string, string>,
  unresolved: string[],
  depth: number
): string {
  const parts = splitTopLevel(expr, '+');
  let out = '';

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }

    if (part.startsWith('"')) {
      const s = readStringLiteral(part);
      if (s !== null) {
        out += s;
        continue;
      }
    }

    if (part.startsWith("'") && part.length >= 3) {
      out += part[1];
      continue;
    }

    if (IDENT_RE.test(part)) {
      const resolved = lookupConstant(part, constants, unresolved, depth);
      out += resolved;
      continue;
    }

    unresolved.push(part);
    out += `{${part}}`;
  }

  return out;
}

function lookupConstant(
  name: string,
  constants: Map<string, string>,
  unresolved: string[],
  depth: number
): string {
  if (depth > 3) {
    unresolved.push(name);
    return `{${name}}`;
  }

  const direct = constants.get(name);
  const lastSegment = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
  const value = direct ?? constants.get(lastSegment);

  if (value === undefined) {
    unresolved.push(name);
    return `{${name}}`;
  }

  return evalConcat(value, constants, unresolved, depth + 1);
}

/** 把注解参数值求值为字符串列表（数组会自动展开） */
export function evalStrings(
  expr: string | undefined,
  constants: Map<string, string>,
  unresolved: string[]
): string[] {
  if (expr === undefined || expr === null) {
    return [];
  }

  const text = expr.trim();
  if (!text) {
    return [];
  }

  if (text.startsWith('{') && text.endsWith('}')) {
    const inner = text.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return splitTopLevel(inner, ',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => evalConcat(p, constants, unresolved, 0));
  }

  return [evalConcat(text, constants, unresolved, 0)];
}

/** 取注解的路径类参数（value / path），支持裸值与显式赋值 */
export function mappingPaths(
  args: string | null,
  constants: Map<string, string>,
  unresolved: string[]
): string[] {
  const map = parseArgs(args);
  const expr = map.get('value') ?? map.get('path');
  return evalStrings(expr, constants, unresolved);
}

/** 取注解的字符串参数，例如 @XxlJob("name")、@ApiOperation(value="中文") */
export function stringArg(
  args: string | null,
  keys: string[],
  constants: Map<string, string>,
  unresolved: string[]
): string | undefined {
  if (!args) {
    return undefined;
  }
  const map = parseArgs(args);
  for (const key of keys) {
    const expr = map.get(key);
    if (expr !== undefined) {
      const values = evalStrings(expr, constants, unresolved);
      if (values.length > 0) {
        return values[0];
      }
    }
  }
  return undefined;
}
