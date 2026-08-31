import { App, Modal, Setting, Notice, setIcon } from 'obsidian';
import { NotebookManager } from '../../services/NotebookManager';
import { BoundFolderReader, BoundFolderNode } from '../../services/BoundFolderReader';
import * as path from 'path';

export class BoundFolderExplorerModal extends Modal {
    notebookManager: NotebookManager;
    notebookId: string;
    boundFolderPath: string;
    onCompleted: () => void;

    treeRoot: BoundFolderNode | null = null;
    selectedRelativePaths: Set<string> = new Set();
    isLoading: boolean = true;
    isExtracting: boolean = false;

    constructor(
        app: App,
        notebookManager: NotebookManager,
        notebookId: string,
        boundFolderPath: string,
        onCompleted: () => void
    ) {
        super(app);
        this.notebookManager = notebookManager;
        this.notebookId = notebookId;
        this.boundFolderPath = boundFolderPath;
        this.onCompleted = onCompleted;
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-notebook-bound-folder-modal');

        this.renderHeader(contentEl);

        const bodyEl = contentEl.createDiv({ cls: 'ai-notebook-explorer-body' });

        try {
            bodyEl.createDiv({ text: 'フォルダツリーを走査中...', cls: 'ai-notebook-loading-text' });
            this.treeRoot = await BoundFolderReader.listTree(this.boundFolderPath);
            this.isLoading = false;
            this.renderTree(bodyEl);
        } catch (e: any) {
            bodyEl.empty();
            bodyEl.createDiv({ 
                text: `フォルダの読み込みに失敗しました: ${e.message}`, 
                cls: 'ai-notebook-error-text' 
            });
            console.error('[BoundFolderExplorerModal] Failed to list tree:', e);
        }
    }

    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv({ cls: 'ai-notebook-modal-header' });
        header.createEl('h2', { text: '📁 外部フォルダ探索 & 一括取り込み (Extract)' });
        
