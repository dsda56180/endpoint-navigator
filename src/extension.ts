import * as vscode from 'vscode';
import { Indexer } from './indexer';
import { SearchPanel } from './ui/panel';
import { quickSearch } from './ui/quickpick';

export function activate(context: vscode.ExtensionContext): void {
  const indexer = new Indexer();

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'endpointNavigator.search';
  status.text = '$(list-tree) Endpoints';
  status.tooltip = 'Endpoint Navigator：点击搜索接口';
  status.show();

  let indexed = false;

  const updateStatus = (count: number): void => {
    status.text = `$(list-tree) ${count}`;
    status.tooltip = `Endpoint Navigator：${count} 个接口，点击搜索`;
  };

  async function ensureIndexed(): Promise<void> {
    if (indexed) {
      return;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Endpoint Navigator 正在扫描接口',
        cancellable: true
      },
      async (progress, token) => {
        const endpoints = await indexer.build((done, total) => {
          progress.report({
            message: `${done}/${total}`,
            increment: total > 0 ? 100 / total : 0
          });
        }, token);
        indexed = true;
        updateStatus(endpoints.length);
      }
    );
  }

  function selectionText(): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return '';
    }
    return editor.document.getText(editor.selection).trim().slice(0, 120);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('endpointNavigator.search', async () => {
      await ensureIndexed();
      SearchPanel.show(indexer, context.extensionUri, selectionText());
    }),

    vscode.commands.registerCommand('endpointNavigator.quickSearch', async () => {
      await ensureIndexed();
      await quickSearch(indexer);
    }),

    vscode.commands.registerCommand('endpointNavigator.refresh', async () => {
      indexer.clear();
      indexed = false;
      await ensureIndexed();
      SearchPanel.refresh();
      vscode.window.setStatusBarMessage(
        `Endpoint Navigator：已重建索引，共 ${indexer.all.length} 个接口`,
        4000
      );
    })
  );

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.java');
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async (): Promise<void> => {
    if (!indexed) {
      return;
    }
    const uris = Array.from(pending);
    pending.clear();
    for (const uri of uris) {
      await indexer.refreshFile(vscode.Uri.parse(uri));
    }
    updateStatus(indexer.all.length);
    SearchPanel.refresh();
  };

  const schedule = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      void flush();
    }, 300);
  };

  watcher.onDidChange((uri) => {
    pending.add(uri.toString());
    schedule();
  });
  watcher.onDidCreate((uri) => {
    pending.add(uri.toString());
    schedule();
  });
  watcher.onDidDelete((uri) => {
    indexer.dropFile(uri.fsPath);
    updateStatus(indexer.all.length);
    SearchPanel.refresh();
  });

  context.subscriptions.push(
    watcher,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('endpointNavigator')) {
        indexer.clear();
        indexed = false;
        void ensureIndexed().then(() => SearchPanel.refresh());
      }
    }),
    status
  );
}

export function deactivate(): void {
  // no-op
}
