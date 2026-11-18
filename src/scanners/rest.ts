import { findAnnotation } from '../java/parser';
import { evalStrings, mappingPaths, parseArgs, splitTopLevel, stringArg } from '../java/expr';
import { Endpoint, ScanContext, Scanner, makeSearchText } from '../model';

const MAPPING_METHOD: Record<string, string> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
  RequestMapping: 'ALL'
};

const MAX_EXPAND = 20;

export function normalizePath(...segments: string[]): string {
  const joined = segments
    .filter((s) => s !== undefined && s !== null)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('/');
  if (!joined) {
    return '/';
  }
  const withLeading = joined.startsWith('/') ? joined : `/${joined}`;
  return withLeading.replace(/\/{2,}/g, '/');
}

function httpMethodsOf(args: string | null): string[] {
  const map = parseArgs(args);
  const expr = map.get('method');
  if (!expr) {
    return ['ALL'];
  }
  const cleaned = expr
    .replace(/\bRequestMethod\s*\.\s*/g, '')
    .replace(/[{}]/g, '');
  const methods = splitTopLevel(cleaned, ',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  return methods.length > 0 ? methods : ['ALL'];
}

function collectTags(
  annotations: ScanContext['parsed']['types'][number]['annotations'],
  constants: Map<string, string>,
  unresolved: string[]
): string[] {
  const tags: string[] = [];
  for (const ann of annotations) {
    if (ann.name === 'Api' || ann.name === 'Tag') {
      const argMap = parseArgs(ann.args);
      for (const key of ['tags', 'name']) {
        const expr = argMap.get(key);
        if (expr) {
          for (const value of evalStrings(expr, constants, unresolved)) {
            for (const piece of value.split(/[,，]/)) {
              const t = piece.trim();
              if (t) {
                tags.push(t);
              }
            }
          }
          if (tags.length > 0) {
            return tags;
          }
        }
      }
    }
  }
  return tags;
}

function descriptionOf(
  annotations: ScanContext['parsed']['types'][number]['annotations'],
  constants: Map<string, string>,
  unresolved: string[]
): string | undefined {
  const api = findAnnotation(annotations, ['ApiOperation', 'Operation']);
  if (!api) {
    return undefined;
  }
  return stringArg(api.args, ['value', 'summary', 'notes', 'description'], constants, unresolved);
}

export const restScanner: Scanner = {
  id: 'rest',
  label: 'REST',
  scan(ctx: ScanContext): Endpoint[] {
    const endpoints: Endpoint[] = [];
    const { constants, parsed } = ctx;

    for (const type of parsed.types) {
      if (!findAnnotation(type.annotations, ['RestController', 'Controller'])) {
        continue;
      }

      const classUnresolved: string[] = [];
      const classMapping = findAnnotation(type.annotations, ['RequestMapping']);
      const classPaths = classMapping
        ? mappingPaths(classMapping.args, constants, classUnresolved)
        : [];
      const prefixes = classPaths.length > 0 ? classPaths : [''];
      const tags = collectTags(type.annotations, constants, classUnresolved);

      for (const method of type.methods) {
        const mapping = method.annotations.find((a) => a.name in MAPPING_METHOD);
        if (!mapping) {
          continue;
        }

        const unresolved = classUnresolved.slice();
        const httpMethods =
          mapping.name === 'RequestMapping'
            ? httpMethodsOf(mapping.args)
            : [MAPPING_METHOD[mapping.name]];
        const methodPaths = mappingPaths(mapping.args, constants, unresolved);
        const paths = methodPaths.length > 0 ? methodPaths : [''];
        const description = descriptionOf(method.annotations, constants, unresolved);

        let produced = 0;
        for (const prefix of prefixes) {
          for (const methodPath of paths) {
            for (const httpMethod of httpMethods) {
              if (produced >= MAX_EXPAND) {
                break;
              }
              const fullPath = normalizePath(ctx.contextPath, prefix, methodPath);
              endpoints.push({
                id: `${ctx.filePath}#${method.line}#rest#${httpMethod}#${fullPath}`,
                kind: 'rest',
                kindLabel: 'REST',
                name: `${httpMethod} ${fullPath}`,
                path: fullPath,
                httpMethod,
                description,
                tags,
                className: type.className,
                methodName: method.name,
                filePath: ctx.filePath,
                line: method.line,
                module: ctx.module,
                unresolved,
                searchText: makeSearchText([
                  fullPath,
                  description,
                  type.className,
                  method.name,
                  tags.join(' '),
                  httpMethod
                ])
              });
              produced++;
            }
          }
        }
      }
    }

    return endpoints;
  }
};
