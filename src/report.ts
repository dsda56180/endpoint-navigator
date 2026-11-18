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

const OPENAPI_HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS',
  'TRACE'
]);

function sanitizeOperationId(value: string): string {
  return value.replace(/[^\w]+/g, '_');
}

export interface OpenApiOptions {
  title?: string;
  version?: string;
  serverUrl?: string;
}

/**
 * 生成 OpenAPI 3.0 文档，可直接导入 Postman / Apifox / Insomnia / Swagger UI。
 * 仅包含 REST 接口；请求体与 query 参数无法从注解推导，因此只生成路径参数。
 */
export function toOpenApi(
  endpoints: Endpoint[],
  relativePath: (filePath: string) => string,
  options: OpenApiOptions = {}
): string {
  const paths: Record<string, Record<string, unknown>> = {};
  const tagOrder: string[] = [];
  const usedIds = new Map<string, number>();
  let count = 0;

  for (const ep of endpoints) {
    if (ep.kind !== 'rest' || !ep.path.startsWith('/')) {
      continue;
    }
    const verb = (ep.httpMethod ?? 'GET').toUpperCase();
    if (!OPENAPI_HTTP_METHODS.has(verb)) {
      continue;
    }
    const method = verb.toLowerCase();
    const tag = ep.module || ep.kindLabel || 'REST';
    if (!tagOrder.includes(tag)) {
      tagOrder.push(tag);
    }

    const baseId = sanitizeOperationId(`${ep.className}_${ep.methodName}`);
    const seen = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, seen + 1);
    const operationId = seen === 0 ? baseId : `${baseId}_${seen + 1}`;

    const operation: Record<string, unknown> = {
      tags: [tag],
      summary: ep.description || ep.name || ep.path,
      operationId,
      responses: {
        '200': {
          description: 'OK'
        }
      },
      'x-endpoint-navigator': {
        class: ep.className,
        method: ep.methodName,
        file: relativePath(ep.filePath),
        line: ep.line
      }
    };
    if (ep.description) {
      operation.description = ep.description;
    }

    const parameters: Array<Record<string, unknown>> = [];
    const seenParams = new Set<string>();
    for (const match of ep.path.matchAll(/\{([^}]+)\}/g)) {
      const name = match[1].trim();
      if (!name || seenParams.has(name)) {
        continue;
      }
      seenParams.add(name);
      parameters.push({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' }
      });
    }
    if (parameters.length > 0) {
      operation.parameters = parameters;
    }

    const pathItem = paths[ep.path] ?? (paths[ep.path] = {});
    const existing = pathItem[method] as Record<string, unknown> | undefined;
    if (existing) {
      const marker = existing['x-endpoint-navigator'] as Record<string, unknown>;
      const conflicts = (marker.conflicts as string[] | undefined) ?? [];
      conflicts.push(`${ep.className}#${ep.methodName}`);
      marker.conflicts = conflicts;
      continue;
    }
    pathItem[method] = operation;
    count++;
  }

  const document = {
    openapi: '3.0.3',
    info: {
      title: options.title ?? 'Endpoint Navigator 接口清单',
      version: options.version ?? '1.0.0',
      description: `由 Endpoint Navigator 导出，共 ${count} 个 REST 接口。`
    },
    servers: [{ url: options.serverUrl ?? 'http://localhost:8080' }],
    tags: tagOrder.map((name) => ({ name })),
    paths
  };

  return JSON.stringify(document, null, 2);
}

