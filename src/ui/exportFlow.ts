import * as vscode from 'vscode';
import { Endpoint } from '../model';
import { toJson, toMarkdown, toOpenApi } from '../report';

interface FormatItem extends vscode.QuickPickItem {
  format: 'md' | 'json' | 'openapi';
  extension: string;
  suffix: string;
}

const FORMATS: FormatItem[] = [
  {
    format: 'openapi',
    extension: 'json',
    suffix: '.openapi.json',
    label: 'OpenAPI 3.0',
    description: '可导入 Postman、Apifox、Insomnia、Swagger UI'
  },
  {
    format: 'md',
    extension: 'md',
    suffix: '.md',
    label: 'Markdown 表格',
    description: '便于阅读与文档归档'
  },
  {
    format: 'json',
    extension: 'json',
    suffix: '.json',
    label: 'JSON（原始字段）',
    description: '便于脚本二次处理'
  }
];

export async function exportEndpoints(endpoints: Endpoint[], scope = '接口'): Promise<void> {
  if (endpoints.length === 0) {
    vscode.window.showInformationMessage('Endpoint Navigator：没有可导出的接口');
    return;
  }

  const pick = await vscode.window.showQuickPick(FORMATS, {
    placeHolder: `导出 ${endpoints.length} 个${scope}，选择格式`
  });
  if (!pick) {
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const target = await vscode.window.showSaveDialog({
    saveLabel: `导出 ${endpoints.length} 个${scope}`,
    filters: { [pick.label]: [pick.extension] },
    defaultUri: folder
      ? vscode.Uri.joinPath(folder, `endpoints${pick.suffix}`)
      : undefined
  });
  if (!target) {
    return;
  }

  const relative = (filePath: string): string =>
    vscode.workspace.asRelativePath(filePath);

  let content: string;
  if (pick.format === 'openapi') {
    content = toOpenApi(endpoints, relative);
  } else if (pick.format === 'json') {
    content = toJson(endpoints, relative);
  } else {
    content = toMarkdown(endpoints, relative);
  }

  await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
  vscode.window.showInformationMessage(
    `已导出 ${endpoints.length} 个${scope}到 ${target.fsPath}`
  );
}
