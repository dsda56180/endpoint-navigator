import * as vscode from 'vscode';
import { CustomRule } from './model';

export interface Settings {
  enabledScanners: string[];
  includeGlobs: string[];
  excludeGlobs: string;
  contextPath: string;
  showUnresolved: boolean;
  customRules: CustomRule[];
}

export function readSettings(): Settings {
  const cfg = vscode.workspace.getConfiguration('endpointNavigator');
  return {
    enabledScanners: cfg.get<string[]>('enabledScanners', [
      'rest',
      'stomp',
      'xxljob',
      'messaging',
      'mybatis',
      'regexRule'
    ]),
    includeGlobs: cfg.get<string[]>('includeGlobs', ['**/*.java']),
    excludeGlobs: cfg.get<string>('excludeGlobs', '**/{target,build,node_modules,out,dist,.git}/**'),
    contextPath: cfg.get<string>('contextPath', ''),
    showUnresolved: cfg.get<boolean>('showUnresolved', true),
    customRules: cfg.get<CustomRule[]>('customRules', [])
  };
}
