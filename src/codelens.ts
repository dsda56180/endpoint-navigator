import * as vscode from 'vscode';
import { Indexer } from './indexer';

/**
 * 在 Controller 方法上方渲染完整接口路径，点击后打开搜索面板并预填该路径。
 * 数据全部来自本地索引，不依赖任何 Java 语言服务器。
 */
export class EndpointCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(private readonly indexer: Indexer) {}

  refresh(): void {
    this.changed.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const cfg = vscode.workspace.getConfiguration('endpointNavigator');
    if (!cfg.get<boolean>('codeLens.enabled', true)) {
      return [];
    }
    if (!document.uri.fsPath.endsWith('.java')) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    for (const ep of this.indexer.all) {
      if (ep.filePath !== document.uri.fsPath) {
        continue;
      }
      const line = Math.max(0, ep.line - 1);
      const path = ep.path || ep.name;
      const label = ep.httpMethod ? `${ep.httpMethod} ${path}` : path;
      lenses.push(
        new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
          title: label,
          tooltip: ep.description
            ? `${ep.description}（点击搜索该接口）`
            : '点击搜索该接口',
          command: 'endpointNavigator.searchPath',
          arguments: [path]
        })
      );
    }
    return lenses;
  }
}
