import { Endpoint } from '../model';

export interface ParsedQuery {
  raw: string;
  mode: 'regex' | 'text';
  regex?: RegExp;
  terms: string[];
  caseSensitive: boolean;
}

export function parseQuery(raw: string, regexFlag: boolean, caseSensitive: boolean): ParsedQuery {
  const trimmed = raw.trim();
  const explicit = trimmed.toLowerCase().startsWith('re:');
  const body = explicit ? trimmed.slice(3) : trimmed;

  if (regexFlag || explicit) {
    if (!body) {
      return { raw: trimmed, mode: 'regex', regex: undefined, terms: [], caseSensitive };
    }
    try {
      const flags = caseSensitive ? '' : 'i';
      return {
        raw: trimmed,
        mode: 'regex',
        regex: new RegExp(body, flags),
        terms: [],
        caseSensitive
      };
    } catch (err) {
      throw new Error(`正则表达式无效：${(err as Error).message}`);
    }
  }

  const terms = trimmed
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => (caseSensitive ? t : t.toLowerCase()));

  return { raw: trimmed, mode: 'text', terms, caseSensitive };
}

const ASCII_WORD = /^[A-Za-z0-9_]+$/;

function wordHit(text: string, term: string): boolean {
  if (ASCII_WORD.test(term)) {
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return re.test(text);
  }
  return text.toLowerCase().includes(term.toLowerCase());
}

function segmentPrefix(path: string, term: string): boolean {
  const p = path.toLowerCase();
  const t = term.toLowerCase();
  if (p === t || p.replace(/^\//, '') === t.replace(/^\//, '')) {
    return true;
  }
  return p.split('/').some((seg) => seg.length > 0 && seg.startsWith(t.replace(/^\//, '')));
}

function fuzzyScore(text: string, term: string): number {
  let best = 0;

  for (const segment of text.split(/[/\s._-]+/)) {
    if (!segment || segment.length < term.length) {
      continue;
    }

    let cursor = 0;
    let first = -1;
    let last = -1;
    let matched = true;

    for (const ch of term) {
      const idx = segment.indexOf(ch, cursor);
      if (idx < 0) {
        matched = false;
        break;
      }
      if (first < 0) {
        first = idx;
      }
      last = idx;
      cursor = idx + 1;
    }

    if (!matched) {
      continue;
    }

    const span = last - first + 1;
    const score = Math.round(40 + (term.length / span) * 160);
    if (score > best) {
      best = score;
    }
  }

  return best;
}

function tierScore(ep: Endpoint, term: string): number {
  const path = ep.path.toLowerCase();
  const t = term.toLowerCase();

  const barePath = path.replace(/^\//, '');
  const bareTerm = t.replace(/^\//, '');

  if (barePath === bareTerm) {
    return 900;
  }
  if (segmentPrefix(path, t)) {
    return 800;
  }
  if (wordHit(path, t) || (ep.description && wordHit(ep.description, t))) {
    return 700;
  }
  if (path.includes(t)) {
    return 600;
  }
  if (ep.description && ep.description.toLowerCase().includes(t)) {
    return 550;
  }
  if (
    ep.className.toLowerCase().includes(t) ||
    ep.methodName.toLowerCase().includes(t) ||
    ep.tags.some((tag) => tag.toLowerCase().includes(t))
  ) {
    return 400;
  }
  if (t.length < 3) {
    return 0;
  }
  return fuzzyScore(`${path} ${ep.methodName.toLowerCase()}`.trim(), t);
}

export function scoreEndpoint(ep: Endpoint, query: ParsedQuery): number {
  if (query.mode === 'regex') {
    if (!query.regex) {
      return 0;
    }
    const fields = [
      ep.path,
      ep.description ?? '',
      `${ep.className}.${ep.methodName}`,
      ep.tags.join(' ')
    ];
    const re = query.regex;
    for (const field of fields) {
      re.lastIndex = 0;
      if (re.test(field)) {
        return 1000;
      }
    }
    return 0;
  }

  if (query.terms.length === 0) {
    return 1;
  }

  let total = 0;
  for (const term of query.terms) {
    const score = tierScore(ep, term);
    if (score <= 0) {
      return 0;
    }
    total += score;
  }
  return total;
}

const TYPE_ORDER: Record<string, number> = {
  rest: 0,
  websocket: 1,
  xxljob: 2,
  mq: 3,
  scheduled: 4,
  mybatis: 5
};

export function rankEndpoints(
  endpoints: Endpoint[],
  query: ParsedQuery,
  kindFilter: string | null,
  limit = 500
): { items: Endpoint[]; total: number } {
  const scored: Array<{ ep: Endpoint; score: number }> = [];

  for (const ep of endpoints) {
    if (kindFilter && ep.kind !== kindFilter) {
      continue;
    }
    const score = scoreEndpoint(ep, query);
    if (score > 0) {
      scored.push({ ep, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const ta = TYPE_ORDER[a.ep.kind] ?? 9;
    const tb = TYPE_ORDER[b.ep.kind] ?? 9;
    if (ta !== tb) {
      return ta - tb;
    }
    if (a.ep.path.length !== b.ep.path.length) {
      return a.ep.path.length - b.ep.path.length;
    }
    if (a.ep.filePath !== b.ep.filePath) {
      return a.ep.filePath < b.ep.filePath ? -1 : 1;
    }
    return a.ep.line - b.ep.line;
  });

  return {
    items: scored.slice(0, limit).map((s) => s.ep),
    total: scored.length
  };
}
