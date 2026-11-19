import * as vscode from 'vscode';
import { applyConfig, parseConfigFile } from './analysis/appconfig';
import { applyConstants, stringLiteral } from './analysis/constants';
import { DuplicateGroup, findDuplicates } from './analysis/duplicates';
import { applyInheritance, IfaceInfo, ifacesOf } from './analysis/inheritance';
import { readSettings, Settings } from './config';
import { parseJava } from './java/parser';
import { AnnotationNode, Endpoint, ParsedFile, ScanContext } from './model';
import { selectScanners } from './registry';

interface FileCache {
  version: number;
  endpoints: Endpoint[];
  constants: Array<[string, string]>;
  ifaces: IfaceInfo[];
}

interface PersistedEntry {
  mtime: number;
  endpoints: Endpoint[];
  constants: Array<[string, string]>;
  ifaces: IfaceInfo[];
}

interface PersistedCache {
  version: number;
  settingsKey: string;
  entries: Record<string, PersistedEntry>;
}

const CACHE_VERSION = 3;
const CACHE_FILE = 'index-cache.json';
const CONCURRENCY = 8;

const DECODER = new TextDecoder('utf-8');

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
  private extensionVersion = '0';
  private cacheDirty = false;
  private cacheKey = '';

  get all(): Endpoint[] {
    return this.endpoints;
  }

  get duplicates(): DuplicateGroup[] {
    return this.duplicateGroups;
  }

  attachStorage(dir: vscode.Uri, extensionVersion: string): void {
    this.storageDir = dir;
    this.extensionVersion = extensionVersion;
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
    this.schedulePersist();
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

  // ---- 持久化 ----

  private describeSettings(
    settings: Settings,
    contextPath: string,
    config: Map<string, string>
  ): string {
    return JSON.stringify({
      v: this.extensionVersion,
      scanners: settings.enabledScanners,
      include: settings.includeGlobs,
      exclude: settings.excludeGlobs,
      contextPath,
      rules: settings.customRules,
      config: Array.from(config.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))
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
      const data = JSON.parse(DECODER.decode(raw)) as PersistedCache;
      if (data.version !== CACHE_VERSION || data.settingsKey !== key) {
        return;
      }
      for (const [file, entry] of Object.entries(data.entries)) {
        this.cache.set(file, {
          version: entry.mtime,
          endpoints: entry.endpoints,
          constants: entry.constants ?? [],
          ifaces: entry.ifaces ?? []
        });
      }
    } catch {
      // 首次运行或缓存损坏，正常全量扫描
    }
  }

  private schedulePersist(): void {
    if (!this.storageDir) {
      return;
    }
    this.cacheDirty = true;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      void this.persist();
    }, 8000);
  }

  private async persist(): Promise<void> {
    if (!this.storageDir || !this.cacheDirty) {
      return;
    }
    try {
      await vscode.workspace.fs.createDirectory(this.storageDir);
      const entries: Record<string, PersistedEntry> = {};
      for (const [file, entry] of this.cache.entries()) {
        entries[file] = {
          mtime: entry.version,
          endpoints: entry.endpoints,
          constants: entry.constants,
          ifaces: entry.ifaces
        };
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
      this.cacheDirty = false;
    } catch {
      // 缓存写入失败不影响功能
    }
  }

  // ---- 解析辅助 ----

  private collectConstants(): Map<string, string> {
    const values = new Map<string, Set<string>>();
    for (const entry of this.cache.values()) {
      for (const [name, raw] of entry.constants) {
        const literal = stringLiteral(raw);
        if (literal === undefined) {
          continue;
        }
        const set = values.get(name) ?? new Set<string>();
        set.add(literal);
        values.set(name, set);
      }
    }

    const resolved = new Map<string, string>();
    for (const [name, set] of values.entries()) {
      if (set.size === 1) {
        resolved.set(name, set.values().next().value as string);
      }
    }
    return resolved;
  }

  private buildIfaceRegistry(
    extra: Array<IfaceInfo[]> = []
  ): Map<string, Map<string, AnnotationNode[]>> {
    const registry = new Map<string, Map<string, AnnotationNode[]>>();
    const add = (ifaces: IfaceInfo[]): void => {
      for (const iface of ifaces) {
        let methods = registry.get(iface.name);
        if (!methods) {
          methods = new Map<string, AnnotationNode[]>();
          registry.set(iface.name, methods);
        }
        for (const method of iface.methods) {
          methods.set(method.name, method.annotations);
        }
      }
    };

    for (const entry of this.cache.values()) {
      add(entry.ifaces);
    }
    for (const list of extra) {
      add(list);
    }
    return registry;
  }

  private async resolveContextPath(settings: Settings): Promise<string> {
    if (settings.contextPath) {
      return settings.contextPath;
    }
    try {
      const files = await vscode.workspace.findFiles(
        '**/application{,-*}.{yml,yaml,properties}',
        '**/{target,build,node_modules,out,dist,.git}/**',
        20
      );
      for (const uri of files) {
        const text = DECODER.decode(await vscode.workspace.fs.readFile(uri));
        const match = /server\.servlet\.context-path\s*[:=]\s*['"]?([^'"\s\r\n]+)/.exec(text);
        if (match) {
          return match[1].trim();
        }
      }
    } catch {
      // 读取失败按无前缀处理
    }
    return '';
  }

  /** 读取 application.yml / application.properties，用于解析 ${key} 占位符 */
  private async loadAppConfig(): Promise<Map<string, string>> {
    const config = new Map<string, string>();
    try {
      const files = await vscode.workspace.findFiles(
        '**/application{,-*}.{yml,yaml,properties}',
        '**/{target,build,node_modules,out,dist,.git}/**',
        50
      );
      const rank = (filePath: string): number =>
        /[\\/]application\.(yml|yaml|properties)$/i.test(filePath) ? 0 : 1;
      const sorted = files
        .slice()
        .sort((a, b) => rank(a.fsPath) - rank(b.fsPath) || a.fsPath.localeCompare(b.fsPath));

      for (const uri of sorted) {
        try {
          const text = DECODER.decode(await vscode.workspace.fs.readFile(uri));
          parseConfigFile(uri.fsPath, text, config);
        } catch {
          // 单个配置读取失败不影响整体
        }
      }
    } catch {
      // 无配置文件
    }
    return config;
  }

  // ---- 模块信息 ----

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

  // ---- 主流程 ----

  private async doBuild(
    onProgress?: (done: number, total: number) => void,
    token?: vscode.CancellationToken
  ): Promise<Endpoint[]> {
    const settings: Settings = readSettings();
    const scanners = selectScanners(settings.enabledScanners);
    const options = { rules: settings.customRules };
    const contextPath = await this.resolveContextPath(settings);
    const appConfig = await this.loadAppConfig();

    this.settingsKeyValue = this.describeSettings(settings, contextPath, appConfig);
    if (this.cacheKey !== this.settingsKeyValue) {
      this.cache.clear();
      this.cacheKey = this.settingsKeyValue;
    }
    await this.loadPersisted(this.settingsKeyValue);
    await this.loadModuleDirs();

    const include =
      settings.includeGlobs.length === 1
        ? settings.includeGlobs[0]
        : `{${settings.includeGlobs.join(',')}}`;

    const files = await vscode.workspace.findFiles(include, settings.excludeGlobs, 20000);

    // 先取全部 mtime：用于判断缓存是否仍然可信
    const mtimes = new Map<string, number>();
    await mapLimit(files, CONCURRENCY, async (uri) => {
      let version = 0;
      try {
        version = (await vscode.workspace.fs.stat(uri)).mtime;
      } catch {
        version = 0;
      }
      mtimes.set(uri.fsPath, version);
    });

    // 新增文件，或常量/接口文件变更时，缓存中的端点可能已过期，整体重建
    for (const uri of files) {
      const key = uri.fsPath;
      const cached = this.cache.get(key);
      if (!cached) {
        this.cache.clear();
        break;
      }
      const version = mtimes.get(key) ?? 0;
      if (
        cached.version !== version &&
        (cached.constants.length > 0 || cached.ifaces.length > 0)
      ) {
        this.cache.clear();
        break;
      }
    }

    const present = new Set(files.map((uri) => uri.fsPath));
    for (const key of Array.from(this.cache.keys())) {
      if (!present.has(key)) {
        this.cache.delete(key);
      }
    }

    const collected: Endpoint[] = [];
    const parsedFiles = new Map<string, ParsedFile>();
    const texts = new Map<string, string>();
    const freshMeta = new Map<string, { version: number; constants: Array<[string, string]>; ifaces: IfaceInfo[] }>();
    let done = 0;

    await mapLimit(files, CONCURRENCY, async (uri) => {
      if (token?.isCancellationRequested) {
        return;
      }
      const key = uri.fsPath;
      const version = mtimes.get(key) ?? 0;

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
        const text = DECODER.decode(await vscode.workspace.fs.readFile(uri));
        const parsed = parseJava(text);
        parsedFiles.set(key, parsed);
        texts.set(key, text);
        freshMeta.set(key, {
          version,
          constants: Array.from(parsed.constants.entries()),
          ifaces: ifacesOf(parsed)
        });
      } catch {
        // 单文件失败不影响整体
      }

      done++;
      onProgress?.(done, files.length);
    });

    const registry = this.buildIfaceRegistry(
      Array.from(freshMeta.values()).map((meta) => meta.ifaces)
    );

    for (const [key, parsed] of parsedFiles.entries()) {
      if (token?.isCancellationRequested) {
        break;
      }
      applyInheritance(parsed, registry);

      const meta = freshMeta.get(key);
      const ctx: ScanContext = {
        filePath: key,
        module: this.moduleOf(key),
        constants: parsed.constants,
        parsed,
        contextPath,
        text: texts.get(key),
        config: appConfig
      };

      const found: Endpoint[] = [];
      for (const scanner of scanners) {
        found.push(...scanner.scan(ctx, options));
      }

      this.cache.set(key, {
        version: meta?.version ?? 0,
        endpoints: found,
        constants: meta?.constants ?? [],
        ifaces: meta?.ifaces ?? []
      });
      for (const ep of found) {
        collected.push(ep);
      }
    }

    const constants = this.collectConstants();
    this.endpoints = collected.map((ep) => applyConfig(applyConstants(ep, constants), appConfig));
    this.duplicateGroups = findDuplicates(this.endpoints);
    this.schedulePersist();
    return this.endpoints;
  }

  async refreshFile(uri: vscode.Uri): Promise<void> {
    const settings = readSettings();
    const scanners = selectScanners(settings.enabledScanners);
    const options = { rules: settings.customRules };
    const key = uri.fsPath;

    try {
      const text = DECODER.decode(await vscode.workspace.fs.readFile(uri));
      const parsed = parseJava(text);
      const ifaces = ifacesOf(parsed);
      const registry = this.buildIfaceRegistry([ifaces]);
      applyInheritance(parsed, registry);

      const contextPath = await this.resolveContextPath(settings);
      const appConfig = await this.loadAppConfig();
      const ctx: ScanContext = {
        filePath: key,
        module: this.moduleOf(key),
        constants: parsed.constants,
        parsed,
        contextPath,
        text,
        config: appConfig
      };

      const found: Endpoint[] = [];
      for (const scanner of scanners) {
        found.push(...scanner.scan(ctx, options));
      }

      let version = 0;
      try {
        version = (await vscode.workspace.fs.stat(uri)).mtime;
      } catch {
        version = 0;
      }

      this.cache.set(key, {
        version,
        endpoints: found,
        constants: Array.from(parsed.constants.entries()),
        ifaces
      });

      const constants = this.collectConstants();
      this.endpoints = this.endpoints
        .filter((ep) => ep.filePath !== key)
        .concat(found.map((ep) => applyConfig(applyConstants(ep, constants), appConfig)));
      this.duplicateGroups = findDuplicates(this.endpoints);
      this.schedulePersist();
    } catch {
      // 忽略
    }
  }
}
