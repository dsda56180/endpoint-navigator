import { AnnotationNode, ParsedFile } from '../model';

export interface HoverTarget {
  className: string;
  methodName: string;
  methodLine: number;
  annotation: AnnotationNode;
}

export interface ClassHoverTarget {
  className: string;
  annotations: AnnotationNode[];
}

/**
 * 找出指定行所属方法的注解。覆盖注解本身、跨行注解参数以及方法声明行，
 * 因此在 @GetMapping、路径字符串或方法名上悬浮都能命中。
 */
export function findHoverTargets(parsed: ParsedFile, line: number): HoverTarget[] {
  const targets: HoverTarget[] = [];
  for (const type of parsed.types) {
    for (const method of type.methods) {
      for (const annotation of method.annotations) {
        if (line >= annotation.line && line <= method.line) {
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

/**
 * 找出指定行所属类型的类级注解，用于类级 @RequestMapping 悬浮。
 */
export function findClassHoverTarget(
  parsed: ParsedFile,
  line: number
): ClassHoverTarget | undefined {
  for (const type of parsed.types) {
    for (const annotation of type.annotations) {
      if (line >= annotation.line && line <= type.line) {
        return { className: type.className, annotations: type.annotations };
      }
    }
  }
  return undefined;
}
