export type ScanKind =
  | 'rest'
  | 'websocket'
  | 'xxljob'
  | 'mq'
  | 'scheduled'
  | 'mybatis'
  | 'netty'
  | string;

export interface AnnotationNode {
  /** 注解名，不含 @，例如 GetMapping */
  name: string;
  /** 括号内原始文本，无参数时为 null */
  args: string | null;
  /** 1 基行号 */
  line: number;
}

export interface MethodNode {
  name: string;
  line: number;
  annotations: AnnotationNode[];
}

export interface TypeNode {
  className: string;
  kind: string;
  line: number;
  annotations: AnnotationNode[];
  methods: MethodNode[];
  /** 类声明头部到 { 之间的文本，用于识别 extends BaseMapper */
  header: string;
}

export interface ParsedFile {
  masked: string;
  types: TypeNode[];
  constants: Map<string, string>;
}

export interface Endpoint {
  id: string;
  /** 扫描器归类，对应标签栏 */
  kind: ScanKind;
  /** 标签栏显示名，例如 REST / xxl-job */
  kindLabel: string;
  /** 主标识，例如 GET /audit/reverse 或 job:autoInspectionRoundJobHandler */
  name: string;
  path: string;
  httpMethod?: string;
  /** Swagger 中文描述 */
  description?: string;
  tags: string[];
  className: string;
  methodName: string;
  filePath: string;
  line: number;
  module: string;
  unresolved: string[];
  /** 预计算的小写检索串 */
  searchText: string;
}

export interface ScanContext {
  filePath: string;
  module: string;
  constants: Map<string, string>;
  parsed: ParsedFile;
  contextPath: string;
}

export interface ScannerConfig {
  id: string;
  label: string;
  includeGlobs: string[];
}

export interface CustomRule {
  id: string;
  label: string;
  type?: string;
  globs?: string[];
  pattern: string;
  flags?: string;
  nameGroup?: string;
  pathGroup?: string;
  descriptionGroup?: string;
}

export interface Scanner {
  id: string;
  label: string;
  /** 返回端点；ctx 中已包含解析结果，避免重复解析 */
  scan(ctx: ScanContext, options: Record<string, unknown>): Endpoint[];
}

export function makeSearchText(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}
