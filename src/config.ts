import * as vscode from 'vscode';
import { CustomRule } from './model';

export type UiStyle = 'classic' | 'card' | 'compact';

export interface Settings {
  enabledScanners: string[];
  includeGlobs: string[];
  excludeGlobs: string;
  contextPath: string;
  showUnresolved: boolean;
  customRules: CustomRule[];
  uiStyle: UiStyle;
  groupByTag: boolean;
}

export function readSettings(): Settings {
  const cfg = vscode.workspace.getConfiguration('endpointNavigator');
  return {
    enabledScanners: cfg.get<string[]>('enabledScanners', [
      'rest',
      'feign',
      'httpcall',
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
    customRules: cfg.get<CustomRule[]>('customRules', []),
    uiStyle: cfg.get<UiStyle>('ui.style', 'classic'),
    groupByTag: cfg.get<boolean>('ui.groupByTag', false)
  };
}
