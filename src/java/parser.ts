import { AnnotationNode, MethodNode, ParsedFile, TypeNode } from '../model';
import { countNewlines, findMatching, maskComments, skipQuoted } from './lexer';

interface ClassScope {
  node: TypeNode;
  declDepth: number;
  bodyDepth: number;
}

const NOT_METHOD_WORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'new',
  'throw', 'assert', 'this', 'super', 'do', 'else', 'try', 'record', 'class',
  'interface', 'enum', 'yield', 'case', 'default', 'instanceof'
]);

const TYPE_KEYWORDS = new Set(['class', 'interface', 'enum', 'record']);

function isWs(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r' || c === '\f';
}

function isIdentStart(c: string): boolean {
  return /[A-Za-z_$]/.test(c);
}

function isIdentPart(c: string): boolean {
  return /[\w$]/.test(c);
}

function statementStart(src: string, idx: number): number {
  let j = idx - 1;
  while (j >= 0) {
    const c = src[j];
    if (c === ';' || c === '{' || c === '}') {
      break;
    }
    j--;
  }
  return j + 1;
}

function hasTopLevelAssign(src: string, from: number, to: number): boolean {
  let round = 0;
  let curly = 0;
  let square = 0;
  let i = from;

  while (i < to) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i = skipQuoted(src, i).end;
      continue;
    }
    if (c === '(') round++;
    else if (c === ')') round--;
    else if (c === '{') curly++;
    else if (c === '}') curly--;
    else if (c === '[') square++;
    else if (c === ']') square--;

    if (c === '=' && round === 0 && curly === 0 && square === 0) {
      const prev = src[i - 1];
      const next = src[i + 1];
      if (prev !== '=' && prev !== '!' && prev !== '<' && prev !== '>' && next !== '=') {
        return true;
      }
    }
    i++;
  }

  return false;
}

interface MemberNameResult {
  name: string;
  nameStart: number;
}

function detectMemberName(src: string, openParen: number): MemberNameResult | null {
  let j = openParen - 1;
  while (j >= 0 && isWs(src[j])) j--;
  if (j < 0 || !isIdentPart(src[j])) {
    return null;
  }

  const nameEnd = j + 1;
  while (j >= 0 && isIdentPart(src[j])) j--;
  const name = src.slice(j + 1, nameEnd);

  if (!name || NOT_METHOD_WORDS.has(name)) {
    return null;
  }

  let p = j;
  while (p >= 0 && isWs(src[p])) p--;
  if (p < 0) {
    return { name, nameStart: j + 1 };
  }

  const prev = src[p];
  if (prev === '.' || prev === '@' || prev === ',') {
    return null;
  }

  if (isIdentPart(prev)) {
    let k = p;
    while (k >= 0 && isIdentPart(src[k])) k--;
    const prevWord = src.slice(k + 1, p + 1);
    if (prevWord === 'new' || TYPE_KEYWORDS.has(prevWord)) {
      return null;
    }
  }

  return { name, nameStart: j + 1 };
}

function isDeclarationTail(src: string, closeParen: number): boolean {
  let k = closeParen + 1;
  while (k < src.length && /\s/.test(src[k])) k++;
  const c = src[k];
  if (c === '{' || c === ';') {
    return true;
  }
  return src.startsWith('throws', k);
}

export function parseJava(source: string): ParsedFile {
  const masked = maskComments(source);
  const src = masked;
  const n = src.length;

  const types: TypeNode[] = [];
  const stack: ClassScope[] = [];
  const pendingByDepth = new Map<number, AnnotationNode[]>();

  let i = 0;
  let line = 1;
  let depth = 0;

  const takePending = (d: number): AnnotationNode[] => {
    const arr = pendingByDepth.get(d);
    pendingByDepth.set(d, []);
    return arr ? arr.slice() : [];
  };

  const pushPending = (d: number, node: AnnotationNode): void => {
    const arr = pendingByDepth.get(d);
    if (arr) {
      arr.push(node);
    } else {
      pendingByDepth.set(d, [node]);
    }
  };

  while (i < n) {
    const c = src[i];

    if (c === '\n') {
      line++;
      i++;
      continue;
    }

    if (isWs(c)) {
      i++;
      continue;
    }

    if (c === '"' || c === "'") {
      const r = skipQuoted(src, i);
      line += r.newlines;
      i = r.end;
      continue;
    }

    if (c === '@') {
      const startLine = line;
      i++;
      let name = '';
      while (i < n && isIdentPart(src[i])) {
        name += src[i];
        i++;
      }

      let args: string | null = null;
      let k = i;
      while (k < n && /\s/.test(src[k])) {
        if (src[k] === '\n') line++;
        k++;
      }

      if (src[k] === '(') {
        const close = findMatching(src, k);
        args = src.slice(k + 1, close);
        line += countNewlines(src, k, close);
        i = close + 1;
      } else {
        i = k;
      }

      if (name && name !== 'interface') {
        pushPending(depth, { name, args, line: startLine });
      }
      continue;
    }

    if (c === '{') {
      depth++;
      i++;
      continue;
    }

    if (c === '}') {
      depth--;
      while (stack.length > 0 && stack[stack.length - 1].bodyDepth > depth) {
        stack.pop();
      }
      i++;
      continue;
    }

    if (c === ';') {
      const top = stack[stack.length - 1];
      if (top && depth === top.bodyDepth) {
        pendingByDepth.set(depth, []);
      }
      i++;
      continue;
    }

    if (c === '(') {
      const top = stack[stack.length - 1];
      const close = findMatching(src, i);

      if (top && depth === top.bodyDepth) {
        const member = detectMemberName(src, i);
        if (member) {
          const start = statementStart(src, member.nameStart);
          const isInitializer = hasTopLevelAssign(src, start, member.nameStart);
          const isDecl = !isInitializer && isDeclarationTail(src, close);
          if (isDecl) {
            const annotations = takePending(depth);
            top.node.methods.push({
              name: member.name,
              line,
              annotations
            });
          }
        }
      }

      line += countNewlines(src, i, close);
      i = close + 1;
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      while (i < n && isIdentPart(src[i])) i++;
      const word = src.slice(start, i);

      if (TYPE_KEYWORDS.has(word)) {
        let k = i;
        while (k < n && /\s/.test(src[k])) {
          if (src[k] === '\n') line++;
          k++;
        }
        const nameStart = k;
        while (k < n && isIdentPart(src[k])) k++;
        const className = src.slice(nameStart, k);

        if (className) {
          const brace = src.indexOf('{', k);
          const headerEnd = brace >= 0 ? Math.min(brace, k + 500) : Math.min(n, k + 500);
          const header = src.slice(k, headerEnd);
          const node: TypeNode = {
            className,
            kind: word,
            line,
            annotations: takePending(depth),
            methods: [],
            header
          };
          types.push(node);
          stack.push({ node, declDepth: depth, bodyDepth: depth + 1 });
          i = k;
          continue;
        }
      }

      continue;
    }

    i++;
  }

  const constants = new Map<string, string>();
  const constRe = /\b(?:(?:static\s+final)|(?:final\s+static))\s+String\s+(\w+)\s*=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = constRe.exec(src)) !== null) {
    constants.set(m[1], m[2].trim());
  }

  return { masked, types, constants };
}

export function findAnnotation(
  annotations: AnnotationNode[],
  names: string[]
): AnnotationNode | undefined {
  return annotations.find((a) => names.includes(a.name));
}
