import { App, Modal, Notice, setIcon } from 'obsidian';
import type AINotebookPlugin from '../../main';
import { MattermostChannelRef, MattermostPreset } from '../../types';
import { MattermostSearchableChannel } from '../../services/MattermostService';
import { MattermostPresetModal } from './MattermostPresetModal';

export type MattermostModalTab = 'presets' | 'pastNotebooks' | 'searchChannels' | 'searchPosts';

export class MattermostModal extends Modal {
    plugin: AINotebookPlugin;
    notebookId: string;
    onSuccessCallback: () => void;

    private activeTab: MattermostModalTab = 'presets';
    private allChannels: MattermostSearchableChannel[] = [];
    private filteredChannels: MattermostSearchableChannel[] = [];
    private pastChannels: { channel: MattermostChannelRef; notebookTitle: string; notebookId: string }[] = [];
    private searchInputEl!: HTMLInputElement;
    private channelListEl!: HTMLElement;
    private tabContainerEl!: HTMLElement;
    private contentBodyEl!: HTMLElement;

    // 取り込み設定
    private perPage: number = 50;
    private includeThreads: boolean = true;
    private isLoading: boolean = false;

    // キーワード検索用ステート
    private postSearchQuery: string = '';
    private postSearchTeamId: string = '';
    private postSearchResults: any = null;
    private defaultSearchChannel?: MattermostChannelRef;

    constructor(
        app: App,
        plugin: AINotebookPlugin,
        notebookId: string,
        initialTab: MattermostModalTab = 'presets',
        defaultSearchChannel?: MattermostChannelRef,
        onSuccessCallback: () => void = () => {}
    ) {
        super(app);
        this.plugin = plugin;
        this.notebookId = notebookId;
        this.activeTab = initialTab;
        this.defaultSearchChannel = defaultSearchChannel;
        this.onSuccessCallback = onSuccessCallback;
        if (defaultSearchChannel) {
            this.postSearchTeamId = defaultSearchChannel.teamId;
        }
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-notebook-modal', 'ai-notebook-mm-modal');

        if (!this.plugin.mattermostService.isConfigured()) {
            contentEl.createEl('h2', { text: '💬 Mattermost 連携' });
            const warnBox = contentEl.createDiv({ cls: 'ai-notebook-warning-box' });
            warnBox.createEl('p', { text: 'Mattermost の URL または Personal Access Token (PAT) が設定されていません。' });
            warnBox.createEl('p', { text: 'プラグイン設定画面から Mattermost の接続設定を行ってください。' });
            
            const btnRow = contentEl.createDiv({ cls: 'ai-notebook-modal-buttons' });
            const closeBtn = btnRow.createEl('button', { text: '閉じる', cls: 'ai-notebook-btn ai-notebook-btn-secondary' });
            closeBtn.onclick = () => this.close();
            return;
        }

        // ヘッダー
        const header = contentEl.createDiv({ cls: 'ai-notebook-mm-modal-header' });
        header.createEl('h2', { text: '💬 Mattermost チャンネルの紐付け・インポート' });

        // タブ切り替えバー
        this.tabContainerEl = contentEl.createDiv({ cls: 'ai-notebook-mm-tab-bar' });
        this.renderTabs();

        // コンテンツボディ
        this.contentBodyEl = contentEl.createDiv({ cls: 'ai-notebook-mm-tab-content' });
        await this.renderTabContent();
    }

    private renderTabs(): void {
        this.tabContainerEl.empty();

        const tabs: { id: MattermostModalTab; label: string; icon: string }[] = [
            { id: 'presets', label: '🏷️ お気に入りセット', icon: 'bookmark' },
            { id: 'pastNotebooks', label: '📚 過去ノートから', icon: 'history' },
            { id: 'searchChannels', label: '🔍 全チャンネル検索', icon: 'search' },
            { id: 'searchPosts', label: '🔎 過去ログを検索', icon: 'file-text' }
        ];

        for (const t of tabs) {
            const tabBtn = this.tabContainerEl.createEl('button', {
                cls: `ai-notebook-mm-tab-btn ${this.activeTab === t.id ? 'is-active' : ''}`,
                text: t.label
            });
            tabBtn.onclick = async () => {
                if (this.activeTab !== t.id) {
                    this.activeTab = t.id;
                    this.renderTabs();
                    await this.renderTabContent();
                }
            };
        }
    }

