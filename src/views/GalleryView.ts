import { ItemView, WorkspaceLeaf, setIcon, Notice } from 'obsidian';
import type AINotebookPlugin from '../main';
import { NotebookMetadata, GalleryGroupingMode } from '../types';
import { CreateNotebookModal } from './modals/CreateNotebookModal';
import {
    parseTag,
    getSystemTag,
    getTypeTag,
    extractUniqueSystems,
    extractUniqueTypes,
    extractUniqueGeneralTags,
    groupNotebooks,
    filterNotebooks,
    UNCLASSIFIED_GROUP_NAME
} from '../utils/tagUtils';

export const VIEW_TYPE_GALLERY = 'ai-notebook-gallery';

export type TerritoryFilter = 'all' | 'mine' | 'others';

export class AINotebookGalleryView extends ItemView {
    plugin: AINotebookPlugin;
    notebooks: NotebookMetadata[] = [];
    searchQuery: string = '';
    filterMode: TerritoryFilter = 'all';

    // 🏷️ タグ・ファセットフィルター状態
    filterSystem: string = 'all';
    filterType: string = 'all';
    selectedTags: Set<string> = new Set();
    groupingMode: GalleryGroupingMode = 'none';

    // アコーディオン折りたたみ状態
    collapsedGroups: Set<string> = new Set();

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

        // 2. コントロールバー（検索 ＆ 縄張りフィルタータブ ＆ ファセットフィルター ＆ グルーピング）
        const controlsContainer = container.createDiv({ cls: 'ai-notebook-gallery-controls' });

        // 上段: 検索窓 ＆ 縄張りフィルタータブ
        const topRow = controlsContainer.createDiv({ cls: 'ai-notebook-gallery-controls-top' });

