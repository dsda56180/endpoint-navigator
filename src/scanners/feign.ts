import { findAnnotation } from '../java/parser';
import { mappingPaths, stringArg } from '../java/expr';
import { Endpoint, ScanContext, Scanner, makeSearchText } from '../model';
import {
  MAPPING_METHOD,
  collectTags,
  descriptionOf,
  httpMethodsOf,
  normalizePath
} from './rest';

const MAX_EXPAND = 20;

/**
 * OpenFeign 客户端接口：@FeignClient + @GetMapping 等映射注解。
 * 路径不拼接本地 contextPath，标签优先使用 Swagger 标签，其次使用服务名。
 */
export const feignScanner: Scanner = {
  id: 'feign',
  label: 'Feign',
  scan(ctx: ScanContext): Endpoint[] {
    const endpoints: Endpoint[] = [];
    const { constants, parsed } = ctx;

    for (const type of parsed.types) {
      const feign = findAnnotation(type.annotations, ['FeignClient']);
      if (!feign) {
        continue;
      }

      const classUnresolved: string[] = [];
      const clientName =
        stringArg(feign.args, ['name', 'value'], constants, classUnresolved) ?? type.className;
      const basePath =
        stringArg(feign.args, ['path'], constants, classUnresolved) ?? '';
      const url = stringArg(feign.args, ['url'], constants, classUnresolved) ?? '';

      const classMapping = findAnnotation(type.annotations, ['RequestMapping']);
      const classPaths = classMapping
        ? mappingPaths(classMapping.args, constants, classUnresolved)
        : [''];
      const prefixes = (classPaths.length > 0 ? classPaths : ['']).map((p) =>
        normalizePath(basePath, p)
      );

      const swaggerTags = collectTags(type.annotations, constants, classUnresolved);
      const tags = swaggerTags.length > 0 ? swaggerTags : [clientName];

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
              const fullPath = normalizePath(prefix, methodPath);
              endpoints.push({
                id: `${ctx.filePath}#${method.line}#feign#${httpMethod}#${fullPath}`,
                kind: 'feign',
                kindLabel: 'Feign',
                direction: 'out',
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
                  clientName,
                  url,
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
