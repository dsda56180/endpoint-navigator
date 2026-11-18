import * as vscode from 'vscode';
import { EndpointCodeLensProvider } from './codelens';
import { Indexer } from './indexer';
import { Endpoint } from './model';
import { SearchPanel } from './ui/panel';
import { quickSearch } from './ui/quickpick';

export function activate(context: vscode.ExtensionContext): void {
  const indexer = new Indexer();
  indexer.attachStorage(
    context.globalStorageUri,
    String(context.extension.packageJSON.version ?? '0')
  );
  const codeLens = new EndpointCodeLensProvider(indexer);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'endpointNavigator.search';
  status.text = '$(list-tree) Endpoints';
  status.tooltip = 'Endpoint Navigator：点击搜索接口';
  status.show();

  let indexed = false;
  let warnedDuplicates = false;

  const updateStatus = (count: number): void => {
    const dup = indexer.duplicates.length;
    status.text = `$(list-tree) ${count}`;
    status.tooltip =
      dup > 0
        ? `Endpoint Navigator：${count} 个接口，${dup} 组重复映射，点击搜索`
        : `Endpoint Navigator：${count} 个接口，点击搜索`;
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

        // 用户取消时索引不完整，不能标记为已建立
        if (token.isCancellationRequested) {
          return;
        }

        indexed = true;
        updateStatus(endpoints.length);
        codeLens.refresh();

        const dup = indexer.duplicates;
        if (!warnedDuplicates && dup.length > 0) {
          warnedDuplicates = true;
          void vscode.window
            .showWarningMessage(`Endpoint Navigator：检测到 ${dup.length} 组重复的接口映射`, '查看冲突')
            .then((pick) => {
              if (pick) {
                void vscode.commands.executeCommand('endpointNavigator.checkDuplicates');
              }
            });
        }
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

    vscode.commands.registerCommand('endpointNavigator.searchPath', async (path?: string) => {
      await ensureIndexed();
      SearchPanel.show(indexer, context.extensionUri, typeof path === 'string' ? path : '');
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
    }),

    vscode.commands.registerCommand('endpointNavigator.checkDuplicates', async () => {
      await ensureIndexed();
      const groups = indexer.duplicates;
      if (groups.length === 0) {
        vscode.window.showInformationMessage('Endpoint Navigator：未发现重复的接口映射');
        return;
      }

      const items = groups.map((g) => ({
        label: g.key,
        description: `${g.endpoints.length} 处`,
        detail: g.endpoints
          .map(
            (ep) =>
              `${ep.className}#${ep.methodName}  ${vscode.workspace.asRelativePath(ep.filePath)}:${ep.line}`
          )
          .join('    |    '),
        group: g
      }));

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: `共 ${groups.length} 组冲突，选择一项以定位`
      });
      if (!pick) {
        return;
      }
      const first = pick.group.endpoints[0];
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(first.filePath));
      const pos = new vscode.Position(Math.max(0, first.line - 1), 0);
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(pos, pos)
      });
    }),

    vscode.commands.registerCommand('endpointNavigator.export', async () => {
      await ensureIndexed();
      const all = indexer.all;
      if (all.length === 0) {
        vscode.window.showInformationMessage('Endpoint Navigator：没有可导出的接口');
        return;
      }

      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const target = await vscode.window.showSaveDialog({
        saveLabel: '导出接口清单',
        filters: { Markdown: ['md'], JSON: ['json'] },
        defaultUri: folder ? vscode.Uri.joinPath(folder, 'endpoints.md') : undefined
      });
      if (!target) {
        return;
      }

      const content = target.fsPath.toLowerCase().endsWith('.json')
        ? JSON.stringify(
            all.map((ep) => ({
              kind: ep.kind,
              method: ep.httpMethod ?? '',
              path: ep.path,
              name: ep.name,
              description: ep.description ?? '',
              className: ep.className,
              methodName: ep.methodName,
              file: ep.filePath,
              line: ep.line,
              module: ep.module
            })),
            null,
            2
          )
        : toMarkdown(all);

      await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
      vscode.window.showInformationMessage(
        `已导出 ${all.length} 个接口到 ${target.fsPath}`
      );
    }),

    vscode.languages.registerCodeLensProvider({ scheme: 'file', language: 'java' }, codeLens)
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
    codeLens.refresh();
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
    codeLens.refresh();
    SearchPanel.refresh();
  });

  context.subscriptions.push(
    watcher,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('endpointNavigator')) {
        indexer.clear();
        indexed = false;
        void ensureIndexed().then(() => SearchPanel.refresh());
        codeLens.refresh();
      }
    }),
    status
  );

  void (async () => {
    const javaFiles = await vscode.workspace.findFiles(
      '**/*.java',
      '**/{target,build,node_modules,out,dist,.git}/**',
      1
    );
    if (javaFiles.length > 0) {
      await ensureIndexed();
    }
  })();
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function toMarkdown(endpoints: Endpoint[]): string {
  const lines = [
    '| 类型 | 方法 | 路径 | 描述 | 类.方法 | 位置 |',
    '| --- | --- | --- | --- | --- | --- |'
  ];
  for (const ep of endpoints) {
    const cells = [
      escapeCell(ep.kindLabel),
      escapeCell(ep.httpMethod ?? ''),
      escapeCell(ep.path || ep.name),
      escapeCell(ep.description ?? ''),
      escapeCell(`${ep.className}.${ep.methodName}`),
      escapeCell(`${vscode.workspace.asRelativePath(ep.filePath)}:${ep.line}`)
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

export function deactivate(): void {
  // no-op
}
