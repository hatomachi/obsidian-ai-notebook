import * as fs from 'fs';
import * as path from 'path';

export interface BoundFolderNode {
    name: string;
    relativePath: string; // バインド起点からの相対パス (例: "" または "2024/NDPシステム_基盤更改")
    type: 'folder' | 'file';
    size?: number;
    extension?: string;
    mtime?: string;
    children?: BoundFolderNode[];
    fileCount?: number;   // フォルダ配下の対象ファイル総数 (再帰合算)
}

/**
 * 読み取り対象とする拡張子一覧（大文字小文字不問）
 */
const SUPPORTED_EXTENSIONS = new Set([
    'xlsx', 'xls', 'xlsm',
    'pptx', 'ppt',
    'docx', 'doc',
    'md', 'markdown',
    'txt', 'text',
    'csv', 'tsv',
    'pdf',
    'json', 'yaml', 'yml'
]);

/**
 * 除外する隠しフォルダ・システムファイル名
 */
const IGNORED_NAMES = new Set([
    '.git', '.svn', '.DS_Store', 'Thumbs.db', 'desktop.ini',
    'node_modules', '.cache', '$RECYCLE.BIN'
]);

export class BoundFolderReader {
    /**
     * 指定されたベースパスの安全性を検証し、実在するディレクトリであることを確認
     */
    static isValidDirectory(basePath: string): boolean {
        if (!basePath || typeof basePath !== 'string') return false;
        try {
            const stat = fs.statSync(basePath);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * パストラバーサル（../）による外部脱出を防止し、ベースパス配下の安全な絶対パスを解決
     */
    static resolveSafePath(basePath: string, relativePath: string): string {
        const resolvedBase = path.resolve(basePath);
        const resolvedTarget = path.resolve(resolvedBase, relativePath);

        // resolvedTarget が resolvedBase 配下に収まっているか確認
        if (!resolvedTarget.startsWith(resolvedBase)) {
            throw new Error(`不正なパス指定です（パストラバーサル検知）: ${relativePath}`);
        }
        return resolvedTarget;
    }

    /**
     * サポート対象のファイル拡張子か判定
     */
    static isSupportedFile(fileName: string): boolean {
        const ext = path.extname(fileName).toLowerCase().replace(/^\./, '');
        return SUPPORTED_EXTENSIONS.has(ext);
    }

    /**
     * 外部フォルダの階層ツリーを再帰的に走査（読み取り専用）
     * 不揃いな階層深さ（テーマ直下、2024/テーマ直下 等）に柔軟に対応
     *
     * @param basePath 外部フォルダの絶対パス
     * @param maxDepth 最大探索深度（デフォルト: 5）
     */
    static async listTree(basePath: string, maxDepth: number = 5): Promise<BoundFolderNode> {
        if (!this.isValidDirectory(basePath)) {
            throw new Error(`指定されたフォルダが見つかりません、またはディレクトリではありません: ${basePath}`);
        }

        const rootName = path.basename(path.resolve(basePath)) || 'root';

        const scanDir = (currentAbsPath: string, currentRelPath: string, currentDepth: number): BoundFolderNode => {
            const node: BoundFolderNode = {
                name: currentRelPath ? path.basename(currentRelPath) : rootName,
                relativePath: currentRelPath,
                type: 'folder',
                children: [],
                fileCount: 0
            };

            if (currentDepth > maxDepth) {
                return node;
            }

            try {
                const entries = fs.readdirSync(currentAbsPath, { withFileTypes: true });

                for (const entry of entries) {
                    if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith('~$') || entry.name.startsWith('.')) {
                        continue;
                    }

                    const entryAbsPath = path.join(currentAbsPath, entry.name);
                    const entryRelPath = currentRelPath ? `${currentRelPath}/${entry.name}` : entry.name;

                    try {
                        if (entry.isDirectory()) {
                            const childDirNode = scanDir(entryAbsPath, entryRelPath, currentDepth + 1);
                            // ファイルが1件以上含まれるフォルダ、または空でも直下階層なら追加
                            if (childDirNode.children && (childDirNode.fileCount! > 0 || currentDepth <= 2)) {
                                node.children!.push(childDirNode);
                                node.fileCount = (node.fileCount || 0) + (childDirNode.fileCount || 0);
                            }
                        } else if (entry.isFile()) {
                            if (this.isSupportedFile(entry.name)) {
                                const stat = fs.statSync(entryAbsPath);
                                const ext = path.extname(entry.name).toLowerCase().replace(/^\./, '');
                                node.children!.push({
                                    name: entry.name,
                                    relativePath: entryRelPath,
                                    type: 'file',
                                    size: stat.size,
                                    extension: ext,
                                    mtime: new Date(stat.mtime).toISOString()
                                });
                                node.fileCount = (node.fileCount || 0) + 1;
                            }
                        }
                    } catch (entryErr) {
                        console.warn(`[BoundFolderReader] Failed to inspect entry ${entryAbsPath}:`, entryErr);
                    }
                }

                // フォルダを先頭、ファイルを後ろ、それぞれ名前順でソート
                node.children!.sort((a, b) => {
                    if (a.type !== b.type) {
                        return a.type === 'folder' ? -1 : 1;
                    }
                    return a.name.localeCompare(b.name, 'ja');
                });

            } catch (err) {
                console.error(`[BoundFolderReader] Failed to read directory ${currentAbsPath}:`, err);
            }

            return node;
        };

        return scanDir(path.resolve(basePath), '', 1);
    }

    /**
     * ツリー内の全ファイルをフラットな配列として抽出
     */
    static flattenTreeFiles(node: BoundFolderNode): Array<{ relativePath: string; name: string; size: number; extension: string; folder: string }> {
        const results: Array<{ relativePath: string; name: string; size: number; extension: string; folder: string }> = [];

        const traverse = (current: BoundFolderNode, currentFolder: string) => {
            if (current.type === 'file') {
                results.push({
                    relativePath: current.relativePath,
                    name: current.name,
                    size: current.size || 0,
                    extension: current.extension || '',
                    folder: currentFolder
                });
            } else if (current.type === 'folder' && current.children) {
                const nextFolder = current.relativePath;
                for (const child of current.children) {
                    traverse(child, nextFolder);
                }
            }
        };

        traverse(node, '');
        return results;
    }

    /**
     * 指定された相対パスのファイルを読み取り専用でロード（パストラバーサル防止）
     */
    static async readFile(basePath: string, relativePath: string): Promise<{ buffer: Buffer; fileName: string; size: number; mtime: string }> {
        const safeAbsPath = this.resolveSafePath(basePath, relativePath);

        if (!fs.existsSync(safeAbsPath)) {
            throw new Error(`ファイルが存在しません: ${relativePath}`);
        }

        const stat = fs.statSync(safeAbsPath);
        if (!stat.isFile()) {
            throw new Error(`指定されたパスはファイルではありません: ${relativePath}`);
        }

        const buffer = fs.readFileSync(safeAbsPath);
        return {
            buffer,
            fileName: path.basename(safeAbsPath),
            size: stat.size,
            mtime: new Date(stat.mtime).toISOString()
        };
    }

    /**
     * AIエージェントに渡すためのクリーンなインデント付きテキスト表現を生成
     * （※ セキュリティ: 外部フォルダのOS絶対パスは一切含めず、相対パス・ファイル数・サイズのみを出力）
     */
    static formatTreeForAgent(rootNode: BoundFolderNode, maxDisplayCount: number = 100): string {
        if (!rootNode || !rootNode.children || rootNode.children.length === 0) {
            return `(バインドフォルダ内に該当するドキュメントファイルはありません)`;
        }

        let lines: string[] = [];
        let count = 0;

        const formatNode = (node: BoundFolderNode, indent: string) => {
            if (count >= maxDisplayCount) return;

            if (node.type === 'folder') {
                if (node.relativePath) {
                    lines.push(`${indent}📁 ${node.name}/ (${node.fileCount || 0} files)`);
                }
                if (node.children) {
                    const nextIndent = node.relativePath ? indent + '  ' : indent;
                    for (const child of node.children) {
                        formatNode(child, nextIndent);
                    }
                }
            } else if (node.type === 'file') {
                count++;
                const sizeKb = node.size ? `${(node.size / 1024).toFixed(1)}KB` : '0KB';
                lines.push(`${indent}📄 ${node.name} [${node.relativePath}] (${sizeKb})`);
            }
        };

        formatNode(rootNode, '');

        if (count >= maxDisplayCount) {
            lines.push(`... 他 (表示上限 ${maxDisplayCount} 件に達しました)`);
        }

        return lines.join('\n');
    }
}