        const searchContainer = topRow.createDiv({ cls: 'ai-notebook-search-container' });
        const searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: 'ノートブックを検索 (タイトル・説明・タグ)...',
            cls: 'ai-notebook-search-input'
        });
        searchInput.value = this.searchQuery;
        searchInput.oninput = (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value;
            this.renderGrid(gridWrapper);
        };

        // 縄張りフィルタータブ
        const currentUser = this.plugin.notebookManager.getEffectiveUsername();
        const myCount = this.notebooks.filter(nb => nb.userName === currentUser).length;
        const othersCount = this.notebooks.filter(nb => nb.userName !== currentUser).length;
        const allCount = this.notebooks.length;

        const filterBar = topRow.createDiv({ cls: 'ai-notebook-territory-filter-bar' });

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

        // 下段: ファセットフィルター（システム・種別）＆ グルーピング切替
        const facetRow = controlsContainer.createDiv({ cls: 'ai-notebook-gallery-facets-row' });

        // システム抽出・セレクト
        const systems = extractUniqueSystems(this.notebooks);
        const sysFilterWrap = facetRow.createDiv({ cls: 'ai-notebook-facet-select-wrap' });
        sysFilterWrap.createSpan({ text: '🏷️ システム:', cls: 'ai-notebook-facet-label' });
        const sysSelect = sysFilterWrap.createEl('select', { cls: 'ai-notebook-facet-select' });
        sysSelect.createEl('option', { value: 'all', text: 'すべて' });
        for (const sys of systems) {
            const opt = sysSelect.createEl('option', { value: sys, text: sys });
            if (sys === this.filterSystem) opt.selected = true;
        }
        sysSelect.onchange = () => {
            this.filterSystem = sysSelect.value;
            this.render();
        };

        // 種別抽出・セレクト
        const types = extractUniqueTypes(this.notebooks);
        const typeFilterWrap = facetRow.createDiv({ cls: 'ai-notebook-facet-select-wrap' });
        typeFilterWrap.createSpan({ text: '📄 種別:', cls: 'ai-notebook-facet-label' });
        const typeSelect = typeFilterWrap.createEl('select', { cls: 'ai-notebook-facet-select' });
        typeSelect.createEl('option', { value: 'all', text: 'すべて' });
        for (const t of types) {
            const opt = typeSelect.createEl('option', { value: t, text: t });
            if (t === this.filterType) opt.selected = true;
        }
        typeSelect.onchange = () => {
            this.filterType = typeSelect.value;
            this.render();
        };

        // グルーピングモード切替
        const groupWrap = facetRow.createDiv({ cls: 'ai-notebook-facet-group-wrap' });
        groupWrap.createSpan({ text: '表示:', cls: 'ai-notebook-facet-label' });
        const groupSelect = groupWrap.createEl('select', { cls: 'ai-notebook-facet-select' });
        const groupOptions: { value: GalleryGroupingMode; label: string }[] = [
            { value: 'none', label: '⊞ フラット一覧' },
            { value: 'system', label: '🏷️ システム別グループ' },
            { value: 'type', label: '📄 種別別グループ' }
        ];
        for (const opt of groupOptions) {
            const optEl = groupSelect.createEl('option', { value: opt.value, text: opt.label });
            if (opt.value === this.groupingMode) optEl.selected = true;
        }
        groupSelect.onchange = () => {
            this.groupingMode = groupSelect.value as GalleryGroupingMode;
            this.renderGrid(gridWrapper);
        };

        // アクティブフィルターのチップ行（フィルターが適用されている場合のみ表示）
        const hasActiveFilters = this.filterSystem !== 'all' || this.filterType !== 'all' || this.selectedTags.size > 0;
        if (hasActiveFilters) {
            const activeChipsRow = controlsContainer.createDiv({ cls: 'ai-notebook-active-chips-row' });
            activeChipsRow.createSpan({ text: '適用中フィルター:', cls: 'ai-notebook-active-chips-label' });

            if (this.filterSystem !== 'all') {
                const chip = activeChipsRow.createSpan({ cls: 'ai-notebook-active-chip is-system' });
                chip.createSpan({ text: `🏷️ system/${this.filterSystem}` });
                const closeBtn = chip.createSpan({ cls: 'ai-notebook-active-chip-close', text: '✕' });
                closeBtn.onclick = () => {
                    this.filterSystem = 'all';
                    this.render();
                };
            }

            if (this.filterType !== 'all') {
                const chip = activeChipsRow.createSpan({ cls: 'ai-notebook-active-chip is-type' });
                chip.createSpan({ text: `📄 type/${this.filterType}` });
                const closeBtn = chip.createSpan({ cls: 'ai-notebook-active-chip-close', text: '✕' });
                closeBtn.onclick = () => {
                    this.filterType = 'all';
                    this.render();
                };
            }

            for (const tag of this.selectedTags) {
                const chip = activeChipsRow.createSpan({ cls: 'ai-notebook-active-chip is-general' });
                chip.createSpan({ text: `#${tag}` });
                const closeBtn = chip.createSpan({ cls: 'ai-notebook-active-chip-close', text: '✕' });
                closeBtn.onclick = () => {
                    this.selectedTags.delete(tag);
                    this.render();
                };
            }

            // 全解除ボタン
            const clearAllBtn = activeChipsRow.createEl('button', {
                cls: 'ai-notebook-active-chips-clear',
                text: 'すべて解除'
            });
            clearAllBtn.onclick = () => {
                this.filterSystem = 'all';
                this.filterType = 'all';
                this.selectedTags.clear();
                this.render();
            };
        }

        // 3. カードグリッドラッパー
        const gridWrapper = container.createDiv({ cls: 'ai-notebook-grid-wrapper' });
        this.renderGrid(gridWrapper);
    }

    private renderGrid(gridWrapper: HTMLElement): void {
        gridWrapper.empty();
        const currentUser = this.plugin.notebookManager.getEffectiveUsername();

        // 複合フィルタリング
        const filtered = filterNotebooks(this.notebooks, {
            searchQuery: this.searchQuery,
            territory: this.filterMode,
            currentUser,
            system: this.filterSystem,
            type: this.filterType,
            tags: Array.from(this.selectedTags)
        });

        // ヒット件数
        const countInfo = gridWrapper.createDiv({ cls: 'ai-notebook-grid-count-info' });
        countInfo.createSpan({ text: `${filtered.length} 件のノートブック` });

        // グルーピング処理
        const grouped = groupNotebooks(filtered, this.groupingMode);

        if (this.groupingMode === 'none') {
            // フラット表示
            const gridEl = gridWrapper.createDiv({ cls: 'ai-notebook-grid' });
            
            // 新規作成カード（「すべて」または「自分」フィルター時のみ表示）
            if (this.filterMode !== 'others') {
                this.renderNewCard(gridEl);
            }

            for (const nb of filtered) {
                this.renderNotebookCard(gridEl, nb, currentUser);
            }
        } else {
            // グループ別表示
            // 新規作成カードを先頭の独立エリアまたはグループ外に配置
            if (this.filterMode !== 'others') {
                const topActionArea = gridWrapper.createDiv({ cls: 'ai-notebook-group-top-action' });
                const newBtn = topActionArea.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-primary' });
                setIcon(newBtn, 'plus');
                newBtn.createSpan({ text: ' 新規ノートブック作成' });
                newBtn.onclick = () => {
                    new CreateNotebookModal(this.app, this.plugin.notebookManager, async (nb) => {
                        await this.refresh();
                        if (this.onSelectNotebookHandler) {
                            this.onSelectNotebookHandler(nb.id);
                        }
                    }).open();
                };
            }

            for (const [groupName, groupNotebooksList] of grouped.entries()) {
                const isCollapsed = this.collapsedGroups.has(groupName);
                const section = gridWrapper.createDiv({ cls: `ai-notebook-group-section ${isCollapsed ? 'is-collapsed' : ''}` });

                // グループヘッダー（クリックで開閉トグル）
                const sectionHeader = section.createDiv({ cls: 'ai-notebook-group-header' });
                
                const toggleIcon = sectionHeader.createSpan({ cls: 'ai-notebook-group-toggle-icon' });
                setIcon(toggleIcon, isCollapsed ? 'chevron-right' : 'chevron-down');

                const groupIcon = sectionHeader.createSpan({ cls: 'ai-notebook-group-icon' });
                if (this.groupingMode === 'system') {
                    setIcon(groupIcon, groupName === UNCLASSIFIED_GROUP_NAME ? 'help-circle' : 'cpu');
                } else {
                    setIcon(groupIcon, groupName === UNCLASSIFIED_GROUP_NAME ? 'help-circle' : 'file-text');
                }

                sectionHeader.createSpan({ text: groupName, cls: 'ai-notebook-group-title' });
                sectionHeader.createSpan({ text: `${groupNotebooksList.length}`, cls: 'ai-notebook-group-count' });

                sectionHeader.onclick = () => {
                    if (this.collapsedGroups.has(groupName)) {
                        this.collapsedGroups.delete(groupName);
                    } else {
                        this.collapsedGroups.add(groupName);
                    }
                    this.renderGrid(gridWrapper);
                };

                // セクション内グリッド
                if (!isCollapsed) {
                    const gridEl = section.createDiv({ cls: 'ai-notebook-grid' });
                    for (const nb of groupNotebooksList) {
                        this.renderNotebookCard(gridEl, nb, currentUser);
                    }
                }
            }
        }
    }

    private renderNewCard(gridEl: HTMLElement): void {
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

    private renderNotebookCard(gridEl: HTMLElement, nb: NotebookMetadata, currentUser: string): void {
        const isMine = nb.userName === currentUser;
        const isLegacy = !nb.userName;
        const isOthers = !isMine && !isLegacy;
        const isRemote = !!nb.isRemote;

        const card = gridEl.createDiv({
            cls: `ai-notebook-card ${isMine ? 'is-my-territory' : 'is-shared-territory'} ${isRemote ? 'is-remote-notebook' : ''}`
        });
        
        // カードヘッダー
        const cardHeader = card.createDiv({ cls: 'ai-notebook-card-header' });
        const iconArea = cardHeader.createDiv({ cls: 'ai-notebook-card-icon-area' });
        const cardIcon = iconArea.createDiv({ cls: 'ai-notebook-card-icon' });
        setIcon(cardIcon, nb.icon || 'book-open');

        // 👤 ユーザー・縄張りバッジ（クラウド時は水色バッジ＋クラウド表記）
        const userBadge = iconArea.createSpan({
            cls: `ai-notebook-user-badge ${isRemote ? 'is-remote' : isMine ? 'is-mine' : isLegacy ? 'is-legacy' : 'is-others'}`
        });
        if (isRemote) {
            setIcon(userBadge.createSpan({ cls: 'ai-notebook-user-icon' }), 'cloud');
            const suffix = isMine ? ' 自分 (クラウド)' : isOthers ? ` @${nb.userName} (クラウド)` : ' 共有 (クラウド)';
            userBadge.createSpan({ text: suffix });
        } else if (isMine) {
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

        // 自分のローカルノートブック：☁️ GitLab リポジトリに一括保存 (Push) ボタン
        if (isMine && !isRemote) {
            const syncBtn = cardActions.createEl('button', { cls: 'ai-notebook-card-action-btn' });
            setIcon(syncBtn, 'cloud-upload');
            syncBtn.setAttribute('title', 'GitLab リポジトリに保存 (一括Push)');
            syncBtn.onclick = async (e) => {
                e.stopPropagation();
                new Notice(`☁️ GitLab に保存中: "${nb.title}"...`);
                const res = await this.plugin.notebookManager.pushNotebookToGitLab(nb.id);
                if (res.success) {
                    new Notice(`✅ GitLab に保存しました: "${nb.title}"`);
                    await this.refresh();
                } else {
                    new Notice(`❌ GitLab 保存失敗: ${res.error || '不明なエラー'}`);
                }
            };
        }

        // 他人のノートブックまたはクラウドノートブックの場合：フォークボタン
        if (isOthers || isRemote) {
            const forkBtn = cardActions.createEl('button', { cls: 'ai-notebook-card-action-btn' });
            setIcon(forkBtn, 'git-fork');
            forkBtn.setAttribute('title', isRemote ? 'GitLab から自分の縄張りにフォークして実体化' : '自分の縄張りにフォークして複製');
            forkBtn.onclick = async (e) => {
                e.stopPropagation();
                const promptMsg = isRemote
                    ? `クラウド上のノートブック "${nb.title}" を自分の縄張りにフォーク（ダウンロード実体化）しますか？`
                    : `ノートブック "${nb.title}" を自分の縄張りにフォークしますか？`;
                if (confirm(promptMsg)) {
                    new Notice(`フォーク中: "${nb.title}"...`);
                    const forked = await this.plugin.notebookManager.forkNotebook(nb.id);
                    new Notice(`✅ フォーク完了: "${forked.title}"`);
                    await this.refresh();
                    if (this.onSelectNotebookHandler) {
                        this.onSelectNotebookHandler(forked.id);
                    }
                }
            };
        }

        // レガシーノートブックの場合：縄張り移行ボタン
        if (isLegacy && !isRemote) {
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

        // 削除ボタン（ローカルの自分の縄張りまたはローカルレガシーのみ）
        if (!isRemote && (isMine || isLegacy)) {
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

        // 🏷️ タグチップス & 参照ノートブックバッジ
        const badgesEl = card.createDiv({ cls: 'ai-notebook-card-badges' });

        // 参照リンク数バッジ
        if (nb.linkedNotebookIds && nb.linkedNotebookIds.length > 0) {
            const linkBadge = badgesEl.createSpan({ cls: 'ai-notebook-tag-badge ai-notebook-tag-linked' });
            setIcon(linkBadge.createSpan({ cls: 'ai-notebook-tag-icon' }), 'link');
            linkBadge.createSpan({ text: `参照 ${nb.linkedNotebookIds.length}件` });
        }

        // タグバッジ一覧（クリックでフィルター連動）
        if (nb.tags && nb.tags.length > 0) {
            for (const tag of nb.tags) {
                const parsed = parseTag(tag);
                let badgeClass = 'ai-notebook-tag-chip ai-notebook-tag-general';
                let badgePrefix = '#';

                if (parsed.isSystem) {
                    badgeClass = 'ai-notebook-tag-chip ai-notebook-tag-system';
                    badgePrefix = '🏷️ ';
                } else if (parsed.isType) {
                    badgeClass = 'ai-notebook-tag-chip ai-notebook-tag-type';
                    badgePrefix = '📄 ';
                }

                const chip = badgesEl.createSpan({ cls: badgeClass });
                chip.createSpan({ text: `${badgePrefix}${parsed.value}` });
                chip.setAttribute('title', `クリックして「${parsed.raw}」で絞り込み`);

                chip.onclick = (e) => {
                    e.stopPropagation();
                    if (parsed.isSystem) {
                        this.filterSystem = this.filterSystem === parsed.value ? 'all' : parsed.value;
                    } else if (parsed.isType) {
                        this.filterType = this.filterType === parsed.value ? 'all' : parsed.value;
                    } else {
                        if (this.selectedTags.has(parsed.value)) {
                            this.selectedTags.delete(parsed.value);
                        } else {
                            this.selectedTags.add(parsed.value);
                        }
                    }
                    this.render();
                };
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
