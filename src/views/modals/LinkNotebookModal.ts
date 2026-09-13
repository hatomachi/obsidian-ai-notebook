import { App, Modal, Setting, setIcon } from 'obsidian';
import { NotebookMetadata } from '../../types';
import { NotebookManager } from '../../services/NotebookManager';
import {
    parseTag,
    extractUniqueSystems,
    extractUniqueTypes,
    filterNotebooks
} from '../../utils/tagUtils';

export class LinkNotebookModal extends Modal {
    notebookManager: NotebookManager;
    currentNotebookId: string;
    onLinked: (selectedIds: string[]) => Promise<void>;

    private allNotebooks: NotebookMetadata[] = [];
    private currentlyLinkedIds: Set<string>;
    private selectedIds: Set<string>;
    private searchQuery: string = '';
    private filterSystem: string = 'all';
    private filterType: string = 'all';

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

        // 検索 ＆ ファセットフィルターバー
        const controlsContainer = contentEl.createDiv({ cls: 'ai-notebook-link-modal-controls' });

        const searchContainer = controlsContainer.createDiv({ cls: 'ai-notebook-search-container' });
        const searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: 'ノートブックを検索 (タイトル・説明・タグ)...',
            cls: 'ai-notebook-search-input',
            value: this.searchQuery
        });
        searchInput.oninput = () => {
            this.searchQuery = searchInput.value.toLowerCase().trim();
            this.renderList(listContainer);
        };

        // ファセットフィルター行（システム・種別）
        const facetRow = controlsContainer.createDiv({ cls: 'ai-notebook-link-facets-row' });

        const systems = extractUniqueSystems(this.allNotebooks);
        const sysWrap = facetRow.createDiv({ cls: 'ai-notebook-facet-select-wrap' });
        sysWrap.createSpan({ text: '🏷️ システム:', cls: 'ai-notebook-facet-label' });
        const sysSelect = sysWrap.createEl('select', { cls: 'ai-notebook-facet-select' });
        sysSelect.createEl('option', { value: 'all', text: 'すべて' });
        for (const s of systems) {
            const opt = sysSelect.createEl('option', { value: s, text: s });
            if (s === this.filterSystem) opt.selected = true;
        }
        sysSelect.onchange = () => {
            this.filterSystem = sysSelect.value;
            this.renderList(listContainer);
        };

        const types = extractUniqueTypes(this.allNotebooks);
        const typeWrap = facetRow.createDiv({ cls: 'ai-notebook-facet-select-wrap' });
        typeWrap.createSpan({ text: '📄 種別:', cls: 'ai-notebook-facet-label' });
        const typeSelect = typeWrap.createEl('select', { cls: 'ai-notebook-facet-select' });
        typeSelect.createEl('option', { value: 'all', text: 'すべて' });
        for (const t of types) {
            const opt = typeSelect.createEl('option', { value: t, text: t });
            if (t === this.filterType) opt.selected = true;
        }
        typeSelect.onchange = () => {
            this.filterType = typeSelect.value;
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

        const filtered = filterNotebooks(this.allNotebooks, {
            searchQuery: this.searchQuery,
            system: this.filterSystem,
            type: this.filterType
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
            
            // タイトル ＆ ユーザーバッジ
            const titleRow = textWrap.createDiv({ cls: 'ai-notebook-link-title-row' });
            titleRow.createEl('h4', { text: nb.title, cls: 'ai-notebook-link-title' });

            if (nb.userName) {
                const uBadge = titleRow.createSpan({ cls: 'ai-notebook-user-badge is-xs' });
                setIcon(uBadge.createSpan({ cls: 'ai-notebook-user-icon' }), 'user');
                uBadge.createSpan({ text: ` @${nb.userName}` });
            }

            if (nb.description) {
                textWrap.createEl('p', { text: nb.description, cls: 'ai-notebook-link-desc' });
            }

            // 🏷️ タグバッジ一覧
            if (nb.tags && nb.tags.length > 0) {
                const tagsRow = textWrap.createDiv({ cls: 'ai-notebook-link-tags-row' });
                for (const tag of nb.tags) {
                    const parsed = parseTag(tag);
                    let badgeCls = 'ai-notebook-tag-chip is-xs ai-notebook-tag-general';
                    let prefix = '#';
                    if (parsed.isSystem) {
                        badgeCls = 'ai-notebook-tag-chip is-xs ai-notebook-tag-system';
                        prefix = '🏷️ ';
                    } else if (parsed.isType) {
                        badgeCls = 'ai-notebook-tag-chip is-xs ai-notebook-tag-type';
                        prefix = '📄 ';
                    }
                    const chip = tagsRow.createSpan({ cls: badgeCls });
                    chip.createSpan({ text: `${prefix}${parsed.value}` });
                }
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
