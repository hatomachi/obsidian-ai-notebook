import { App, TFile, TFolder, FileSystemAdapter, Notice, setIcon, Modal } from 'obsidian';
import * as path from 'path';
import { NotebookSource } from '../types';

/**
 * 🛠️ デバッグ・実フォルダ連携支援ヘルパー
 * 
 * 【設計思想 - 将来外しやすい疎結合設計 (Detachable Architecture)】:
 * - デバッグ動線・切り分けログ・実フォルダ展開（Finder/Obsidian左ペイン）に関するロジックを本モジュールに完全カプセル化。
 * - 将来このデバッグ機能が不要になった際は、本ファイルを削除し、呼び出し元の数行を削除または設定トグルをOFFにするだけで、
 *   プラグイン本体のコアロジックに影響を与えずに安全に撤去可能です。
 */
export class DebugFolderHelper {
    /**
     * OSのファイルマネージャー (macOS Finder / Windows Explorer) で対象フォルダまたはファイルを開く
     */
    public static openInSystemExplorer(app: App, vaultRelativePath: string): boolean {
        try {
            const abstractFile = app.vault.getAbstractFileByPath(vaultRelativePath);
            
            // 1. Obsidian 組み込み API の利用
            if (abstractFile && typeof (app as any).showInFolder === 'function') {
                (app as any).showInFolder(abstractFile.path);
                return true;
            }

            // 2. Electron shell API の利用 (フルパス解決)
            if (app.vault.adapter instanceof FileSystemAdapter) {
                const basePath = app.vault.adapter.getBasePath();
                const fullPath = path.join(basePath, vaultRelativePath);
                
                // Electron の require
                const electron = typeof window !== 'undefined' && (window as any).require
                    ? (window as any).require('electron')
                    : null;

                if (electron?.shell) {
                    if (abstractFile instanceof TFolder) {
                        electron.shell.openPath(fullPath);
                    } else {
                        electron.shell.showItemInFolder(fullPath);
                    }
                    return true;
                }
            }

            new Notice(`📂 実パス: ${vaultRelativePath}`, 5000);
            return false;
        } catch (err) {
            console.error('[AI Notebook 🛠️ Debug] Failed to open in system explorer:', err);
            new Notice(`❌ フォルダ展開に失敗しました: ${err}`);
            return false;
        }
    }

    /**
     * Obsidian の左ペイン（File Explorer ツリー）で対象フォルダまたはファイルを自動展開・フォーカス
     */
    public static revealInObsidianExplorer(app: App, vaultRelativePath: string): boolean {
        try {
            const abstractFile = app.vault.getAbstractFileByPath(vaultRelativePath);
            if (!abstractFile) {
                new Notice(`⚠️ Vault内にファイルが見つかりません: ${vaultRelativePath}`);
                return false;
            }

            const leaves = app.workspace.getLeavesOfType('file-explorer');
            if (leaves.length > 0) {
                const fileExplorer = leaves[0].view as any;
                if (fileExplorer && typeof fileExplorer.revealInFolder === 'function') {
                    fileExplorer.revealInFolder(abstractFile);
                    app.workspace.revealLeaf(leaves[0]);
                    new Notice(`🔍 左ペインで表示: ${abstractFile.name}`, 3000);
                    return true;
                }
            }

            new Notice(`⚠️ ファイルエクスプローラーのペインが見つかりません`);
            return false;
        } catch (err) {
            console.error('[AI Notebook 🛠️ Debug] Failed to reveal in Obsidian explorer:', err);
            return false;
        }
    }

    /**
     * Obsidian のエディタタブでファイルを開く
     */
    public static async openInEditor(app: App, vaultRelativePath: string): Promise<boolean> {
        try {
            const file = app.vault.getAbstractFileByPath(vaultRelativePath);
            if (file instanceof TFile) {
                const leaf = app.workspace.getLeaf('tab');
                await leaf.openFile(file);
                return true;
            } else {
                new Notice(`⚠️ ファイルを開けません (非テキストまたは未存在): ${vaultRelativePath}`);
                return false;
            }
        } catch (err) {
            console.error('[AI Notebook 🛠️ Debug] Failed to open file in editor:', err);
            return false;
        }
    }

