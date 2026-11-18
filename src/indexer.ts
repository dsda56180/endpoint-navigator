import * as vscode from 'vscode';
import { DuplicateGroup, findDuplicates } from './analysis/duplicates';
import { readSettings, Settings } from './config';
import { parseJava } from './java/parser';
import { Endpoint, ScanContext } from './model';
import { selectScanners } from './registry';

interface FileCache {
  version: number;
  endpoints: Endpoint[];
}

interface PersistedCache {
  version: number;
  settingsKey: string;
  entries: Record<string, { mtime: number; endpoints: Endpoint[] }>;
}

const CACHE_VERSION = 1;
const CACHE_FILE = 'index-cache.json';
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
  private duplicateGroups: DuplicateGroup[] = [];
  private moduleDirs: Array<{ dir: string; name: string }> = [];
  private building: Promise<Endpoint[]> | null = null;
  private storageDir?: vscode.Uri;
  private settingsKeyValue = '';
  private persistTimer?: ReturnType<typeof setTimeout>;

  attachStorage(dir: vscode.Uri): void {
    this.storageDir = dir;
  }

  private describeSettings(settings: Settings): string {
    return JSON.stringify({
      scanners: settings.enabledScanners,
      include: settings.includeGlobs,
      exclude: settings.excludeGlobs,
      contextPath: settings.contextPath,
      rules: settings.customRules
    });
  }

  private async loadPersisted(key: string): Promise<void> {
    if (!this.storageDir || this.cache.size > 0) {
      return;
    }
    try {
      const raw = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(this.storageDir, CACHE_FILE)
      );
      const data = JSON.parse(new TextDecoder('utf-8').decode(raw)) as PersistedCache;
      if (data.version !== CACHE_VERSION || data.settingsKey !== key) {
        return;
      }
      for (const [file, entry] of Object.entries(data.entries)) {
        this.cache.set(file, { version: entry.mtime, endpoints: entry.endpoints });
      }
    } catch {
      // 首次运行或缓存损坏，正常全量扫描
    }
  }

  private schedulePersist(): void {
    if (!this.storageDir) {
      return;
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      void this.persist();
    }, 1500);
  }

  private async persist(): Promise<void> {
    if (!this.storageDir) {
      return;
    }
    try {
      await vscode.workspace.fs.createDirectory(this.storageDir);
      const entries: Record<string, { mtime: number; endpoints: Endpoint[] }> = {};
      for (const [file, entry] of this.cache.entries()) {
        entries[file] = { mtime: entry.version, endpoints: entry.endpoints };
      }
      const payload: PersistedCache = {
        version: CACHE_VERSION,
        settingsKey: this.settingsKeyValue,
        entries
      };
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(this.storageDir, CACHE_FILE),
        Buffer.from(JSON.stringify(payload), 'utf8')
      );
    } catch {
      // 缓存写入失败不影响功能
    }
  }

  get all(): Endpoint[] {
    return this.endpoints;
  }

  get duplicates(): DuplicateGroup[] {
    return this.duplicateGroups;
  }

  clear(): void {
    this.cache.clear();
    this.endpoints = [];
    this.duplicateGroups = [];
    this.moduleDirs = [];
    this.building = null;
  }

  dropFile(filePath: string): void {
    this.cache.delete(filePath);
    this.endpoints = this.endpoints.filter((ep) => ep.filePath !== filePath);
    this.duplicateGroups = findDuplicates(this.endpoints);
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

    this.settingsKeyValue = this.describeSettings(settings);
    await this.loadPersisted(this.settingsKeyValue);
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
    this.duplicateGroups = findDuplicates(collected);
    this.schedulePersist();
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
      this.duplicateGroups = findDuplicates(this.endpoints);
      this.schedulePersist();
    } catch {
      // 忽略
    }
  }
}
