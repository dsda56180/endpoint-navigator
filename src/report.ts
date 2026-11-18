import { Endpoint } from './model';

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function toMarkdown(
  endpoints: Endpoint[],
  relativePath: (filePath: string) => string
): string {
  const lines = [
    '| 类型 | 方法 | 路径 | 描述 | 类.方法 | 位置 |',
    '| --- | --- | --- | --- | --- | --- |'
  ];
  for (const ep of endpoints) {
    const cells = [
      escapeCell(ep.kindLabel),
      escapeCell(ep.httpMethod ?? ''),
      escapeCell(ep.path || ep.name),
      escapeCell(ep.description ?? ''),
      escapeCell(`${ep.className}.${ep.methodName}`),
      escapeCell(`${relativePath(ep.filePath)}:${ep.line}`)
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

export function toJson(
  endpoints: Endpoint[],
  relativePath: (filePath: string) => string
): string {
  return JSON.stringify(
    endpoints.map((ep) => ({
      kind: ep.kind,
      method: ep.httpMethod ?? '',
      path: ep.path,
      name: ep.name,
      description: ep.description ?? '',
      className: ep.className,
      methodName: ep.methodName,
      file: relativePath(ep.filePath),
      line: ep.line,
      module: ep.module
    })),
    null,
    2
  );
}
