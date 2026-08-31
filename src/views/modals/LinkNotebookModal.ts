import { App, Modal, Setting, setIcon } from 'obsidian';
import { NotebookMetadata } from '../../types';
import { NotebookManager } from '../../services/NotebookManager';

export class LinkNotebookModal extends Modal {
    notebookManager: NotebookManager;
    currentNotebookId: string;
    onLinked: (selectedIds: string[]) => Promise<void>;

    private allNotebooks: NotebookMetadata[] = [];
    private currentlyLinkedIds: Set<string>;
    private selectedIds: Set<string>;
    private searchQuery: string = '';

    constructor(
        app: App,
        notebookManager: NotebookManager,
        currentNotebookId: string,
        currentLinkedIds: string[],
        onLinked: (selectedIds: string[]) => Promise<void>
    ) {
        super(app);
        this.notebookManager = notebookManager;
        this.currentNotebookId = currentNotebookId;
        this.currentlyLinkedIds = new Set(currentLinkedIds);
        this.selectedIds = new Set(currentLinkedIds);
        this.onLinked = onLinked;
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-notebook-link-modal');

        this.allNotebooks = await this.notebookManager.getAllNotebooks();
        // 自分自身はリンク対象から除外
        this.allNotebooks = this.allNotebooks.filter(n => n.id !== this.currentNotebookId);

        this.render();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const headerEl = contentEl.createDiv({ cls: 'ai-notebook-modal-header' });
        headerEl.createEl('h2', { text: '🔗 参照ノートブック（コンテキスト）の選択' });
        headerEl.createEl('p', {
            text: '仕様書、フォーマットルール、過去の良質サンプルなどが格納されたノートブックをリンクして、AIエージェントのコンテキストとして利用します。',
            cls: 'ai-notebook-modal-desc'
        });

        // 検索バー
        const searchContainer = contentEl.createDiv({ cls: 'ai-notebook-search-container' });
        const searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: 'ノートブックを検索...',
            cls: 'ai-notebook-search-input',
            value: this.searchQuery
        });
        searchInput.oninput = () => {
            this.searchQuery = searchInput.value.toLowerCase().trim();
            this.renderList(listContainer);
        };

        const listContainer = contentEl.createDiv({ cls: 'ai-notebook-link-list-container' });
        this.renderList(listContainer);

        // フッターボタン
        const footer = contentEl.createDiv({ cls: 'ai-notebook-modal-footer' });
        
        const cancelBtn = footer.createEl('button', { text: 'キャンセル', cls: 'ai-notebook-btn ai-notebook-btn-secondary' });
        cancelBtn.onclick = () => this.close();

        const applyBtn = footer.createEl('button', {
            text: `適用 (${this.selectedIds.size} 件選択中)`,
            cls: 'ai-notebook-btn ai-notebook-btn-primary'
        });
        applyBtn.onclick = async () => {
            await this.onLinked(Array.from(this.selectedIds));
            this.close();
        };
    }

    private renderList(container: HTMLElement): void {
        container.empty();

        const filtered = this.allNotebooks.filter(nb => {
            if (!this.searchQuery) return true;
            return nb.title.toLowerCase().includes(this.searchQuery) ||
                nb.description.toLowerCase().includes(this.searchQuery) ||
                nb.tags.some(t => t.toLowerCase().includes(this.searchQuery));
        });

        if (filtered.length === 0) {
            container.createDiv({ text: '該当するノートブックがありません', cls: 'ai-notebook-empty-text' });
            return;
        }

        for (const nb of filtered) {
            const isSelected = this.selectedIds.has(nb.id);
            const item = container.createDiv({
                cls: `ai-notebook-link-item ${isSelected ? 'is-selected' : ''}`
            });

            const checkbox = item.createEl('input', {
                type: 'checkbox',
                cls: 'ai-notebook-link-checkbox'
            });
            checkbox.checked = isSelected;

            const iconSpan = item.createSpan({ cls: 'ai-notebook-link-icon' });
            setIcon(iconSpan, nb.icon || 'book-open');

            const textWrap = item.createDiv({ cls: 'ai-notebook-link-text-wrap' });
            textWrap.createEl('h4', { text: nb.title, cls: 'ai-notebook-link-title' });
            if (nb.description) {
                textWrap.createEl('p', { text: nb.description, cls: 'ai-notebook-link-desc' });
            }

            const toggle = () => {
                if (this.selectedIds.has(nb.id)) {
                    this.selectedIds.delete(nb.id);
                } else {
                    this.selectedIds.add(nb.id);
                }
                this.render();
            };

            item.onclick = (e) => {
                if (e.target !== checkbox) {
                    toggle();
                }
            };
            checkbox.onchange = () => toggle();
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
