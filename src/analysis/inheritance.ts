import { AnnotationNode, ParsedFile } from '../model';

export interface IfaceMethod {
  name: string;
  annotations: AnnotationNode[];
}

export interface IfaceInfo {
  name: string;
  methods: IfaceMethod[];
}

export const MAPPING_ANNOTATIONS = new Set([
  'RequestMapping',
  'GetMapping',
  'PostMapping',
  'PutMapping',
  'DeleteMapping',
  'PatchMapping'
]);

export function implementsList(header: string): string[] {
  const match = /\bimplements\s+([^{]+)/.exec(header);
  if (!match) {
    return [];
  }
  return match[1]
    .split(',')
    .map((part) => part.trim().split('<')[0].trim())
    .filter((name) => name.length > 0);
}

/** 收集文件中声明了映射注解的接口方法，供其他文件继承 */
export function ifacesOf(parsed: ParsedFile): IfaceInfo[] {
  return parsed.types
    .filter((type) => type.kind === 'interface')
    .map((type) => ({
      name: type.className,
      methods: type.methods
        .filter((method) =>
          method.annotations.some((ann) => MAPPING_ANNOTATIONS.has(ann.name))
        )
        .map((method) => ({ name: method.name, annotations: method.annotations }))
    }))
    .filter((iface) => iface.methods.length > 0);
}

/**
 * 当实现类方法自身没有映射注解、且其实现的接口同名方法带映射注解时，
 * 把接口上的注解复制到实现类方法，行号改为实现类方法所在行。
 */
export function applyInheritance(
  parsed: ParsedFile,
  registry: Map<string, Map<string, AnnotationNode[]>>
): void {
  if (registry.size === 0) {
    return;
  }

  for (const type of parsed.types) {
    const ifaces = implementsList(type.header);
    if (ifaces.length === 0) {
      continue;
    }

    for (const method of type.methods) {
      if (method.annotations.some((ann) => MAPPING_ANNOTATIONS.has(ann.name))) {
        continue;
      }
      for (const ifaceName of ifaces) {
        const inherited = registry.get(ifaceName)?.get(method.name);
        if (inherited && inherited.length > 0) {
          method.annotations = [
            ...inherited.map((ann) => ({ ...ann, line: method.line })),
            ...method.annotations
          ];
          break;
        }
      }
    }
  }
}