    /**
     * D&D・投入パイプラインの各ステップにおける構造化ログ出力 (DevToolsコンソール)
     */
    public static logPipelineStep(
        fileName: string,
        stepNumber: number,
        stepName: string,
        message: string,
        data?: any
    ): void {
        const prefix = `[AI Notebook D&D] 📄 ${fileName} ▶ Step ${stepNumber}: [${stepName}]`;
        if (data !== undefined) {
            console.info(`%c${prefix} - ${message}`, 'color: #2b7fff; font-weight: bold;', data);
        } else {
            console.info(`%c${prefix} - ${message}`, 'color: #2b7fff; font-weight: bold;');
        }
    }

    /**
     * パイプライン失敗時の目立つエラーログ出力 (DevToolsコンソール)
     */
    public static logPipelineError(
        fileName: string,
        stepNumber: number,
        stepName: string,
        error: any,
        context?: any
    ): void {
        console.group(`%c[AI Notebook D&D ERROR] ❌ ${fileName} (Step ${stepNumber}: ${stepName})`, 'color: #ff4d4f; font-weight: bold; background: #fff1f0; padding: 2px 6px; border-radius: 4px;');
        console.error('Error Object:', error);
        console.error('Error Message:', error?.message || String(error));
        if (error?.stack) {
            console.error('Stack Trace:', error.stack);
        }
        if (context) {
            console.info('Context Information:', context);
        }
        console.groupEnd();
    }

    /**
     * ソースパネルヘッダー用デバッグボタングループの描画
     */
    public static renderHeaderDebugActions(
        container: HTMLElement,
        options: {
            app: App;
            sourcesPath: string;
        }
    ): void {
        const wrap = container.createDiv({ cls: 'ai-notebook-debug-header-actions' });

        // Finder で開くボタン
        const openFinderBtn = wrap.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-debug',
            text: ' 📂 実フォルダ (Finder)'
        });
        openFinderBtn.setAttribute('title', `OSファイルマネージャで実フォルダを開く\n(${options.sourcesPath})`);
        openFinderBtn.onclick = (e) => {
            e.stopPropagation();
            DebugFolderHelper.openInSystemExplorer(options.app, options.sourcesPath);
        };

        // Obsidian左ペインで表示ボタン
        const revealExplorerBtn = wrap.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-debug',
            text: ' 🔍 左ペインで表示'
        });
        revealExplorerBtn.setAttribute('title', `Obsidianの左ペイン（ファイルエクスプローラ）でフォルダを展開・選択`);
        revealExplorerBtn.onclick = (e) => {
            e.stopPropagation();
            DebugFolderHelper.revealInObsidianExplorer(options.app, options.sourcesPath);
        };
    }

    /**
     * 各ソースファイルアイテム用のデバッグボタングループの描画
     */
    public static renderItemDebugActions(
        container: HTMLElement,
        options: {
            app: App;
            source: NotebookSource;
            notebookId: string;
            rootDir: string;
        }
    ): void {
        const { app, source, notebookId, rootDir } = options;
        const btnGroup = container.createDiv({ cls: 'ai-notebook-debug-item-actions' });

        // 原本キャッシュのパス
        const rawCachePath = `${rootDir}/notebooks/${notebookId}/sources/.cache/${source.convertedFrom || source.name}`;
        const targetPath = source.path;

        // 1. 左ペインで表示ボタン
        const revealBtn = btnGroup.createEl('button', {
            cls: 'ai-notebook-item-debug-btn',
        });
        setIcon(revealBtn, 'folder-search');
        revealBtn.setAttribute('title', '左ペインのエクスプローラでフォーカス');
        revealBtn.onclick = (e) => {
            e.stopPropagation();
            DebugFolderHelper.revealInObsidianExplorer(app, targetPath);
        };

        // 2. OSのFinderで開くボタン
        const finderBtn = btnGroup.createEl('button', {
            cls: 'ai-notebook-item-debug-btn',
        });
        setIcon(finderBtn, 'folder');
        finderBtn.setAttribute('title', 'OSのFinder/エクスプローラーで表示');
        finderBtn.onclick = (e) => {
            e.stopPropagation();
            // 原本が .cache に存在すれば原本をフォーカス、無ければ変換後Markdownをフォーカス
            const rawFile = app.vault.getAbstractFileByPath(rawCachePath);
            if (rawFile) {
                DebugFolderHelper.openInSystemExplorer(app, rawCachePath);
            } else {
                DebugFolderHelper.openInSystemExplorer(app, targetPath);
            }
        };

        // 3. デバッグ診断詳細ボタン
        const infoBtn = btnGroup.createEl('button', {
            cls: 'ai-notebook-item-debug-btn',
        });
        setIcon(infoBtn, 'info');
        infoBtn.setAttribute('title', '変換デバッグ情報 & ファイルパス確認');
        infoBtn.onclick = (e) => {
            e.stopPropagation();
            new DebugDetailModal(app, {
                fileName: source.name,
                filePath: source.path,
                convertedFrom: source.convertedFrom,
                rawCachePath,
                fileSize: source.size,
                transcriptionError: source.transcriptionError,
                addedAt: source.addedAt
            }).open();
        };
    }
}

