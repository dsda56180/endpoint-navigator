import { Endpoint, makeSearchText } from '../model';

function stripComment(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return trimmed;
  }
  const idx = trimmed.indexOf('#');
  return idx >= 0 ? trimmed.slice(0, idx).trim() : trimmed;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/** 解析 application.properties 的 key=value */
export function parseProperties(text: string, out: Map<string, string>): void {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    const match = /^([^=:\s][^=:]*?)\s*[=:]\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    out.set(match[1].trim(), unquote(match[2]));
  }
}

/** 解析 application.yml，按键缩进展开为 a.b.c 形式 */
export function parseYaml(text: string, out: Map<string, string>): void {
  const stack: Array<{ indent: number; key: string }> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#') || rawLine.trim() === '---') {
      continue;
    }
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();
    const match = /^(-?\s*[\w.$-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const key = match[1].trim();
    const value = stripComment(match[2]);

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (value.length === 0) {
      stack.push({ indent, key });
      continue;
    }

    const prefix = stack.map((s) => s.key).join('.');
    out.set(prefix ? `${prefix}.${key}` : key, unquote(value));
  }
}

/** 解析单个配置文件；根据扩展名选择解析器 */
export function parseConfigFile(fileName: string, text: string, out: Map<string, string>): void {
  if (/\.properties$/i.test(fileName)) {
    parseProperties(text, out);
  } else {
    parseYaml(text, out);
  }
}

/** 把 ${key:default} 替换为配置值 */
export function resolvePlaceholders(
  value: string,
  config: Map<string, string>,
  missing?: string[]
): string {
  if (!value.includes('${')) {
    return value;
  }
  return value.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (whole, rawKey: string, def: string | undefined) => {
    const key = rawKey.trim();
    const found = config.get(key);
    if (found !== undefined) {
      return found;
    }
    if (def !== undefined && def.length > 0) {
      return def;
    }
    missing?.push(key);
    return whole;
  });
}

/** 抽取 @Value("${key}") 注入的字段名，便于解析 apiUrl + "/path" 这类拼接 */
export function buildValueFields(
  text: string,
  config: Map<string, string>
): Map<string, string> {
  const fields = new Map<string, string>();
  const re =
    /@Value\s*\(\s*("(?:\\.|[^"\\])*")\s*\)[\s\S]{0,160}?\bString\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const literal = unquote(match[1]);
    // 常量表存的是 Java 表达式，这里保持带引号的形式，供 evalConcat 识别为字符串字面量
    fields.set(match[2], JSON.stringify(resolvePlaceholders(literal, config)));
  }
  return fields;
}

/** 用应用配置解析已生成端点中的 ${...} 占位符 */
export function applyConfig(ep: Endpoint, config: Map<string, string>): Endpoint {
  if (config.size === 0 || !`${ep.path} ${ep.name}`.includes('${')) {
    return ep;
  }
  const missing: string[] = [];
  const resolve = (value: string): string => resolvePlaceholders(value, config, missing);
  const path = resolve(ep.path);
  const name = resolve(ep.name);
  const description = ep.description ? resolve(ep.description) : undefined;
  const unresolved = Array.from(new Set([...ep.unresolved, ...missing]));
  return {
    ...ep,
    path,
    name,
    description,
    unresolved,
    searchText: makeSearchText([
      path,
      name,
      description,
      ep.className,
      ep.methodName,
      ep.tags.join(' '),
      ep.httpMethod
    ])
  };
}