        const pathInfo = header.createDiv({ cls: 'ai-notebook-explorer-path-info' });
        const iconSpan = pathInfo.createSpan({ cls: 'ai-notebook-explorer-path-icon' });
        setIcon(iconSpan, 'folder');
        pathInfo.createSpan({ text: ` ${this.boundFolderPath}`, cls: 'ai-notebook-explorer-path-text' });
    }

    private renderTree(container: HTMLElement): void {
        container.empty();

        if (!this.treeRoot || !this.treeRoot.children || this.treeRoot.children.length === 0) {
            container.createDiv({ text: '対象となるドキュメントファイルが見つかりませんでした。', cls: 'ai-notebook-empty-text' });
            return;
        }

        const toolbar = container.createDiv({ cls: 'ai-notebook-explorer-toolbar' });
        
        const countSpan = toolbar.createSpan({ 
            text: `選択中: ${this.selectedRelativePaths.size} 件`,
            cls: 'ai-notebook-explorer-selected-count' 
        });

        const btnGroup = toolbar.createDiv({ cls: 'ai-notebook-explorer-btn-group' });
        
        const selectAllBtn = btnGroup.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-xs',
            text: '全選択'
        });
        selectAllBtn.onclick = () => {
            if (!this.treeRoot) return;
            const flat = BoundFolderReader.flattenTreeFiles(this.treeRoot);
            for (const f of flat) {
                this.selectedRelativePaths.add(f.relativePath);
            }
            this.renderTree(container);
        };

        const clearAllBtn = btnGroup.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-xs',
            text: '選択解除'
        });
        clearAllBtn.onclick = () => {
            this.selectedRelativePaths.clear();
            this.renderTree(container);
        };

        const treeWrap = container.createDiv({ cls: 'ai-notebook-explorer-tree-wrap' });

        const renderNode = (node: BoundFolderNode, parentEl: HTMLElement, level: number) => {
            const row = parentEl.createDiv({ cls: `ai-notebook-tree-node ai-notebook-tree-node-${node.type}` });
            row.style.paddingLeft = `${level * 18}px`;

            if (node.type === 'folder') {
                const folderHeader = row.createDiv({ cls: 'ai-notebook-tree-folder-header' });
                
                // フォルダ配下の全ファイル取得
                const folderFiles = BoundFolderReader.flattenTreeFiles(node);
                const isAllSelected = folderFiles.length > 0 && folderFiles.every(f => this.selectedRelativePaths.has(f.relativePath));
                const isPartiallySelected = !isAllSelected && folderFiles.some(f => this.selectedRelativePaths.has(f.relativePath));

                const checkbox = folderHeader.createEl('input', { type: 'checkbox' });
                checkbox.checked = isAllSelected;
                checkbox.indeterminate = isPartiallySelected;

                checkbox.onchange = (e) => {
                    e.stopPropagation();
                    const check = checkbox.checked;
                    for (const f of folderFiles) {
                        if (check) {
                            this.selectedRelativePaths.add(f.relativePath);
                        } else {
                            this.selectedRelativePaths.delete(f.relativePath);
                        }
                    }
                    this.renderTree(container);
                };

                const icon = folderHeader.createSpan({ cls: 'ai-notebook-tree-icon' });
                setIcon(icon, 'folder');

                const nameSpan = folderHeader.createSpan({ text: node.name, cls: 'ai-notebook-tree-folder-name' });
                folderHeader.createSpan({ text: ` (${node.fileCount || 0})`, cls: 'ai-notebook-tree-count-badge' });

                const childrenContainer = parentEl.createDiv({ cls: 'ai-notebook-tree-children' });

                if (node.children) {
                    for (const child of node.children) {
                        renderNode(child, childrenContainer, level + 1);
                    }
                }
            } else if (node.type === 'file') {
                const fileHeader = row.createDiv({ cls: 'ai-notebook-tree-file-header' });
                
                const checkbox = fileHeader.createEl('input', { type: 'checkbox' });
                checkbox.checked = this.selectedRelativePaths.has(node.relativePath);

                checkbox.onchange = (e) => {
                    e.stopPropagation();
                    if (checkbox.checked) {
                        this.selectedRelativePaths.add(node.relativePath);
                    } else {
                        this.selectedRelativePaths.delete(node.relativePath);
                    }
                    countSpan.setText(`選択中: ${this.selectedRelativePaths.size} 件`);
                };

                const icon = fileHeader.createSpan({ cls: 'ai-notebook-tree-icon' });
                setIcon(icon, this.getFileIcon(node.extension || ''));

                const nameSpan = fileHeader.createSpan({ text: node.name, cls: 'ai-notebook-tree-file-name' });
                const sizeKb = node.size ? `${(node.size / 1024).toFixed(1)} KB` : '';
                if (sizeKb) {
                    fileHeader.createSpan({ text: sizeKb, cls: 'ai-notebook-tree-file-size' });
                }

                row.onclick = (e) => {
                    if (e.target !== checkbox) {
                        checkbox.checked = !checkbox.checked;
                        checkbox.dispatchEvent(new Event('change'));
                    }
                };
            }
        };

        if (this.treeRoot.children) {
            for (const child of this.treeRoot.children) {
                renderNode(child, treeWrap, 0);
            }
        }

        // アクションフッター
        const footer = container.createDiv({ cls: 'ai-notebook-modal-footer' });
        
        const extractBtn = footer.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-primary',
            text: `📦 選択項目を一括取り込み (${this.selectedRelativePaths.size} 件)`
        });
        if (this.selectedRelativePaths.size === 0 || this.isExtracting) {
            extractBtn.disabled = true;
        }

        extractBtn.onclick = async () => {
            if (this.selectedRelativePaths.size === 0 || this.isExtracting) return;

            this.isExtracting = true;
            extractBtn.disabled = true;
            extractBtn.setText('取り込み & Markdown変換中...');

            try {
                const targetPaths = Array.from(this.selectedRelativePaths);
                const result = await this.notebookManager.extractFromBoundFolder(this.notebookId, targetPaths);
                
                if (result.errors.length > 0) {
                    new Notice(`${result.importedCount} 件のファイルを取り込みました（${result.errors.length} 件のエラー）`);
                } else {
                    new Notice(`${result.importedCount} 件のファイルを取り込み、Markdownに変換しました`);
                }

                this.onCompleted();
                this.close();
            } catch (err: any) {
                console.error('[BoundFolderExplorerModal] Extract failed:', err);
                new Notice(`取り込みに失敗しました: ${err.message}`);
                this.isExtracting = false;
                extractBtn.disabled = false;
                extractBtn.setText(`📦 選択項目を一括取り込み (${this.selectedRelativePaths.size} 件)`);
            }
        };

        const cancelBtn = footer.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-secondary',
            text: '閉じる'
        });
        cancelBtn.onclick = () => this.close();
    }

    private getFileIcon(ext: string): string {
        switch (ext.toLowerCase()) {
            case 'xlsx':
            case 'xls':
            case 'xlsm':
            case 'csv':
                return 'table';
            case 'pptx':
            case 'ppt':
                return 'presentation';
            case 'docx':
            case 'doc':
                return 'file-text';
            case 'pdf':
                return 'file-text';
            case 'md':
            case 'markdown':
            case 'txt':
                return 'file-text';
            default:
                return 'file';
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
