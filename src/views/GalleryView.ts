import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type AINotebookPlugin from '../main';
import { NotebookMetadata } from '../types';
import { CreateNotebookModal } from './modals/CreateNotebookModal';

export const VIEW_TYPE_GALLERY = 'ai-notebook-gallery';

export class AINotebookGalleryView extends ItemView {
    plugin: AINotebookPlugin;
    notebooks: NotebookMetadata[] = [];
    searchQuery: string = '';

    onSelectNotebookHandler?: (notebookId: string) => void;

    constructor(leaf: WorkspaceLeaf, plugin: AINotebookPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_GALLERY;
    }

    getDisplayText(): string {
        return 'AI Notebooks';
    }

    getIcon(): string {
        return 'book-open';
    }

    async onOpen(): Promise<void> {
        await this.refresh();
    }

    async refresh(): Promise<void> {
        this.notebooks = await this.plugin.notebookManager.getAllNotebooks();
        this.render();
    }

    render(): void {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('ai-notebook-gallery-container');

        // 1. ヘッダー
        const header = container.createDiv({ cls: 'ai-notebook-gallery-header' });
        const titleArea = header.createDiv({ cls: 'ai-notebook-gallery-title-area' });
        
        const titleIcon = titleArea.createSpan({ cls: 'ai-notebook-gallery-title-icon' });
        setIcon(titleIcon, 'sparkles');

        titleArea.createEl('h1', { text: 'AI Notebooks', cls: 'ai-notebook-gallery-title' });

        const actions = header.createDiv({ cls: 'ai-notebook-gallery-actions' });
        
        // リフレッシュボタン
        const refreshBtn = actions.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-secondary' });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.setAttribute('title', '更新');
        refreshBtn.onclick = async () => await this.refresh();

        // 新規作成ボタン
        const createBtn = actions.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-primary' });
        setIcon(createBtn, 'plus');
        createBtn.createSpan({ text: ' 新しいノートブック' });
        createBtn.onclick = () => {
            new CreateNotebookModal(this.app, this.plugin.notebookManager, async (nb) => {
                await this.refresh();
                if (this.onSelectNotebookHandler) {
                    this.onSelectNotebookHandler(nb.id);
                }
            }).open();
        };

        // 2. 検索バー
        const searchContainer = container.createDiv({ cls: 'ai-notebook-search-container' });
        const searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: 'ノートブックを検索...',
            cls: 'ai-notebook-search-input'
        });
        searchInput.value = this.searchQuery;
        searchInput.oninput = (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value;
            this.renderGrid(gridEl);
        };

        // 3. カードグリッド
        const gridEl = container.createDiv({ cls: 'ai-notebook-grid' });
        this.renderGrid(gridEl);
    }

    private renderGrid(gridEl: HTMLElement): void {
        gridEl.empty();

        const filtered = this.notebooks.filter(nb =>
            nb.title.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
            nb.description.toLowerCase().includes(this.searchQuery.toLowerCase())
        );

        // 新規作成カード
        const newCard = gridEl.createDiv({ cls: 'ai-notebook-card ai-notebook-card-new' });
        const newIcon = newCard.createDiv({ cls: 'ai-notebook-card-new-icon' });
        setIcon(newIcon, 'plus');
        newCard.createDiv({ text: '新規ノートブック作成', cls: 'ai-notebook-card-new-label' });
        newCard.onclick = () => {
            new CreateNotebookModal(this.app, this.plugin.notebookManager, async (nb) => {
                await this.refresh();
                if (this.onSelectNotebookHandler) {
                    this.onSelectNotebookHandler(nb.id);
                }
            }).open();
        };

        // 既存ノートブックカード群
        for (const nb of filtered) {
            const card = gridEl.createDiv({ cls: 'ai-notebook-card' });
            
            // カードヘッダー
            const cardHeader = card.createDiv({ cls: 'ai-notebook-card-header' });
            const cardIcon = cardHeader.createDiv({ cls: 'ai-notebook-card-icon' });
            setIcon(cardIcon, nb.icon || 'book-open');

            const cardActions = cardHeader.createDiv({ cls: 'ai-notebook-card-actions' });
            const deleteBtn = cardActions.createEl('button', { cls: 'ai-notebook-card-delete-btn' });
            setIcon(deleteBtn, 'trash-2');
            deleteBtn.setAttribute('title', '削除');
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm(`ノートブック "${nb.title}" を削除してもよろしいですか？`)) {
                    await this.plugin.notebookManager.deleteNotebook(nb.id);
                    await this.refresh();
                }
            };

            // タイトル・説明
            card.createEl('h3', { text: nb.title, cls: 'ai-notebook-card-title' });
            if (nb.description) {
                card.createEl('p', { text: nb.description, cls: 'ai-notebook-card-desc' });
            } else {
                card.createEl('p', { text: '説明なし', cls: 'ai-notebook-card-desc ai-notebook-card-desc-empty' });
            }

            // システム & テンプレートバッジ
            if (nb.systemId || nb.templateId) {
                const badgesEl = card.createDiv({ cls: 'ai-notebook-card-badges' });
                if (nb.systemId) {
                    const sysBadge = badgesEl.createSpan({ cls: 'ai-notebook-tag-badge ai-notebook-tag-system' });
                    setIcon(sysBadge.createSpan({ cls: 'ai-notebook-tag-icon' }), 'cpu');
                    sysBadge.createSpan({ text: nb.systemId.toUpperCase() });
                }
                if (nb.templateId) {
                    const tplBadge = badgesEl.createSpan({ cls: 'ai-notebook-tag-badge ai-notebook-tag-template' });
                    setIcon(tplBadge.createSpan({ cls: 'ai-notebook-tag-icon' }), 'file-text');
                    tplBadge.createSpan({ text: nb.templateId });
                }
            }

            // フッター (更新日時)
            const cardFooter = card.createDiv({ cls: 'ai-notebook-card-footer' });
            const dateStr = new Date(nb.updatedAt).toLocaleDateString('ja-JP', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            cardFooter.createSpan({ text: dateStr, cls: 'ai-notebook-card-date' });

            // カードクリック時の遷移処理
            card.onclick = () => {
                if (this.onSelectNotebookHandler) {
                    this.onSelectNotebookHandler(nb.id);
                }
            };
        }
    }
}
