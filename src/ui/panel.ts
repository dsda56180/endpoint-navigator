import * as vscode from 'vscode';
import { readSettings } from '../config';
import { Indexer } from '../indexer';
import { Endpoint } from '../model';
import { parseQuery, rankEndpoints } from '../search/score';

const KIND_ORDER = ['rest', 'websocket', 'xxljob', 'mq', 'scheduled', 'mybatis'];

interface TabStat {
  kind: string;
  label: string;
  count: number;
}

let current: SearchPanel | undefined;

function buildStats(endpoints: Endpoint[]): TabStat[] {
  const map = new Map<string, TabStat>();
  for (const ep of endpoints) {
    const existing = map.get(ep.kind);
    if (existing) {
      existing.count++;
    } else {
      map.set(ep.kind, { kind: ep.kind, label: ep.kindLabel, count: 1 });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const ia = KIND_ORDER.indexOf(a.kind);
    const ib = KIND_ORDER.indexOf(b.kind);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

export class SearchPanel {
  static show(indexer: Indexer, extensionUri: vscode.Uri, initialQuery = ''): void {
    if (current) {
      current.panel.reveal(undefined, false);
      if (initialQuery) {
        current.query = initialQuery;
        current.showAll = false;
        current.panel.webview.postMessage({ type: 'setQuery', query: initialQuery });
      } else {
        current.panel.webview.postMessage({ type: 'focusSearch' });
      }
      return;
    }
    current = new SearchPanel(indexer, extensionUri, initialQuery);
  }

  static refresh(): void {
    current?.pushStats();
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly indexer: Indexer;
  private readonly disposables: vscode.Disposable[] = [];

  private query = '';
  private kind: string | null = null;
  private regex = false;
  private caseSensitive = false;
  private showAll = false;
  private initialized = false;

  private constructor(indexer: Indexer, extensionUri: vscode.Uri, initialQuery: string) {
    this.indexer = indexer;
    this.query = initialQuery;

    this.panel = vscode.window.createWebviewPanel(
      'endpointNavigator',
      'Endpoint Navigator',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
      }
    );

    this.panel.webview.html = this.html(extensionUri);

    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case 'ready':
            this.initialized = true;
            this.pushStats();
            this.panel.webview.postMessage({ type: 'initial', query: this.query });
            this.runSearch();
            break;
          case 'search':
            this.query = msg.query ?? '';
            this.kind = msg.kind ?? null;
            this.regex = !!msg.regex;
            this.caseSensitive = !!msg.caseSensitive;
            this.showAll = false;
            this.runSearch();
            break;
          case 'more':
            this.showAll = true;
            this.runSearch();
            break;
          case 'copy':
            await this.copyEndpoint(msg.id, msg.action);
            break;
          case 'open':
            await this.openEndpoint(msg.id);
            break;
          case 'close':
            this.panel.dispose();
            await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
            break;
        }
      },
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(
      () => {
        current = undefined;
        while (this.disposables.length > 0) {
          this.disposables.pop()?.dispose();
        }
      },
      undefined,
      this.disposables
    );
  }

  pushStats(): void {
    if (!this.initialized) {
      return;
    }
    this.panel.webview.postMessage({
      type: 'stats',
      stats: buildStats(this.indexer.all)
    });
  }

  runSearch(): void {
    if (!this.initialized) {
      return;
    }

    try {
      const parsed = parseQuery(this.query, this.regex, this.caseSensitive);
      const result = rankEndpoints(
        this.indexer.all,
        parsed,
        this.kind,
        this.showAll ? 5000 : 500
      );
      const showUnresolved = readSettings().showUnresolved;
      const items = showUnresolved
        ? result.items
        : result.items.map((ep) => (ep.unresolved.length > 0 ? { ...ep, unresolved: [] } : ep));
      this.panel.webview.postMessage({
        type: 'results',
        items,
        total: result.total,
        query: {
          mode: parsed.mode,
          terms: parsed.terms,
          caseSensitive: parsed.caseSensitive,
          regex: parsed.regex
            ? { source: parsed.regex.source, flags: parsed.regex.flags }
            : null
        }
      });
    } catch (err) {
      this.panel.webview.postMessage({
        type: 'error',
        message: (err as Error).message
      });
    }
  }

  private async copyEndpoint(id: string, action: string): Promise<void> {
    const ep = this.indexer.all.find((e) => e.id === id);
    if (!ep) {
      return;
    }

    let text = '';
    if (action === 'ref') {
      text = `${ep.className}#${ep.methodName}`;
    } else if (action === 'curl') {
      text = `curl -X ${ep.httpMethod ?? 'GET'} "http://localhost:8080${ep.path}"`;
    } else if (action === 'fileline') {
      text = `${ep.filePath}:${ep.line}`;
    } else {
      text = ep.path || ep.name;
    }

    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage(`已复制：${text}`, 2500);
  }

  private async openEndpoint(id: string): Promise<void> {
    const ep = this.indexer.all.find((e) => e.id === id);
    if (!ep) {
      return;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(ep.filePath));
      const pos = new vscode.Position(Math.max(0, ep.line - 1), 0);
      await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: false,
        selection: new vscode.Range(pos, pos)
      });
      this.panel.dispose();
    } catch (err) {
      vscode.window.showErrorMessage(`无法打开文件：${(err as Error).message}`);
    }
  }

  private html(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'main.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'main.js')
    );
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styleUri}">
<title>Endpoint Navigator</title>
</head>
<body>
  <div class="tabs" id="tabs"></div>
  <div class="searchbar">
    <input id="q" type="text" placeholder="搜索接口路径 / 中文描述 / 类名，空格分隔多个关键词" autocomplete="off" />
    <button class="toggle" id="re" title="正则模式（也可用 re: 前缀）">.*</button>
    <button class="toggle" id="case" title="区分大小写">Aa</button>
    <span id="count"></span>
  </div>
  <div class="error" id="error"></div>
  <div class="list" id="list" role="listbox"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
