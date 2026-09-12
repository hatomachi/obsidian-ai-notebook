import { App, Modal, Notice } from 'obsidian';
import type AINotebookPlugin from '../../main';
import { NotebookManager } from '../../services/NotebookManager';
import { ConfluencePageSummary, ConfluenceServerConfig } from '../../types';
import { SearchHintsManager } from '../../services/SearchHintsManager';

export class ConfluenceSearchModal extends Modal {
    plugin: AINotebookPlugin;
    notebookId: string;
    notebookManager: NotebookManager;
    onImportCallback?: () => void;

    private notebookDir: string = '';
    private selectedServerId: string = '';
    private query: string = '';
    private customCql: string = '';
    private isCustomCql: boolean = false;
    private searchResults: ConfluencePageSummary[] = [];
    private selectedPageIds: Set<string> = new Set();
    private isSearching: boolean = false;
    private isImporting: boolean = false;

    // 学習用フィールド
    private learnFeedback: boolean = true;
    private learnTopic: string = '';
    private learnAncestorId: string = '';
    private learnAncestorTitle: string = '';
    private learnGuidance: string = '';

    constructor(
        app: App,
        plugin: AINotebookPlugin,
        notebookId: string,
        notebookManager: NotebookManager,
        onImportCallback?: () => void
    ) {
        super(app);
        this.plugin = plugin;
        this.notebookId = notebookId;
        this.notebookManager = notebookManager;
        this.onImportCallback = onImportCallback;

        const defaultServer = (this.plugin as any).confluenceService?.getServer();
        this.selectedServerId = defaultServer?.id || '';
    }

    async onOpen(): Promise<void> {
        this.notebookDir = await this.notebookManager.getNotebookDir(this.notebookId);
        this.render();
    }