    private async renderTabContent(): Promise<void> {
        this.contentBodyEl.empty();

        if (this.activeTab === 'presets') {
            await this.renderPresetsTab();
        } else if (this.activeTab === 'pastNotebooks') {
            await this.renderPastNotebooksTab();
        } else if (this.activeTab === 'searchChannels') {
            await this.renderSearchChannelsTab();
        } else if (this.activeTab === 'searchPosts') {
            await this.renderSearchPostsTab();
        }
    }

    // ==========================================
    // 1. お気に入りセット (Presets) タブ
    // ==========================================
    private async renderPresetsTab(): Promise<void> {
        const presets = this.plugin.settings.mattermostPresets || [];

        const desc = this.contentBodyEl.createEl('p', {
            text: 'よく使うチャンネルの組み合わせ（プリセット）を、このノートブックに一括適用・取り込みできます。',
            cls: 'ai-notebook-hint-text'
        });

        const actionRow = this.contentBodyEl.createDiv({ cls: 'ai-notebook-mm-preset-actions' });
        const addPresetBtn = actionRow.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-sm',
            text: '➕ 新しいお気に入りセットを作成'
        });
        addPresetBtn.onclick = () => {
            new MattermostPresetModal(this.app, this.plugin, null, async () => {
                await this.renderPresetsTab();
            }).open();
        };

        const presetList = this.contentBodyEl.createDiv({ cls: 'ai-notebook-mm-preset-list' });

        if (presets.length === 0) {
            const emptyEl = presetList.createDiv({ cls: 'ai-notebook-empty-box' });
            emptyEl.createDiv({ text: '登録されているお気に入りセットはありません。', cls: 'ai-notebook-empty-text' });
            emptyEl.createDiv({ text: '「➕ 新しいお気に入りセットを作成」から、よく参照するチャンネル群をセットとして登録できます。', cls: 'ai-notebook-hint-text' });
            return;
        }

        for (const p of presets) {
            const card = presetList.createDiv({ cls: 'ai-notebook-mm-preset-card' });
            
            const headerRow = card.createDiv({ cls: 'ai-notebook-mm-preset-card-header' });
            headerRow.createEl('h4', { text: `🏷️ ${p.name}` });

            const btnWrap = headerRow.createDiv({ cls: 'ai-notebook-mm-preset-card-btns' });
            
            const editBtn = btnWrap.createEl('button', {
                cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-xs',
                text: '編集'
            });
            editBtn.onclick = (e) => {
                e.stopPropagation();
                new MattermostPresetModal(this.app, this.plugin, p, async () => {
                    await this.renderPresetsTab();
                }).open();
            };

            const applyBtn = btnWrap.createEl('button', {
                cls: 'ai-notebook-btn ai-notebook-btn-primary ai-notebook-btn-xs',
                text: '📥 このセットを紐付ける'
            });
            applyBtn.onclick = async () => {
                await this.importChannels(p.channels);
            };

            // 含まれるチャンネル一覧
            const chWrap = card.createDiv({ cls: 'ai-notebook-mm-preset-chips' });
            for (const ch of p.channels) {
                chWrap.createSpan({
                    text: `🏢 [${ch.teamName}] #${ch.displayName || ch.channelName}`,
                    cls: 'ai-notebook-badge-channel'
                });
            }
        }
    }

    // ==========================================
    // 2. 過去ノートから選ぶ タブ
    // ==========================================
    private async renderPastNotebooksTab(): Promise<void> {
        this.contentBodyEl.createEl('p', {
            text: '過去に他のノートブックでバインド・参照されたチャンネル一覧から、今回のノートに再利用できます。',
            cls: 'ai-notebook-hint-text'
        });

        const listEl = this.contentBodyEl.createDiv({ cls: 'ai-notebook-mm-past-list' });
        listEl.createDiv({ text: '過去のノートブック情報を集約中...', cls: 'ai-notebook-empty-text' });

        this.pastChannels = await this.plugin.notebookManager.getAllBoundMattermostChannels();
        listEl.empty();

        // 自ノート以外のチャンネルを優先
        const otherChannels = this.pastChannels.filter(item => item.notebookId !== this.notebookId);

        if (otherChannels.length === 0) {
            const emptyEl = listEl.createDiv({ cls: 'ai-notebook-empty-box' });
            emptyEl.createDiv({ text: '他のノートブックでバインドされたチャンネルはまだありません。', cls: 'ai-notebook-empty-text' });
            emptyEl.createDiv({ text: '「全チャンネル検索」タブから目的のチャンネルを追加してください。', cls: 'ai-notebook-hint-text' });
            return;
        }

        for (const item of otherChannels) {
            const row = listEl.createDiv({ cls: 'ai-notebook-mm-candidate-item' });
            
            const info = row.createDiv({ cls: 'ai-notebook-mm-candidate-info' });
            info.createSpan({ text: `🏢 [${item.channel.teamName}]`, cls: 'ai-notebook-badge-team' });
            info.createSpan({ text: ` #${item.channel.displayName || item.channel.channelName}`, cls: 'ai-notebook-mm-candidate-name' });
            info.createSpan({ text: ` (利用元: 📓 ${item.notebookTitle})`, cls: 'ai-notebook-badge-origin-folder' });

            const addBtn = row.createEl('button', {
                cls: 'ai-notebook-btn ai-notebook-btn-primary ai-notebook-btn-xs',
                text: '📥 紐付けて取り込む'
            });
            addBtn.onclick = async () => {
                await this.importChannels([item.channel]);
            };
        }
    }

    // ==========================================
    // 3. 全チャンネル横断検索 タブ
    // ==========================================
    private async renderSearchChannelsTab(): Promise<void> {
        this.contentBodyEl.createEl('p', {
            text: '所属しているすべてのチーム・チャンネルから横断的にあいまい検索できます。',
            cls: 'ai-notebook-hint-text'
        });

        const searchBox = this.contentBodyEl.createDiv({ cls: 'ai-notebook-search-box' });
        this.searchInputEl = searchBox.createEl('input', {
            type: 'text',
            placeholder: 'チーム名・チャンネル名・日本語名で絞り込み... (例: apigw, infra, リリース)'
        });
        this.searchInputEl.oninput = () => this.filterChannels();

        const refreshBtn = searchBox.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-secondary',
            text: '🔄'
        });
        refreshBtn.setAttribute('title', 'チャンネル一覧を再取得');
        refreshBtn.onclick = async () => {
            await this.loadAllChannels(true);
        };

        this.channelListEl = this.contentBodyEl.createDiv({ cls: 'ai-notebook-mm-channel-candidates' });

        await this.loadAllChannels(false);
    }

    private async loadAllChannels(forceRefresh: boolean): Promise<void> {
        this.channelListEl.empty();
        this.channelListEl.createDiv({ text: '全チームのチャンネルを取得中...', cls: 'ai-notebook-empty-text' });

        try {
            this.allChannels = await this.plugin.mattermostService.getAllSearchableChannels(forceRefresh);
            this.filterChannels();
        } catch (err: any) {
            this.channelListEl.empty();
            this.channelListEl.createDiv({ text: `取得エラー: ${err.message || err}`, cls: 'ai-notebook-empty-text' });
        }
    }

    private filterChannels(): void {
        const query = (this.searchInputEl?.value || '').trim().toLowerCase();
        if (!query) {
            this.filteredChannels = this.allChannels.slice(0, 40);
        } else {
            const tokens = query.split(/\s+/).filter(Boolean);
            this.filteredChannels = this.allChannels
                .filter(c => tokens.every(t => c.searchKey.includes(t)))
                .slice(0, 60);
        }
        this.renderChannelCandidates();
    }

    private renderChannelCandidates(): void {
        this.channelListEl.empty();
        if (this.filteredChannels.length === 0) {
            this.channelListEl.createDiv({ text: '該当するチャンネルは見つかりませんでした', cls: 'ai-notebook-empty-text' });
            return;
        }

        for (const ch of this.filteredChannels) {
            const row = this.channelListEl.createDiv({ cls: 'ai-notebook-mm-candidate-item' });

            const info = row.createDiv({ cls: 'ai-notebook-mm-candidate-info' });
            info.createSpan({ text: `🏢 [${ch.teamDisplayName || ch.teamName}]`, cls: 'ai-notebook-badge-team' });
            info.createSpan({ text: ` #${ch.displayName || ch.channelName}`, cls: 'ai-notebook-mm-candidate-name' });
            if (ch.purpose) {
                info.createSpan({ text: ` - ${ch.purpose}`, cls: 'ai-notebook-mm-candidate-purpose' });
            }

            const addBtn = row.createEl('button', {
                cls: 'ai-notebook-btn ai-notebook-btn-primary ai-notebook-btn-xs',
                text: '📥 紐付けて取り込む'
            });
            addBtn.onclick = async () => {
                await this.importChannels([{
                    teamId: ch.teamId,
                    teamName: ch.teamName,
                    channelId: ch.channelId,
                    channelName: ch.channelName,
                    displayName: ch.displayName
                }]);
            };
        }
    }

    // ==========================================
    // 4. 過去ログを検索して取り込む タブ
    // ==========================================
    private async renderSearchPostsTab(): Promise<void> {
        this.contentBodyEl.createEl('p', {
            text: 'Mattermost の全文検索 API を実行し、過去のディスカッションやトラブルログを発掘してインプットに取り込みます。',
            cls: 'ai-notebook-hint-text'
        });

        // 検索対象チーム選択
        const teamSection = this.contentBodyEl.createDiv({ cls: 'ai-notebook-form-group' });
        teamSection.createEl('label', { text: '検索対象チーム' });
        const teamSelect = teamSection.createEl('select');

        let teams: any[] = [];
        try {
            teams = await this.plugin.mattermostService.getTeams();
            for (const t of teams) {
                const opt = teamSelect.createEl('option', { value: t.id, text: `🏢 ${t.display_name} (${t.name})` });
                if (this.postSearchTeamId === t.id) {
                    opt.selected = true;
                }
            }
            if (!this.postSearchTeamId && teams.length > 0) {
                this.postSearchTeamId = teams[0].id;
            }
        } catch (e) {
            teamSection.createDiv({ text: 'チーム一覧の取得に失敗しました', cls: 'ai-notebook-empty-text' });
        }

        teamSelect.onchange = () => {
            this.postSearchTeamId = teamSelect.value;
        };

        // 検索キーワード入力
        const querySection = this.contentBodyEl.createDiv({ cls: 'ai-notebook-form-group' });
        querySection.createEl('label', { text: '検索キーワード (Mattermost 検索修飾子 in:channel, from:user 等も使用可能)' });
        
        const queryBox = querySection.createDiv({ cls: 'ai-notebook-search-box' });
        const queryInput = queryBox.createEl('input', {
            type: 'text',
            value: this.postSearchQuery,
            placeholder: '検索キーワードを入力... (例: 認証 リファクタ, DB接続エラー)'
        });
        queryInput.oninput = () => {
            this.postSearchQuery = queryInput.value.trim();
        };

        const execBtn = queryBox.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-primary',
            text: '🔍 検索実行'
        });

        const resultsContainer = this.contentBodyEl.createDiv({ cls: 'ai-notebook-mm-search-results' });

        execBtn.onclick = async () => {
            if (!this.postSearchQuery) {
                new Notice('検索キーワードを入力してください');
                return;
            }
            if (!this.postSearchTeamId) {
                new Notice('対象チームを選択してください');
                return;
            }

            resultsContainer.empty();
            resultsContainer.createDiv({ text: '検索中...', cls: 'ai-notebook-empty-text' });

            try {
                const team = teams.find(t => t.id === this.postSearchTeamId);
                const mockChannel: MattermostChannelRef = {
                    teamId: this.postSearchTeamId,
                    teamName: team?.name || 'team',
                    channelId: this.defaultSearchChannel?.channelId || '',
                    channelName: this.defaultSearchChannel?.channelName || 'search',
                    displayName: this.defaultSearchChannel?.displayName || '検索結果'
                };

                const res = await this.plugin.mattermostService.fetchAndFormatPosts(mockChannel, {
                    searchQuery: this.postSearchQuery
                });

                resultsContainer.empty();
                if (res.postCount === 0) {
                    resultsContainer.createDiv({ text: `「${this.postSearchQuery}」に一致する投稿は見つかりませんでした`, cls: 'ai-notebook-empty-text' });
                    return;
                }

                const summaryRow = resultsContainer.createDiv({ cls: 'ai-notebook-mm-search-summary' });
                summaryRow.createSpan({ text: `ヒット件数: ${res.postCount} 件`, cls: 'ai-notebook-badge-count' });

                const importBtn = summaryRow.createEl('button', {
                    cls: 'ai-notebook-btn ai-notebook-btn-primary ai-notebook-btn-sm',
                    text: '📥 検索結果をインプットに取り込む'
                });
                importBtn.onclick = async () => {
                    importBtn.disabled = true;
                    importBtn.setText('取り込み中...');
                    try {
                        const file = await this.plugin.notebookManager.addMattermostSearchSource(
                            this.notebookId,
                            this.postSearchQuery,
                            res.markdown
                        );
                        new Notice(`検索ログを "${file.name}" としてインプットに保存しました`);
                        this.onSuccessCallback();
                        this.close();
                    } catch (e: any) {
                        new Notice(`保存エラー: ${e.message || e}`);
                        importBtn.disabled = false;
                        importBtn.setText('📥 検索結果をインプットに取り込む');
                    }
                };

                // プレビュー表示
                const previewBox = resultsContainer.createDiv({ cls: 'ai-notebook-mm-preview-box' });
                previewBox.createEl('pre', { text: res.markdown.slice(0, 1500) + (res.markdown.length > 1500 ? '\n\n...(省略)...' : '') });

            } catch (err: any) {
                resultsContainer.empty();
                resultsContainer.createDiv({ text: `検索エラー: ${err.message || err}`, cls: 'ai-notebook-empty-text' });
            }
        };
    }

    // ==========================================
    // チャンネルの一括/単体インポート処理
    // ==========================================
    private async importChannels(channels: MattermostChannelRef[]): Promise<void> {
        if (this.isLoading) return;
        this.isLoading = true;

        const notice = new Notice(`Mattermost から ${channels.length} チャンネルの投稿を取得中...`, 0);

        try {
            for (const ch of channels) {
                const res = await this.plugin.mattermostService.fetchAndFormatPosts(ch, {
                    perPage: this.perPage,
                    isCatchUp: false
                });

                const channelRefWithSync: MattermostChannelRef = {
                    ...ch,
                    lastSyncedPostId: res.latestPostId,
                    lastSyncedAt: res.latestCreateAt ? new Date(res.latestCreateAt).toISOString() : new Date().toISOString()
                };

                await this.plugin.notebookManager.bindMattermostChannel(
                    this.notebookId,
                    channelRefWithSync,
                    res.markdown
                );
            }

            notice.hide();
            new Notice(`✅ ${channels.length} 件のチャンネルをバインドし、インプットにログを取り込みました`);
            this.onSuccessCallback();
            this.close();
        } catch (err: any) {
            notice.hide();
            new Notice(`取り込みエラー: ${err.message || err}`);
            console.error('[MattermostModal] Import error:', err);
        } finally {
            this.isLoading = false;
        }
    }
}
