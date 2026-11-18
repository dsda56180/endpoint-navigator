import { CustomRule, Endpoint, ScanContext, Scanner, makeSearchText } from '../model';
import { buildLineIndex, globToRegExp, lineAt } from '../util';

function pick(match: RegExpExecArray, group: string | undefined, fallbackIndex: number): string {
  if (group && match.groups && match.groups[group] !== undefined) {
    return match.groups[group];
  }
  return match[fallbackIndex] ?? '';
}

export const regexRuleScanner: Scanner = {
  id: 'regexRule',
  label: '自定义',
  scan(ctx: ScanContext, options: Record<string, unknown>): Endpoint[] {
    const rules = (options.rules as CustomRule[] | undefined) ?? [];
    if (rules.length === 0) {
      return [];
    }

    const endpoints: Endpoint[] = [];
    const src = ctx.parsed.masked;
    const index = buildLineIndex(src);

    for (const rule of rules) {
      if (!rule.id || !rule.pattern) {
        continue;
      }

      const globs = rule.globs && rule.globs.length > 0 ? rule.globs : ['**/*.java'];
      if (!globs.some((g) => globToRegExp(g).test(ctx.filePath))) {
        continue;
      }

      let re: RegExp;
      try {
        const flags = rule.flags ?? 'g';
        re = new RegExp(rule.pattern, flags.includes('g') ? flags : `${flags}g`);
      } catch {
        continue;
      }

      const kind = rule.type ?? rule.id;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }

        const nameValue = pick(m, rule.nameGroup ?? 'name', 1);
        const pathValue = pick(m, rule.pathGroup ?? 'path', 1) || nameValue;
        const descValue = pick(m, rule.descriptionGroup ?? 'description', 2);
        const line = lineAt(index, m.index);
        const display = (nameValue || pathValue || rule.label).trim();
        if (!display) {
          continue;
        }

        endpoints.push({
          id: `${ctx.filePath}#${line}#${kind}#${display}`,
          kind,
          kindLabel: rule.label,
          name: display,
          path: pathValue || display,
          description: descValue || `${rule.label} 入口`,
          tags: [rule.label],
          className: '',
          methodName: '',
          filePath: ctx.filePath,
          line,
          module: ctx.module,
          unresolved: [],
          searchText: makeSearchText([display, pathValue, descValue, rule.label])
        });
      }
    }

    return endpoints;
  }
};
