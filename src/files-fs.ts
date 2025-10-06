import * as fs from "fs";
import * as path from "path";

interface FileManagerType {
  files: string[];
  folders: string[];
}
export interface FileStat {
  name: string;
  fullPath: string;
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;
}
export interface FileNode extends FileStat {
  type: "file" | "folder";
  children?: FileNode[];
}
export interface FileOptions {
  extensions?: string[];
  exclude?: string[];
  depth?: number; // 0 = unlimited
  isSlashPath?: boolean
}

/*
\ (backslash)
/ (forward slash)
*/
export const normalizePath = (path: string) => {
  return path.replace(/\\/g, "/");
}

// ================= Helpers =================
function normalizeExtensions(extensions?: string[]): string[] | undefined {
  if (!extensions) return undefined;
  return extensions.map((e) =>
    e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`
  );
}

function matchExtension(file: string, extensions?: string[]): boolean {
  if (!extensions || extensions.length === 0) return true;
  const ext = path.extname(file).toLowerCase();
  return extensions.includes(ext);
}

// ================= FileManager =================
export class FileManager {
  // ===== buildStat =====
  static buildStat(fullPath: string, isSlashPath?: boolean): FileStat {
    const stat = fs.statSync(fullPath);
    return {
      name: path.basename(fullPath),
      fullPath: isSlashPath ? normalizePath(fullPath) : fullPath,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      atime: stat.atime,
      mtime: stat.mtime,
      ctime: stat.ctime,
      birthtime: stat.birthtime,
    };
  }

  static buildStatFromStat(fullPath: string, stat: fs.Stats, isSlashPath?: boolean): FileStat {
    return {
      name: path.basename(fullPath),
      fullPath: isSlashPath ? normalizePath(fullPath) : fullPath,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      atime: stat.atime,
      mtime: stat.mtime,
      ctime: stat.ctime,
      birthtime: stat.birthtime,
    };
  }

  // ===== File operations (sync) =====
  static readFile(filePath: string, encoding: BufferEncoding = "utf-8"): string {
    return fs.readFileSync(filePath, { encoding });
  }

  static writeFile(filePath: string, data: string, encoding: BufferEncoding = "utf-8"): void {
    fs.writeFileSync(filePath, data, { encoding });
  }

  static appendFile(filePath: string, data: string, encoding: BufferEncoding = "utf-8"): void {
    fs.appendFileSync(filePath, data, { encoding });
  }

  static exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  static deleteFile(filePath: string): void {
    if (this.exists(filePath)) fs.unlinkSync(filePath);
  }

  static readJSON<T = any>(filePath: string): T | null {
    try {
      const content = this.readFile(filePath);
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  static writeJSON(filePath: string, obj: any, space: number = 2): void {
    const json = JSON.stringify(obj, null, space);
    this.writeFile(filePath, json);
  }

  static createFolder(dirPath: string): void {
    if (!this.exists(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  static rename(oldPath: string, newPath: string): void {
    fs.renameSync(oldPath, newPath);
  }

  static copyFile(src: string, dest: string): void {
    fs.copyFileSync(src, dest);
  }

  static copyFolder(src: string, dest: string): void {
    this.createFolder(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyFolder(srcPath, destPath);
      } else {
        this.copyFile(srcPath, destPath);
      }
    }
  }
  // ===== getTree (sync) =====
  static getTree(dirPath: string, options?: FileOptions, currentDepth: number = 1): FileNode | null {
    const { extensions, exclude, depth = 2 } = options || {};
    const stat = this.buildStat(dirPath, options?.isSlashPath);
    const baseName = path.basename(dirPath);

    if (exclude && exclude.includes(baseName)) return null;

    const node: FileNode = {
      ...stat,
      type: stat.isDirectory ? "folder" : "file",
    };

    if (stat.isDirectory && (depth === 0 || currentDepth < depth)) {
      const items = fs.readdirSync(dirPath);
      node.children = items
        .map((item) => this.getTree(path.join(dirPath, item), options, currentDepth + 1))
        .filter((child): child is FileNode => {
          if (!child) return false;
          if (child.type === "file") {
            return matchExtension(child.fullPath, normalizeExtensions(extensions));
          }
          return true;
        });
    }

    return node;
  }
  // ===== flatten helper =====
  private static flattenTree(node: FileNode | null): FileNode[] {
    if (!node) return [];
    const result: FileNode[] = [node];
    if (node.type === "folder" && node.children) {
      result.push(...node.children.flatMap((child) => this.flattenTree(child)));
    }
    return result;
  }

  // ===== list methods (sync) =====
  static listFiles(dirPath: string, options?: FileOptions): FileNode[] {
    return this.flattenTree(this.getTree(dirPath, options)).filter(
      (n) => n.type === "file"
    );
  }

  static listFolders(dirPath: string, options?: FileOptions): FileNode[] {
    return this.flattenTree(this.getTree(dirPath, options)).filter(
      (n) => n.type === "folder"
    );
  }

  static listAll(dirPath: string, options?: FileOptions): FileNode[] {
    return this.flattenTree(this.getTree(dirPath, options));
  }

  static listFileNames(dirPath: string, options?: FileOptions): string[] {
    return this.listFiles(dirPath, options).map((n) => n.name);
  }

  static listFolderNames(dirPath: string, options?: FileOptions): string[] {
    return this.listFolders(dirPath, options).map((n) => n.name);
  }

  static listAllNames(dirPath: string, options?: FileOptions): string[] {
    return this.listAll(dirPath, options).map((n) => n.name);
  }

  // ===== listFlat (sync) =====
  static listFlat(dirPath: string, options?: FileOptions): FileStat[] {
    return this.listAll(dirPath, options);
  }

  // ===== Async versions =====
  static async readFileAsync(filePath: string, encoding: BufferEncoding = "utf-8"): Promise<string> {
    return await fs.promises.readFile(filePath, { encoding });
  }

  static async writeFileAsync(filePath: string, data: string, encoding: BufferEncoding = "utf-8"): Promise<void> {
    await fs.promises.writeFile(filePath, data, { encoding });
  }

  static async appendFileAsync(filePath: string, data: string, encoding: BufferEncoding = "utf-8"): Promise<void> {
    await fs.promises.appendFile(filePath, data, { encoding });
  }

  static async existsAsync(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  static async deleteFileAsync(filePath: string): Promise<void> {
    if (await this.existsAsync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }

  static async readJSONAsync<T = any>(filePath: string): Promise<T | null> {
    try {
      const content = await this.readFileAsync(filePath);
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  static async writeJSONAsync(filePath: string, obj: any, space: number = 2): Promise<void> {
    const json = JSON.stringify(obj, null, space);
    await this.writeFileAsync(filePath, json);
  }

  static async createFolderAsync(dirPath: string): Promise<void> {
    if (!(await this.existsAsync(dirPath))) {
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
  }

  static async renameAsync(oldPath: string, newPath: string): Promise<void> {
    await fs.promises.rename(oldPath, newPath);
  }

  static async copyFileAsync(src: string, dest: string): Promise<void> {
    await fs.promises.copyFile(src, dest);
  }

  static async copyFolderAsync(src: string, dest: string): Promise<void> {
    await this.createFolderAsync(dest);
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await this.copyFolderAsync(srcPath, destPath);
      } else {
        await this.copyFileAsync(srcPath, destPath);
      }
    }
  }
  // ===== getTreeAsync =====
  static async getTreeAsync(dirPath: string, options?: FileOptions, currentDepth: number = 1): Promise<FileNode | null> {
    const { extensions, exclude, depth = 2 } = options || {};
    const stat = await fs.promises.stat(dirPath);
    const baseName = path.basename(dirPath);

    if (exclude && exclude.includes(baseName)) return null;

    const node: FileNode = {
      type: stat.isDirectory() ? "folder" : "file",
      ...this.buildStatFromStat(dirPath, stat, options?.isSlashPath),
    };

    if (stat.isDirectory() && (depth === 0 || currentDepth < depth)) {
      const items = await fs.promises.readdir(dirPath);
      const children = await Promise.all(
        items.map((item) => this.getTreeAsync(path.join(dirPath, item), options, currentDepth + 1))
      );
      node.children = children.filter((child): child is FileNode => {
        if (!child) return false;
        if (child.type === "file") {
          return matchExtension(child.fullPath, normalizeExtensions(extensions));
        }
        return true;
      });
    }

    return node;
  }
  // ===== list methods (async) =====
  static async listFilesAsync(dirPath: string, options?: FileOptions): Promise<FileNode[]> {
    return this.flattenTree(await this.getTreeAsync(dirPath, options)).filter(
      (n) => n.type === "file"
    );
  }

  static async listFoldersAsync(dirPath: string, options?: FileOptions): Promise<FileNode[]> {
    return this.flattenTree(await this.getTreeAsync(dirPath, options)).filter(
      (n) => n.type === "folder"
    );
  }

  static async listAllAsync(dirPath: string, options?: FileOptions): Promise<FileNode[]> {
    return this.flattenTree(await this.getTreeAsync(dirPath, options));
  }

  static async listFileNamesAsync(dirPath: string, options?: FileOptions): Promise<string[]> {
    return (await this.listFilesAsync(dirPath, options)).map((n) => n.name);
  }

  static async listFolderNamesAsync(dirPath: string, options?: FileOptions): Promise<string[]> {
    return (await this.listFoldersAsync(dirPath, options)).map((n) => n.name);
  }

  static async listAllNamesAsync(dirPath: string, options?: FileOptions): Promise<string[]> {
    return (await this.listAllAsync(dirPath, options)).map((n) => n.name);
  }

  // ===== listFlatAsync =====
  static async listFlatAsync(dirPath: string, options?: FileOptions): Promise<FileStat[]> {
    return (await this.listAllAsync(dirPath, options));
  }
}
export { };