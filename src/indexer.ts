import * as vscode from 'vscode';
import { readSettings, Settings } from './config';
import { parseJava } from './java/parser';
import { Endpoint, ScanContext } from './model';
import { selectScanners } from './registry';

interface FileCache {
  version: number;
  endpoints: Endpoint[];
}

const CONCURRENCY = 8;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

export class Indexer {
  private cache = new Map<string, FileCache>();
  private endpoints: Endpoint[] = [];
  private moduleDirs: Array<{ dir: string; name: string }> = [];
  private building: Promise<Endpoint[]> | null = null;

  get all(): Endpoint[] {
    return this.endpoints;
  }

  clear(): void {
    this.cache.clear();
    this.endpoints = [];
    this.moduleDirs = [];
    this.building = null;
  }

  dropFile(filePath: string): void {
    this.cache.delete(filePath);
    this.endpoints = this.endpoints.filter((ep) => ep.filePath !== filePath);
  }

  async build(
    onProgress?: (done: number, total: number) => void,
    token?: vscode.CancellationToken
  ): Promise<Endpoint[]> {
    if (this.building) {
      return this.building;
    }
    this.building = this.doBuild(onProgress, token).finally(() => {
      this.building = null;
    });
    return this.building;
  }

  private async loadModuleDirs(): Promise<void> {
    const poms = await vscode.workspace.findFiles('**/pom.xml', '**/{target,node_modules,.git}/**', 500);
    this.moduleDirs = poms
      .map((uri) => {
        const dir = uri.fsPath.replace(/[\\/][^\\/]+$/, '');
        const name = dir.split(/[\\/]/).pop() ?? dir;
        return { dir, name };
      })
      .sort((a, b) => b.dir.length - a.dir.length);
  }

  private moduleOf(filePath: string): string {
    for (const m of this.moduleDirs) {
      if (filePath.startsWith(m.dir)) {
        return m.name;
      }
    }
    return '';
  }

  private async doBuild(
    onProgress?: (done: number, total: number) => void,
    token?: vscode.CancellationToken
  ): Promise<Endpoint[]> {
    const settings: Settings = readSettings();
    const scanners = selectScanners(settings.enabledScanners);
    const options = { rules: settings.customRules };

    await this.loadModuleDirs();

    const include =
      settings.includeGlobs.length === 1
        ? settings.includeGlobs[0]
        : `{${settings.includeGlobs.join(',')}}`;

    const files = await vscode.workspace.findFiles(include, settings.excludeGlobs, 20000);

    const collected: Endpoint[] = [];
    let done = 0;

    await mapLimit(files, CONCURRENCY, async (uri) => {
      if (token?.isCancellationRequested) {
        return;
      }
      const key = uri.fsPath;
      let version = 0;
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        version = stat.mtime;
      } catch {
        version = 0;
      }

      const cached = this.cache.get(key);
      if (cached && cached.version === version) {
        for (const ep of cached.endpoints) {
          collected.push(ep);
        }
        done++;
        onProgress?.(done, files.length);
        return;
      }

      try {
        const raw = await vscode.workspace.fs.readFile(uri);
        const text = new TextDecoder('utf-8').decode(raw);
        const parsed = parseJava(text);
        const ctx: ScanContext = {
          filePath: uri.fsPath,
          module: this.moduleOf(uri.fsPath),
          constants: parsed.constants,
          parsed,
          contextPath: settings.contextPath
        };

        const found: Endpoint[] = [];
        for (const scanner of scanners) {
          found.push(...scanner.scan(ctx, options));
        }

        this.cache.set(key, { version, endpoints: found });
        for (const ep of found) {
          collected.push(ep);
        }
      } catch {
        // 单文件失败不影响整体
      }

      done++;
      onProgress?.(done, files.length);
    });

    this.endpoints = collected;
    return collected;
  }

  async refreshFile(uri: vscode.Uri): Promise<void> {
    const settings = readSettings();
    const scanners = selectScanners(settings.enabledScanners);
    const options = { rules: settings.customRules };
    const key = uri.fsPath;

    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder('utf-8').decode(raw);
      const parsed = parseJava(text);
      const ctx: ScanContext = {
        filePath: uri.fsPath,
        module: this.moduleOf(uri.fsPath),
        constants: parsed.constants,
        parsed,
        contextPath: settings.contextPath
      };

      const found: Endpoint[] = [];
      for (const scanner of scanners) {
        found.push(...scanner.scan(ctx, options));
      }

      const stat = await vscode.workspace.fs.stat(uri);
      this.cache.set(key, { version: stat.mtime, endpoints: found });

      this.endpoints = this.endpoints.filter((ep) => ep.filePath !== uri.fsPath);
      this.endpoints.push(...found);
    } catch {
      // 忽略
    }
  }
}
