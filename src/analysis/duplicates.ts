import { Endpoint } from '../model';

export interface DuplicateGroup {
  /** 形如 POST /audit/reverse */
  key: string;
  endpoints: Endpoint[];
}

function normalizePath(raw: string): string {
  let path = (raw || '').trim();
  if (!path) {
    return '';
  }
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  if (path.length > 1) {
    path = path.replace(/\/+$/, '');
  }
  return path;
}

/**
 * 找出同 method + 同 path 的 REST 映射。这类冲突在 Spring 启动时会直接失败，
 * 或由后注册的映射覆盖先注册的。
 */
export function findDuplicates(endpoints: Endpoint[]): DuplicateGroup[] {
  const map = new Map<string, Endpoint[]>();

  for (const ep of endpoints) {
    if (ep.kind !== 'rest' || !ep.httpMethod) {
      continue;
    }
    const method = ep.httpMethod.toUpperCase();
    if (method === 'ALL' || method === 'REQUEST') {
      continue;
    }
    const path = normalizePath(ep.path);
    if (!path) {
      continue;
    }
    const key = `${method} ${path}`;
    const existing = map.get(key);
    if (existing) {
      existing.push(ep);
    } else {
      map.set(key, [ep]);
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, eps] of map.entries()) {
    if (eps.length > 1) {
      groups.push({ key, endpoints: eps });
    }
  }

  groups.sort((a, b) => {
    if (b.endpoints.length !== a.endpoints.length) {
      return b.endpoints.length - a.endpoints.length;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return groups;
}
