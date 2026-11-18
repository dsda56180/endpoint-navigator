import * as vscode from 'vscode';
import { findHoverTargets } from './analysis/hover';
import { Indexer } from './indexer';
import { parseJava } from './java/parser';
import { Endpoint, ParsedFile } from './model';

const MAX_PARSE_CACHE = 50;

export class EndpointHoverProvider implements vscode.HoverProvider {
  private readonly parsed = new Map<string, { version: number; value: ParsedFile }>();

  constructor(private readonly indexer: Indexer) {}

  refresh(): void {
    this.parsed.clear();
  }

  private parse(document: vscode.TextDocument): ParsedFile {
    const key = document.uri.fsPath;
    const hit = this.parsed.get(key);
    if (hit && hit.version === document.version) {
      return hit.value;
    }
    const value = parseJava(document.getText());
    if (this.parsed.size >= MAX_PARSE_CACHE) {
      const oldest = this.parsed.keys().next().value;
      if (oldest !== undefined) {
        this.parsed.delete(oldest);
      }
    }
    this.parsed.set(key, { version: document.version, value });
    return value;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    if (!document.uri.fsPath.endsWith('.java')) {
      return undefined;
    }
    const cfg = vscode.workspace.getConfiguration('endpointNavigator');
    if (!cfg.get<boolean>('hover.enabled', true)) {
      return undefined;
    }

    const targets = findHoverTargets(this.parse(document), position.line + 1);
    if (targets.length === 0) {
      return undefined;
    }

    const matches: Endpoint[] = [];
    for (const target of targets) {
      for (const ep of this.indexer.all) {
        if (
          ep.filePath === document.uri.fsPath &&
          ep.className === target.className &&
          ep.methodName === target.methodName &&
          Math.abs(ep.line - target.methodLine) <= 2
        ) {
          matches.push(ep);
        }
      }
    }
    if (matches.length === 0) {
      return undefined;
    }

    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.isTrusted = { enabledCommands: ['endpointNavigator.searchPath'] };
    markdown.supportThemeIcons = true;

    const duplicateIds = new Set<string>();
    for (const group of this.indexer.duplicates) {
      for (const ep of group.endpoints) {
        duplicateIds.add(ep.id);
      }
    }

    const shown = matches.slice(0, 5);
    shown.forEach((ep, index) => {
      if (index > 0) {
        markdown.appendMarkdown('\n\n---\n\n');
      }
      const badge = ep.httpMethod && ep.httpMethod !== 'ALL' ? ep.httpMethod : ep.kindLabel;
      markdown.appendMarkdown(`**${badge}** \`${ep.path || ep.name}\``);
      if (ep.description) {
        markdown.appendMarkdown(`\n\n${ep.description}`);
      }
      markdown.appendMarkdown(
        `\n\n\`${ep.className}.${ep.methodName}\` · ${vscode.workspace.asRelativePath(ep.filePath)}:${ep.line}`
      );
      if (ep.unresolved.length > 0) {
        markdown.appendMarkdown(`\n\n$(warning) 未解析：${ep.unresolved.join(', ')}`);
      }
      if (duplicateIds.has(ep.id)) {
        markdown.appendMarkdown('\n\n$(warning) 与其他接口映射重复');
      }
      const args = encodeURIComponent(JSON.stringify([ep.path || ep.name]));
      markdown.appendMarkdown(
        `\n\n[$(search) 在面板中搜索](command:endpointNavigator.searchPath?${args})`
      );
    });
    if (matches.length > shown.length) {
      markdown.appendMarkdown(`\n\n还有 ${matches.length - shown.length} 个映射`);
    }

    return new vscode.Hover(markdown);
  }
}
