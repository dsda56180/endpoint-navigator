import { findAnnotation } from '../java/parser';
import { Endpoint, ScanContext, Scanner, makeSearchText } from '../model';

export const mybatisScanner: Scanner = {
  id: 'mybatis',
  label: 'Mapper',
  scan(ctx: ScanContext): Endpoint[] {
    const endpoints: Endpoint[] = [];

    for (const type of ctx.parsed.types) {
      const hasMapperAnnotation = !!findAnnotation(type.annotations, ['Mapper']);
      const extendsBase = /extends\s+[\w$.]*(?:BaseMapper|Mapper)\b/.test(type.header);
      if (!hasMapperAnnotation && !extendsBase) {
        continue;
      }

      for (const method of type.methods) {
        endpoints.push({
          id: `${ctx.filePath}#${method.line}#mybatis#${type.className}.${method.name}`,
          kind: 'mybatis',
          kindLabel: 'Mapper',
          name: `${type.className}.${method.name}`,
          path: `${type.className}.${method.name}`,
          description: 'MyBatis Mapper 方法',
          tags: [],
          className: type.className,
          methodName: method.name,
          filePath: ctx.filePath,
          line: method.line,
          module: ctx.module,
          unresolved: [],
          searchText: makeSearchText([type.className, method.name, 'mybatis mapper'])
        });
      }
    }

    return endpoints;
  }
};
