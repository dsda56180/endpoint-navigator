import { Endpoint } from '../model';

export function stringLiteral(value: string): string | undefined {
  const trimmed = value.trim();
  const double = /^"([^"]*)"$/.exec(trimmed);
  if (double) {
    return double[1];
  }
  const single = /^'([^']*)'$/.exec(trimmed);
  return single ? single[1] : undefined;
}

/**
 * 用跨文件收集到的常量替换路径中的 {表达式} 占位符。
 * 仅在表达式可唯一解析时替换，剩余未解析项保留在 unresolved。
 */
export function applyConstants(
  ep: Endpoint,
  constants: Map<string, string>
): Endpoint {
  if (ep.unresolved.length === 0 || constants.size === 0) {
    return ep;
  }

  let path = ep.path;
  let name = ep.name;
  const left: string[] = [];

  for (const expr of ep.unresolved) {
    let value = constants.get(expr);
    if (value === undefined && expr.includes('.')) {
      value = constants.get(expr.slice(expr.lastIndexOf('.') + 1));
    }
    if (value === undefined) {
      left.push(expr);
      continue;
    }
    const token = `{${expr}}`;
    path = path.split(token).join(value);
    name = name.split(token).join(value);
  }

  if (left.length === ep.unresolved.length) {
    return ep;
  }
  return { ...ep, path, name, unresolved: left };
}