/**
 * 🛠️ デバッグ診断モーダル
 */
export class DebugDetailModal extends Modal {
    private details: {
        fileName: string;
        filePath: string;
        convertedFrom?: string;
        rawCachePath: string;
        fileSize?: number;
        transcriptionError?: any;
        addedAt: string;
    };

    constructor(app: App, details: any) {
        super(app);
        this.details = details;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-notebook-debug-modal');

        contentEl.createEl('h2', { text: `🛠️ デバッグ診断情報: ${this.details.fileName}` });

        const table = contentEl.createEl('table', { cls: 'ai-notebook-debug-table' });
        
        const addRow = (label: string, value: string, isCode: boolean = false, copyable: boolean = false) => {
            const tr = table.createEl('tr');
            tr.createEl('th', { text: label });
            const td = tr.createEl('td');
            if (isCode) {
                const code = td.createEl('code', { text: value });
                if (copyable) {
                    const copyBtn = td.createEl('button', { cls: 'ai-notebook-debug-copy-btn', text: '📋' });
                    copyBtn.onclick = async () => {
                        await navigator.clipboard.writeText(value);
                        new Notice('パスをコピーしました');
                    };
                }
            } else {
                td.setText(value);
            }
        };

        addRow('ファイル名', this.details.fileName);
        addRow('Vault内相対パス', this.details.filePath, true, true);
        
        if (this.app.vault.adapter instanceof FileSystemAdapter) {
            const absPath = path.join(this.app.vault.adapter.getBasePath(), this.details.filePath);
            addRow('OS絶対パス', absPath, true, true);
        }

        if (this.details.convertedFrom) {
            addRow('変換元 (原本)', this.details.convertedFrom);
            addRow('原本キャッシュパス', this.details.rawCachePath, true, true);
            if (this.app.vault.adapter instanceof FileSystemAdapter) {
                const rawAbs = path.join(this.app.vault.adapter.getBasePath(), this.details.rawCachePath);
                addRow('原本OS絶対パス', rawAbs, true, true);
            }
        }

        addRow('サイズ', `${this.details.fileSize ?? 0} bytes`);
        addRow('追加日時', new Date(this.details.addedAt).toLocaleString());

        if (this.details.transcriptionError) {
            const errorBox = contentEl.createDiv({ cls: 'ai-notebook-debug-error-box' });
            errorBox.createEl('h3', { text: '⚠️ 変換エラー詳細' });
            errorBox.createEl('pre', { text: JSON.stringify(this.details.transcriptionError, null, 2) });
        }

        const actionRow = contentEl.createDiv({ cls: 'ai-notebook-debug-modal-actions' });
        const openFinderBtn = actionRow.createEl('button', { text: '📂 Finder で開く', cls: 'ai-notebook-btn ai-notebook-btn-primary' });
        openFinderBtn.onclick = () => {
            DebugFolderHelper.openInSystemExplorer(this.app, this.details.filePath);
        };

        const revealBtn = actionRow.createEl('button', { text: '🔍 左ペインで表示', cls: 'ai-notebook-btn ai-notebook-btn-secondary' });
        revealBtn.onclick = () => {
            DebugFolderHelper.revealInObsidianExplorer(this.app, this.details.filePath);
        };
    }
}
