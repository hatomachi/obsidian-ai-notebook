import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type AINotebookPlugin from './main';
import { AIAgentType } from './types';
import { MattermostPresetModal } from './views/modals/MattermostPresetModal';

export class AINotebookSettingTab extends PluginSettingTab {
    plugin: AINotebookPlugin;

    constructor(app: App, plugin: AINotebookPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Obsidian AI Notebook 設定' });

        new Setting(containerEl)
            .setName('ルート保存フォルダ')
            .setDesc('ノートブックのデータ（インデックス、ソース、成果物）を保存するVault内のディレクトリパス')
            .addText(text => text
                .setPlaceholder('_ainotebook')
                .setValue(this.plugin.settings.rootDir)
                .onChange(async (value) => {
                    this.plugin.settings.rootDir = value.trim() || '_ainotebook';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('アクティブ AI エージェント')
            .setDesc('使用するローカル CLI エージェントを選択します（antigravity CLI / claude CLI）')
            .addDropdown(dropdown => dropdown
                .addOption('antigravity', 'Antigravity CLI (Default)')
                .addOption('claude', 'Claude Code CLI (Claude)')
                .setValue(this.plugin.settings.activeAgent)
                .onChange(async (value) => {
                    this.plugin.settings.activeAgent = value as AIAgentType;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Antigravity CLI パス')
            .setDesc('実行可能な antigravity CLI コマンド名または絶対パス (例: agy)')
            .addText(text => text
                .setPlaceholder('agy')
                .setValue(this.plugin.settings.antigravityPath || 'agy')
                .onChange(async (value) => {
                    this.plugin.settings.antigravityPath = value.trim() || 'agy';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Claude Code CLI パス')
            .setDesc('実行可能な claude CLI コマンド名または絶対パス')
            .addText(text => text
                .setPlaceholder('claude')
                .setValue(this.plugin.settings.claudePath)
                .onChange(async (value) => {
                    this.plugin.settings.claudePath = value.trim() || 'claude';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('エージェント最大ターン数 (Max Turns)')
            .setDesc('エージェント実行時の最大ターン数（暴走防止上限、デフォルト: 15）')
            .addText(text => text
                .setPlaceholder('15')
                .setValue(String(this.plugin.settings.maxTurns || 15))
                .onChange(async (value) => {
                    const parsed = parseInt(value.trim(), 10);
                    this.plugin.settings.maxTurns = isNaN(parsed) || parsed <= 0 ? 15 : parsed;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: '外部ソース & ファイルサーバー設定' });

        new Setting(containerEl)
            .setName('CIFS / 共有フォルダ起点パス')
            .setDesc('ファイルサーバーやマウントされた共有フォルダの基準絶対パス（例: /Volumes/share/projects）')
            .addText(text => text
                .setPlaceholder('/Volumes/share')
                .setValue(this.plugin.settings.sharedFolderBasePath || '')
                .onChange(async (value) => {
                    this.plugin.settings.sharedFolderBasePath = value.trim();
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: '💬 Mattermost 連携設定' });

        new Setting(containerEl)
            .setName('Mattermost サーバー URL')
            .setDesc('社内 Mattermost サーバーのベースURL（例: https://mattermost.internal.company.com）')
            .addText(text => text
                .setPlaceholder('https://mattermost.example.com')
                .setValue(this.plugin.settings.mattermostUrl || '')
                .onChange(async (value) => {
                    this.plugin.settings.mattermostUrl = value.trim().replace(/\/+$/, '');
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Personal Access Token (PAT)')
            .setDesc('Mattermost アカウント設定で発行した個人アクセストークン')
            .addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder('PAT トークンを入力...')
                    .setValue(this.plugin.settings.mattermostToken || '')
                    .onChange(async (value) => {
                        this.plugin.settings.mattermostToken = value.trim();
                        await this.plugin.saveSettings();
                    });
            });

        // 接続テスト Setting
        const testSetting = new Setting(containerEl)
            .setName('接続テスト & キャッシュ')
            .setDesc('設定した URL と PAT で Mattermost API に疎通確認を行います');

        const testResultEl = containerEl.createDiv({ cls: 'ai-notebook-test-result' });

        testSetting.addButton(btn => btn
            .setButtonText('🔌 接続テスト実行')
            .setCta()
            .onClick(async () => {
                testResultEl.empty();
                testResultEl.setText('接続確認中...');
                testResultEl.className = 'ai-notebook-test-result is-testing';

                const res = await this.plugin.mattermostService.testConnection();
                testResultEl.empty();
                if (res.success && res.user) {
                    const name = res.user.nickname || [res.user.last_name, res.user.first_name].filter(Boolean).join(' ') || res.user.username;
                    testResultEl.setText(`✅ 接続成功: @${res.user.username} (${name}) として認識されました`);
                    testResultEl.className = 'ai-notebook-test-result is-success';
                } else {
                    testResultEl.setText(`❌ 接続失敗: ${res.error || '不明なエラー'}`);
                    testResultEl.className = 'ai-notebook-test-result is-error';
                }
            }));

        testSetting.addButton(btn => btn
            .setButtonText('🔄 キャッシュクリア')
            .onClick(() => {
                this.plugin.mattermostService.clearCache();
                new Notice('Mattermost のチャンネルキャッシュをクリアしました');
            }));

        // お気に入りセット（プリセット）管理
        const presetHeaderSetting = new Setting(containerEl)
            .setName('お気に入りチャンネルセット (プリセット)')
            .setDesc('よく使うチャンネルの組み合わせを登録しておくと、新規ノートブック作成時に一括バインドできます');

        presetHeaderSetting.addButton(btn => btn
            .setButtonText('➕ 新規セット作成')
            .onClick(() => {
                new MattermostPresetModal(this.app, this.plugin, null, () => {
                    this.display(); // 再描画
                }).open();
            }));

        const presets = this.plugin.settings.mattermostPresets || [];
        if (presets.length === 0) {
            const emptyEl = containerEl.createDiv({ cls: 'ai-notebook-empty-box' });
            emptyEl.createDiv({ text: '登録されているプリセットはありません。「新規セット作成」から作成できます。', cls: 'ai-notebook-empty-text' });
        } else {
            const presetContainer = containerEl.createDiv({ cls: 'ai-notebook-settings-preset-list' });
            for (const preset of presets) {
                const itemSetting = new Setting(presetContainer)
                    .setName(`🏷️ ${preset.name}`)
                    .setDesc(`チャンネル: ${preset.channels.map(c => `[${c.teamName}] #${c.displayName || c.channelName}`).join(', ')}`);

                itemSetting.addButton(btn => btn
                    .setButtonText('編集')
                    .onClick(() => {
                        new MattermostPresetModal(this.app, this.plugin, preset, () => {
                            this.display();
                        }).open();
                    }));

                itemSetting.addButton(btn => btn
                    .setButtonText('削除')
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.mattermostPresets = presets.filter(p => p.id !== preset.id);
                        await this.plugin.saveSettings();
                        new Notice(`プリセット「${preset.name}」を削除しました`);
                        this.display();
                    }));
            }
        }
    }
}


