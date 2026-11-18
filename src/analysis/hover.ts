import { AnnotationNode, ParsedFile } from '../model';

export interface HoverTarget {
  className: string;
  methodName: string;
  methodLine: number;
  annotation: AnnotationNode;
}

/**
 * 找出指定行上的方法注解，用于悬浮预览。
 */
export function findHoverTargets(parsed: ParsedFile, line: number): HoverTarget[] {
  const targets: HoverTarget[] = [];
  for (const type of parsed.types) {
    for (const method of type.methods) {
      for (const annotation of method.annotations) {
        if (annotation.line === line) {
          targets.push({
            className: type.className,
            methodName: method.name,
            methodLine: method.line,
            annotation
          });
        }
      }
    }
  }
  return targets;
}
