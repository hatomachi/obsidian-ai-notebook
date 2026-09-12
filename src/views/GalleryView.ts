import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type AINotebookPlugin from '../main';
import { NotebookMetadata } from '../types';
import { CreateNotebookModal } from './modals/CreateNotebookModal';

export const VIEW_TYPE_GALLERY = 'ai-notebook-gallery';

export type TerritoryFilter = 'all' | 'mine' | 'others';

export class AINotebookGalleryView extends ItemView {
    plugin: AINotebookPlugin;
    notebooks: NotebookMetadata[] = [];
    searchQuery: string = '';
    filterMode: TerritoryFilter = 'all';

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

        // 2. コントロールバー（検索 ＆ 縄張りフィルタータブ）
        const controlsContainer = container.createDiv({ cls: 'ai-notebook-gallery-controls' });

        const searchContainer = controlsContainer.createDiv({ cls: 'ai-notebook-search-container' });
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

        // 縄張りフィルタータブ
        const currentUser = this.plugin.notebookManager.getEffectiveUsername();
        const myCount = this.notebooks.filter(nb => nb.userName === currentUser).length;
        const othersCount = this.notebooks.filter(nb => nb.userName !== currentUser).length;
        const allCount = this.notebooks.length;

        const filterBar = controlsContainer.createDiv({ cls: 'ai-notebook-territory-filter-bar' });

        const tabs: { key: TerritoryFilter; label: string; count: number }[] = [
            { key: 'all', label: 'すべて', count: allCount },
            { key: 'mine', label: `👤 自分 (${currentUser})`, count: myCount },
            { key: 'others', label: '👥 チーム共有', count: othersCount }
        ];

        for (const tab of tabs) {
            const tabBtn = filterBar.createEl('button', {
                cls: `ai-notebook-filter-tab ${this.filterMode === tab.key ? 'is-active' : ''}`
            });
            tabBtn.createSpan({ text: tab.label, cls: 'ai-notebook-filter-tab-text' });
            tabBtn.createSpan({ text: `${tab.count}`, cls: 'ai-notebook-filter-tab-count' });
            tabBtn.onclick = () => {
                this.filterMode = tab.key;
                this.render();
            };
        }

        // 3. カードグリッド
        const gridEl = container.createDiv({ cls: 'ai-notebook-grid' });
        this.renderGrid(gridEl);
    }

    private renderGrid(gridEl: HTMLElement): void {
        gridEl.empty();
        const currentUser = this.plugin.notebookManager.getEffectiveUsername();

        const filtered = this.notebooks.filter(nb => {
            // 縄張りフィルター
            if (this.filterMode === 'mine' && nb.userName !== currentUser) {
                return false;
            }
            if (this.filterMode === 'others' && nb.userName === currentUser) {
                return false;
            }

            // 検索クエリフィルター
            if (!this.searchQuery) return true;
            const q = this.searchQuery.toLowerCase();
            return (
                nb.title.toLowerCase().includes(q) ||
                nb.description.toLowerCase().includes(q) ||
                (nb.userName && nb.userName.toLowerCase().includes(q))
            );
        });

        // 新規作成カード（「すべて」または「自分」フィルター時のみ表示）
        if (this.filterMode !== 'others') {
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
        }

        // 既存ノートブックカード群
        for (const nb of filtered) {
            const isMine = nb.userName === currentUser;
            const isLegacy = !nb.userName;
            const isOthers = !isMine && !isLegacy;

            const card = gridEl.createDiv({ cls: `ai-notebook-card ${isMine ? 'is-my-territory' : 'is-shared-territory'}` });
            
            // カードヘッダー
            const cardHeader = card.createDiv({ cls: 'ai-notebook-card-header' });
            const iconArea = cardHeader.createDiv({ cls: 'ai-notebook-card-icon-area' });
            const cardIcon = iconArea.createDiv({ cls: 'ai-notebook-card-icon' });
            setIcon(cardIcon, nb.icon || 'book-open');

            // 👤 ユーザー・縄張りバッジ
            const userBadge = iconArea.createSpan({
                cls: `ai-notebook-user-badge ${isMine ? 'is-mine' : isLegacy ? 'is-legacy' : 'is-others'}`
            });
            if (isMine) {
                setIcon(userBadge.createSpan({ cls: 'ai-notebook-user-icon' }), 'user');
                userBadge.createSpan({ text: ' 自分' });
            } else if (isOthers) {
                setIcon(userBadge.createSpan({ cls: 'ai-notebook-user-icon' }), 'users');
                userBadge.createSpan({ text: ` @${nb.userName}` });
            } else {
                setIcon(userBadge.createSpan({ cls: 'ai-notebook-user-icon' }), 'globe');
                userBadge.createSpan({ text: ' 共有' });
            }

            const cardActions = cardHeader.createDiv({ cls: 'ai-notebook-card-actions' });

            // 他人ノートブックの場合：フォークボタン
            if (isOthers) {
                const forkBtn = cardActions.createEl('button', { cls: 'ai-notebook-card-action-btn' });
                setIcon(forkBtn, 'git-fork');
                forkBtn.setAttribute('title', '自分の縄張りにフォークして複製');
                forkBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (confirm(`ノートブック "${nb.title}" を自分の縄張りにフォークしますか？`)) {
                        const forked = await this.plugin.notebookManager.forkNotebook(nb.id);
                        await this.refresh();
                        if (this.onSelectNotebookHandler) {
                            this.onSelectNotebookHandler(forked.id);
                        }
                    }
                };
            }

            // レガシーノートブックの場合：縄張り移行ボタン
            if (isLegacy) {
                const migrateBtn = cardActions.createEl('button', { cls: 'ai-notebook-card-action-btn' });
                setIcon(migrateBtn, 'folder-symlink');
                migrateBtn.setAttribute('title', '自分の縄張りに移行 (Migrate)');
                migrateBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (confirm(`ノートブック "${nb.title}" を自分の縄張り (users/${currentUser}/) に移行しますか？`)) {
                        await this.plugin.notebookManager.migrateNotebookToUser(nb.id);
                        await this.refresh();
                    }
                };
            }

            // 削除ボタン（自分の縄張りまたはレガシーのみ）
            if (isMine || isLegacy) {
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
            }

            // タイトル・説明
            card.createEl('h3', { text: nb.title, cls: 'ai-notebook-card-title' });
            if (nb.description) {
                card.createEl('p', { text: nb.description, cls: 'ai-notebook-card-desc' });
            } else {
                card.createEl('p', { text: '説明なし', cls: 'ai-notebook-card-desc ai-notebook-card-desc-empty' });
            }

            // 参照ノートブック & タグバッジ
            if ((nb.linkedNotebookIds && nb.linkedNotebookIds.length > 0) || nb.systemId || nb.templateId) {
                const badgesEl = card.createDiv({ cls: 'ai-notebook-card-badges' });
                if (nb.linkedNotebookIds && nb.linkedNotebookIds.length > 0) {
                    const linkBadge = badgesEl.createSpan({ cls: 'ai-notebook-tag-badge ai-notebook-tag-linked' });
                    setIcon(linkBadge.createSpan({ cls: 'ai-notebook-tag-icon' }), 'link');
                    linkBadge.createSpan({ text: `参照 ${nb.linkedNotebookIds.length}件` });
                }
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
