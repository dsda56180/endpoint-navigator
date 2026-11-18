import { findAnnotation } from '../java/parser';
import { stringArg } from '../java/expr';
import { Endpoint, ScanContext, Scanner, makeSearchText } from '../model';

export const xxljobScanner: Scanner = {
  id: 'xxljob',
  label: 'xxl-job',
  scan(ctx: ScanContext): Endpoint[] {
    const endpoints: Endpoint[] = [];

    for (const type of ctx.parsed.types) {
      for (const method of type.methods) {
        const ann = findAnnotation(method.annotations, ['XxlJob']);
        if (!ann) {
          continue;
        }
        const unresolved: string[] = [];
        const handlerName =
          stringArg(ann.args, ['value'], ctx.constants, unresolved) ?? method.name;

        endpoints.push({
          id: `${ctx.filePath}#${method.line}#xxljob#${handlerName}`,
          kind: 'xxljob',
          kindLabel: 'xxl-job',
          name: `job:${handlerName}`,
          path: handlerName,
          description: `定时任务 ${handlerName}`,
          tags: [],
          className: type.className,
          methodName: method.name,
          filePath: ctx.filePath,
          line: method.line,
          module: ctx.module,
          unresolved,
          searchText: makeSearchText([handlerName, type.className, method.name])
        });
      }
    }

    return endpoints;
  }
};
