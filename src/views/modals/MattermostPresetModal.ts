import { App, Modal, Notice, setIcon } from 'obsidian';
import type AINotebookPlugin from '../../main';
import { MattermostPreset, MattermostChannelRef } from '../../types';
import { MattermostSearchableChannel } from '../../services/MattermostService';

export class MattermostPresetModal extends Modal {
    plugin: AINotebookPlugin;
    preset: MattermostPreset | null; // null の場合は新規作成
    onSaveCallback: () => void;

    private presetName: string = '';
    private selectedChannels: MattermostChannelRef[] = [];
    private allChannels: MattermostSearchableChannel[] = [];
    private filteredChannels: MattermostSearchableChannel[] = [];
    private searchInputEl!: HTMLInputElement;
    private channelListEl!: HTMLElement;
    private selectedListEl!: HTMLElement;
    private isLoading: boolean = false;

    constructor(
        app: App,
        plugin: AINotebookPlugin,
        preset: MattermostPreset | null,
        onSaveCallback: () => void
    ) {
        super(app);
        this.plugin = plugin;
        this.preset = preset;
        this.onSaveCallback = onSaveCallback;

        if (preset) {
            this.presetName = preset.name;
            this.selectedChannels = [...preset.channels];
        }
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-notebook-modal', 'ai-notebook-mm-preset-modal');

        const titleText = this.preset ? '🏷️ お気に入りセットの編集' : '🏷️ 新規お気に入りセットの作成';
        contentEl.createEl('h2', { text: titleText });

        // プリセット名入力
        const nameSection = contentEl.createDiv({ cls: 'ai-notebook-form-group' });
        nameSection.createEl('label', { text: 'セット名 (例: APIGW 開発・リリース, インフラ基盤運用)' });
        const nameInput = nameSection.createEl('input', {
            type: 'text',
            value: this.presetName,
            placeholder: 'セット名を入力...'
        });
        nameInput.oninput = () => {
            this.presetName = nameInput.value.trim();
        };

        // 選択中チャンネル一覧
        const selectedSection = contentEl.createDiv({ cls: 'ai-notebook-form-group' });
        selectedSection.createEl('label', { text: 'セットに含まれるチャンネル' });
        this.selectedListEl = selectedSection.createDiv({ cls: 'ai-notebook-mm-selected-chips' });
        this.renderSelectedChannels();

        // チャンネル検索・追加セクション
        const searchSection = contentEl.createDiv({ cls: 'ai-notebook-form-group' });
        searchSection.createEl('label', { text: 'チャンネルを検索して追加 (全チーム横断)' });
        
        const searchBox = searchSection.createDiv({ cls: 'ai-notebook-search-box' });
        this.searchInputEl = searchBox.createEl('input', {
            type: 'text',
            placeholder: 'チーム名やチャンネル名を入力... (例: apigw, infra, release)'
        });
        this.searchInputEl.oninput = () => this.filterChannels();

        const refreshBtn = searchBox.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-secondary',
            text: '🔄'
        });
        refreshBtn.setAttribute('title', 'チャンネル一覧を再取得');
        refreshBtn.onclick = async () => {
            await this.loadChannels(true);
        };

        this.channelListEl = searchSection.createDiv({ cls: 'ai-notebook-mm-channel-candidates' });

        // アクションボタン
        const btnRow = contentEl.createDiv({ cls: 'ai-notebook-modal-buttons' });
        const cancelBtn = btnRow.createEl('button', { text: 'キャンセル', cls: 'ai-notebook-btn ai-notebook-btn-secondary' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = btnRow.createEl('button', { text: '💾 保存', cls: 'ai-notebook-btn ai-notebook-btn-primary' });
        saveBtn.onclick = async () => {
            await this.handleSave();
        };

        // チャンネル一覧を初回ロード
        await this.loadChannels(false);
    }

    private renderSelectedChannels(): void {
        this.selectedListEl.empty();
        if (this.selectedChannels.length === 0) {
            this.selectedListEl.createDiv({ text: 'チャンネルが追加されていません。下の検索から追加してください。', cls: 'ai-notebook-empty-text' });
            return;
        }

        for (const ch of this.selectedChannels) {
            const chip = this.selectedListEl.createDiv({ cls: 'ai-notebook-mm-chip' });
            chip.createSpan({ text: `🏢 [${ch.teamName}] #${ch.displayName || ch.channelName}`, cls: 'ai-notebook-mm-chip-title' });
            
            const removeBtn = chip.createSpan({ cls: 'ai-notebook-mm-chip-remove' });
            setIcon(removeBtn, 'x');
            removeBtn.onclick = () => {
                this.selectedChannels = this.selectedChannels.filter(c => c.channelId !== ch.channelId);
                this.renderSelectedChannels();
                this.filterChannels();
            };
        }
    }

    private async loadChannels(forceRefresh: boolean): Promise<void> {
        this.channelListEl.empty();
        this.channelListEl.createDiv({ text: 'チャンネル一覧を取得中...', cls: 'ai-notebook-empty-text' });

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
        const selectedIds = new Set(this.selectedChannels.map(c => c.channelId));

        if (!query) {
            this.filteredChannels = this.allChannels.filter(c => !selectedIds.has(c.channelId)).slice(0, 30);
        } else {
            const queryTokens = query.split(/\s+/).filter(Boolean);
            this.filteredChannels = this.allChannels
                .filter(c => !selectedIds.has(c.channelId))
                .filter(c => queryTokens.every(t => c.searchKey.includes(t)))
                .slice(0, 50);
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
            const item = this.channelListEl.createDiv({ cls: 'ai-notebook-mm-candidate-item' });
            
            const infoDiv = item.createDiv({ cls: 'ai-notebook-mm-candidate-info' });
            infoDiv.createSpan({ text: `🏢 [${ch.teamDisplayName || ch.teamName}]`, cls: 'ai-notebook-badge-team' });
            infoDiv.createSpan({ text: ` #${ch.displayName || ch.channelName}`, cls: 'ai-notebook-mm-candidate-name' });
            if (ch.purpose) {
                infoDiv.createSpan({ text: ` - ${ch.purpose}`, cls: 'ai-notebook-mm-candidate-purpose' });
            }

            const addBtn = item.createEl('button', {
                cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-xs',
                text: '+ 追加'
            });
            addBtn.onclick = () => {
                this.selectedChannels.push({
                    teamId: ch.teamId,
                    teamName: ch.teamName,
                    channelId: ch.channelId,
                    channelName: ch.channelName,
                    displayName: ch.displayName
                });
                this.renderSelectedChannels();
                this.filterChannels();
            };
        }
    }

    private async handleSave(): Promise<void> {
        if (!this.presetName) {
            new Notice('セット名を入力してください');
            return;
        }
        if (this.selectedChannels.length === 0) {
            new Notice('少なくとも1つのチャンネルを追加してください');
            return;
        }

        const presets = this.plugin.settings.mattermostPresets || [];
        const presetId = this.preset?.id || `preset_${Date.now()}`;

        const updatedPreset: MattermostPreset = {
            id: presetId,
            name: this.presetName,
            channels: this.selectedChannels
        };

        const existingIndex = presets.findIndex(p => p.id === presetId);
        if (existingIndex >= 0) {
            presets[existingIndex] = updatedPreset;
        } else {
            presets.push(updatedPreset);
        }

        this.plugin.settings.mattermostPresets = presets;
        await this.plugin.saveSettings();

        new Notice(`お気に入りセット「${this.presetName}」を保存しました`);
        this.onSaveCallback();
        this.close();
    }
}
