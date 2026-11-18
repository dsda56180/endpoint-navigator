import * as vscode from 'vscode';
import { Indexer } from '../indexer';
import { Endpoint } from '../model';
import { parseQuery, rankEndpoints } from '../search/score';

interface PickItem extends vscode.QuickPickItem {
  ep?: Endpoint;
}

function describe(ep: Endpoint): string {
  const bits: string[] = [];
  if (ep.description) {
    bits.push(ep.description);
  }
  if (ep.className) {
    bits.push(ep.className + (ep.methodName ? '.' + ep.methodName : ''));
  }
  return bits.join('  ·  ');
}

export async function quickSearch(indexer: Indexer): Promise<void> {
  const qp = vscode.window.createQuickPick<PickItem>();
  qp.placeholder = '搜索接口路径 / 中文描述 / 类名；以 re: 开头或开启正则模式';
  qp.matchOnDescription = false;
  qp.title = `Endpoint Navigator（${indexer.all.length} 个接口）`;

  const update = (value: string): void => {
    try {
      const parsed = parseQuery(value, false, false);
      const result = rankEndpoints(indexer.all, parsed, null, 200);
      qp.items = result.items.map((ep) => ({
        label: `${ep.kindLabel}: ${ep.name}`,
        description: describe(ep),
        detail: `${ep.module ? ep.module + ' · ' : ''}${ep.filePath}:${ep.line}`,
        ep
      }));
      qp.title = `Endpoint Navigator（${result.total} 个结果）`;
    } catch (err) {
      qp.items = [
        {
          label: `$(error) ${(err as Error).message}`,
          description: ''
        }
      ];
    }
  };

  update('');

  qp.onDidChangeValue(update);

  qp.onDidAccept(async () => {
    const picked = qp.selectedItems[0];
    qp.hide();
    if (!picked?.ep) {
      return;
    }
    const ep = picked.ep;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(ep.filePath));
    const pos = new vscode.Position(Math.max(0, ep.line - 1), 0);
    await vscode.window.showTextDocument(doc, {
      preview: false,
      selection: new vscode.Range(pos, pos)
    });
  });

  qp.onDidHide(() => qp.dispose());
  qp.show();
}