    private get currentServer(): ConfluenceServerConfig | undefined {
        return (this.plugin as any).confluenceService?.getServer(this.selectedServerId);
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-notebook-modal', 'ai-notebook-confluence-search-modal');

        // モーダルのスタイル調整
        contentEl.style.maxWidth = '780px';
        contentEl.style.maxHeight = '85vh';
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';

        // ヘッダー
        const headerEl = contentEl.createDiv({ cls: 'ai-notebook-modal-header', attr: { style: 'margin-bottom: 12px;' } });
        headerEl.createEl('h2', { text: '🌐 Confluence オンデマンド抽出 & ナレッジ精錬' });

        const servers = (this.plugin as any).confluenceService?.getServers() || [];
        if (servers.length === 0) {
            const emptyEl = contentEl.createDiv({ cls: 'ai-notebook-empty-state', attr: { style: 'padding: 24px; text-align: center;' } });
            emptyEl.createEl('p', { text: 'Confluence サーバーが設定されていません。' });
            const settingBtn = emptyEl.createEl('button', { text: '⚙️ 設定画面を開く', cls: 'mod-cta' });
            settingBtn.onclick = () => {
                this.close();
                (this.app as any).setting.open();
                (this.app as any).setting.openTabById(this.plugin.manifest.id);
            };
            return;
        }

        // サーバー選択 & 検索バー
        const searchControls = contentEl.createDiv({ cls: 'ai-notebook-search-controls', attr: { style: 'display: flex; gap: 8px; margin-bottom: 8px;' } });

        // サーバー選択
        if (servers.length > 1) {
            const serverSelect = searchControls.createEl('select', { attr: { style: 'max-width: 180px;' } });
            for (const s of servers) {
                const opt = serverSelect.createEl('option', { value: s.id, text: s.name });
                if (s.id === this.selectedServerId) opt.selected = true;
            }
            serverSelect.onchange = () => {
                this.selectedServerId = serverSelect.value;
                this.updateCqlSuggestion();
            };
        }

        // 検索キーワード入力
        const queryInput = searchControls.createEl('input', {
            type: 'text',
            value: this.query,
            placeholder: '検索キーワード（例: 認証, API仕様, インフラ設計）',
            attr: { style: 'flex: 1;' }
        });
        queryInput.oninput = () => {
            this.query = queryInput.value;
            this.learnTopic = this.query.trim();
            this.updateCqlSuggestion();
        };
        queryInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                this.executeSearch();
            }
        };

        const searchBtn = searchControls.createEl('button', {
            text: this.isSearching ? '検索中...' : '🔍 検索',
            cls: 'mod-cta'
        });
        searchBtn.disabled = this.isSearching;
        searchBtn.onclick = () => this.executeSearch();

        // 🎯 探索知恵 (HINTS.md) 適用表示 & CQL エリア
        const cqlContainer = contentEl.createDiv({ cls: 'ai-notebook-cql-container', attr: { style: 'background: var(--background-secondary); padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; font-size: 0.85em;' } });

        const { cql, matchedHint, appliedRules } = SearchHintsManager.buildSuggestedCql(
            this.query,
            this.notebookDir,
            this.currentServer?.defaultSpaceKey
        );

        const badgeRow = cqlContainer.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;' } });
        if (matchedHint) {
            const hintBadge = badgeRow.createSpan({ cls: 'ai-notebook-badge', attr: { style: 'background: rgba(33, 150, 243, 0.2); color: var(--text-accent); padding: 2px 8px; border-radius: 12px; font-weight: 500;' } });
            hintBadge.setText(`🎯 HINTS.md 適用中: ${matchedHint.topic} (${appliedRules.join(', ')})`);
        } else {
            const normalBadge = badgeRow.createSpan({ attr: { style: 'color: var(--text-muted);' } });
            normalBadge.setText('💡 ヒント未適用 (全社検索)');
        }

        const toggleCqlLink = badgeRow.createEl('a', { text: this.isCustomCql ? '簡易検索に戻す' : 'CQLを編集', attr: { style: 'cursor: pointer; color: var(--text-muted); text-decoration: underline;' } });
        toggleCqlLink.onclick = () => {
            this.isCustomCql = !this.isCustomCql;
            this.render();
        };

        const cqlText = this.isCustomCql ? this.customCql : cql;
        if (this.isCustomCql) {
            const cqlInput = cqlContainer.createEl('input', {
                type: 'text',
                value: this.customCql || cql,
                attr: { style: 'width: 100%; font-family: monospace; font-size: 0.9em; margin-top: 4px;' }
            });
            cqlInput.oninput = () => {
                this.customCql = cqlInput.value;
            };
        } else {
            cqlContainer.createDiv({ text: `CQL: ${cqlText || '(キーワードを入力してください)'}`, attr: { style: 'font-family: monospace; color: var(--text-muted); word-break: break-all;' } });
        }

        // 検索結果リスト（スクロール領域）
        const resultsContainer = contentEl.createDiv({ cls: 'ai-notebook-search-results', attr: { style: 'flex: 1; overflow-y: auto; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 8px; margin-bottom: 12px; min-height: 200px;' } });

        if (this.isSearching) {
            const loading = resultsContainer.createDiv({ attr: { style: 'text-align: center; padding: 32px; color: var(--text-muted);' } });
            loading.setText('🌪️ Confluence を探索中...');
        } else if (this.searchResults.length === 0) {
            const empty = resultsContainer.createDiv({ attr: { style: 'text-align: center; padding: 32px; color: var(--text-muted);' } });
            empty.setText(this.query ? '一致するページが見つかりませんでした。' : 'キーワードを入力して検索してください。');
        } else {
            // 一括選択バー
            const selectAllRow = resultsContainer.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid var(--background-modifier-border);' } });
            const selectAllLabel = selectAllRow.createEl('label', { attr: { style: 'display: flex; align-items: center; gap: 6px; cursor: pointer;' } });
            const selectAllCb = selectAllLabel.createEl('input', { type: 'checkbox' });
            selectAllCb.checked = this.searchResults.length > 0 && this.selectedPageIds.size === this.searchResults.length;
            selectAllLabel.createSpan({ text: `全選択 (${this.selectedPageIds.size}/${this.searchResults.length} 件)` });

            selectAllCb.onchange = () => {
                if (selectAllCb.checked) {
                    for (const p of this.searchResults) this.selectedPageIds.add(p.id);
                } else {
                    this.selectedPageIds.clear();
                }
                this.render();
            };

            for (const page of this.searchResults) {
                const itemEl = resultsContainer.createDiv({ cls: 'ai-notebook-search-item', attr: { style: 'display: flex; align-items: flex-start; gap: 8px; padding: 8px; border-radius: 4px; border-bottom: 1px solid var(--background-modifier-border);' } });
                
                const cb = itemEl.createEl('input', { type: 'checkbox', attr: { style: 'margin-top: 4px;' } });
                cb.checked = this.selectedPageIds.has(page.id);
                cb.onchange = () => {
                    if (cb.checked) this.selectedPageIds.add(page.id);
                    else this.selectedPageIds.delete(page.id);
                    this.render();
                };

                const bodyEl = itemEl.createDiv({ attr: { style: 'flex: 1;' } });

                // タイトル行 & スペース
                const titleRow = bodyEl.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px; margin-bottom: 2px;' } });
                titleRow.createEl('span', { text: page.title, attr: { style: 'font-weight: 600; font-size: 1.05em;' } });
                if (page.space) {
                    const spaceBadge = titleRow.createSpan({ attr: { style: 'background: var(--background-modifier-accent); color: var(--text-on-accent); padding: 1px 6px; border-radius: 4px; font-size: 0.75em;' } });
                    spaceBadge.setText(page.space.key);
                }
                if (page.webuiUrl) {
                    const link = titleRow.createEl('a', { text: '🔗', attr: { href: page.webuiUrl, target: '_blank', title: 'ブラウザで開く' } });
                }

                // 階層パス (Ancestors)
                const ancestors = page.ancestors || [];
                if (ancestors.length > 0) {
                    const pathEl = bodyEl.createDiv({ attr: { style: 'color: var(--text-muted); font-size: 0.8em; margin-bottom: 2px;' } });
                    pathEl.setText(`📁 ${ancestors.map(a => a.title).join(' / ')}`);
                }

                // 親階層としてセットするボタン
                const metaRow = bodyEl.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; font-size: 0.8em; color: var(--text-muted);' } });
                metaRow.createSpan({ text: `更新: ${page.version?.when ? new Date(page.version.when).toLocaleDateString() : '不明'}` });

                if (ancestors.length > 0) {
                    const lastAncestor = ancestors[ancestors.length - 1];
                    const pickAncestorBtn = metaRow.createEl('a', { text: `🎯 「${lastAncestor.title}」を親階層として学習`, attr: { style: 'cursor: pointer; text-decoration: underline;' } });
                    pickAncestorBtn.onclick = () => {
                        this.learnAncestorId = lastAncestor.id;
                        this.learnAncestorTitle = lastAncestor.title;
                        this.learnFeedback = true;
                        new Notice(`親階層に「${lastAncestor.title}」をセットしました`);
                        this.render();
                    };
                }
            }
        }

        // 下部: 学習フォーム & 抽出実行ボタン
        const footerContainer = contentEl.createDiv({ cls: 'ai-notebook-modal-footer', attr: { style: 'background: var(--background-secondary); padding: 10px 14px; border-radius: 6px;' } });

        // 学習フィードバックチェック
        const learnRow = footerContainer.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;' } });
        const learnCb = learnRow.createEl('input', { type: 'checkbox' });
        learnCb.checked = this.learnFeedback;
        learnCb.onchange = () => {
            this.learnFeedback = learnCb.checked;
            this.render();
        };
        learnRow.createEl('label', { text: '🧭 今回の探索の知恵を HINTS.md に記憶・再帰育成する', attr: { style: 'font-weight: 500;' } });

        if (this.learnFeedback) {
            const hintForm = footerContainer.createDiv({ attr: { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; font-size: 0.85em;' } });
            
            const topicGroup = hintForm.createDiv();
            topicGroup.createEl('label', { text: 'トピック名' });
            const topicInput = topicGroup.createEl('input', { type: 'text', value: this.learnTopic, placeholder: '例: 認証' });
            topicInput.oninput = () => { this.learnTopic = topicInput.value; };

            const ancestorGroup = hintForm.createDiv();
            ancestorGroup.createEl('label', { text: '親階層 (Ancestor ID または タイトル)' });
            const ancestorInput = ancestorGroup.createEl('input', { type: 'text', value: this.learnAncestorTitle || this.learnAncestorId, placeholder: '例: 2025年リニューアル' });
            ancestorInput.oninput = () => {
                this.learnAncestorTitle = ancestorInput.value;
                this.learnAncestorId = ancestorInput.value;
            };

            const guidanceGroup = footerContainer.createDiv({ attr: { style: 'margin-bottom: 8px; font-size: 0.85em;' } });
            guidanceGroup.createEl('label', { text: '理由・助言（AIへの指示）' });
            const guidanceInput = guidanceGroup.createEl('input', {
                type: 'text',
                value: this.learnGuidance,
                placeholder: '例: 全社検索は古い仕様が多い。2025年リニューアル配下を最優先すること。',
                attr: { style: 'width: 100%;' }
            });
            guidanceInput.oninput = () => { this.learnGuidance = guidanceInput.value; };
        }

        // アクションボタン
        const actionRow = footerContainer.createDiv({ attr: { style: 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;' } });
        const cancelBtn = actionRow.createEl('button', { text: '閉じる' });
        cancelBtn.onclick = () => this.close();

        const count = this.selectedPageIds.size;
        const importBtn = actionRow.createEl('button', {
            text: this.isImporting ? '抽出中...' : `📥 選択したページ (${count}件) を sources/ に抽出`,
            cls: 'mod-cta'
        });
        importBtn.disabled = this.isImporting || count === 0;
        importBtn.onclick = () => this.executeImport();
    }

    private updateCqlSuggestion(): void {
        this.render();
    }

    private async executeSearch(): Promise<void> {
        if (!this.query.trim() && !this.customCql.trim()) {
            new Notice('検索キーワードを入力してください');
            return;
        }

        const { cql } = SearchHintsManager.buildSuggestedCql(
            this.query,
            this.notebookDir,
            this.currentServer?.defaultSpaceKey
        );
        const finalCql = this.isCustomCql && this.customCql.trim() ? this.customCql.trim() : cql;

        this.isSearching = true;
        this.searchResults = [];
        this.selectedPageIds.clear();
        this.render();

        try {
            const service = (this.plugin as any).confluenceService;
            const res = await service.search(finalCql, { serverId: this.selectedServerId, limit: 30 });
            this.searchResults = res.results;
            // 該当が少ない場合は全選択
            if (this.searchResults.length <= 5) {
                for (const p of this.searchResults) this.selectedPageIds.add(p.id);
            }
        } catch (err: any) {
            new Notice(`検索失敗: ${err?.message || String(err)}`);
        } finally {
            this.isSearching = false;
            this.render();
        }
    }

    private async executeImport(): Promise<void> {
        if (this.selectedPageIds.size === 0) return;

        this.isImporting = true;
        this.render();

        const service = (this.plugin as any).confluenceService;
        let successCount = 0;
        let failCount = 0;

        for (const pageId of this.selectedPageIds) {
            try {
                await service.importPageToNotebook(
                    this.notebookId,
                    pageId,
                    this.notebookManager,
                    { serverId: this.selectedServerId }
                );
                successCount++;
            } catch (err) {
                console.error(`Failed to import page ${pageId}:`, err);
                failCount++;
            }
        }

        // HINTS.md 学習の保存
        if (this.learnFeedback && this.learnTopic.trim()) {
            try {
                SearchHintsManager.learnHint(this.notebookDir, {
                    topic: this.learnTopic.trim(),
                    keywords: [this.learnTopic.trim(), ...this.query.split(/\s+/).filter(Boolean)],
                    spaceKey: this.currentServer?.defaultSpaceKey,
                    ancestorId: this.learnAncestorId.trim() || undefined,
                    ancestorTitle: this.learnAncestorTitle.trim() || undefined,
                    guidance: this.learnGuidance.trim() || 'ユーザーフィードバックによる学習ルール'
                });
                new Notice(`🧭 探索の知恵を HINTS.md に記憶しました`);
            } catch (e) {
                console.warn('Failed to save search hint:', e);
            }
        }

        this.isImporting = false;
        new Notice(`Confluence から ${successCount} 件のページを sources/ に抽出しました`);
        if (this.onImportCallback) {
            this.onImportCallback();
        }
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
