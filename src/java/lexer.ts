/**
 * 极简 Java 词法工具：
 * - maskComments：把注释内容替换为空格（保留换行与长度），供正则类扫描器安全匹配
 * - skipString / skipQuoted：跳过字符串、字符、文本块
 * - findMatching：括号配平
 */

export interface SkipResult {
  end: number;
  newlines: number;
}

export function skipQuoted(src: string, start: number): SkipResult {
  const quote = src[start];
  let i = start + 1;
  let newlines = 0;

  if (quote === '"' && src.startsWith('"""', start)) {
    i = start + 3;
    while (i < src.length) {
      if (src.startsWith('"""', i)) {
        return { end: i + 3, newlines };
      }
      if (src[i] === '\\') {
        i += 2;
        continue;
      }
      if (src[i] === '\n') {
        newlines++;
      }
      i++;
    }
    return { end: i, newlines };
  }

  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '\n') {
      // 普通字符串不跨行，遇到换行视为未闭合，直接退出避免吞掉整个文件
      newlines++;
      i++;
      break;
    }
    if (c === quote) {
      i++;
      break;
    }
    i++;
  }
  return { end: i, newlines };
}

export function maskComments(src: string): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    if (c === '"' || c === "'") {
      const r = skipQuoted(src, i);
      i = r.end;
      continue;
    }

    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }

    if (c === '/' && src[i + 1] === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') {
          out[i] = ' ';
        }
        i++;
      }
      if (i < n) {
        out[i] = ' ';
        if (i + 1 < n) {
          out[i + 1] = ' ';
        }
        i += 2;
      }
      continue;
    }

    i++;
  }

  return out.join('');
}

export function findMatching(src: string, openIdx: number): number {
  const open = src[openIdx];
  const close = open === '(' ? ')' : open === '{' ? '}' : open === '[' ? ']' : '';
  if (!close) {
    return openIdx;
  }

  let depth = 0;
  let i = openIdx;

  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const r = skipQuoted(src, i);
      i = r.end;
      continue;
    }
    if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }

  return src.length - 1;
}

export function countNewlines(src: string, from: number, to: number): number {
  let count = 0;
  for (let i = from; i < to; i++) {
    if (src[i] === '\n') {
      count++;
    }
  }
  return count;
}
