import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type AINotebookPlugin from './main';
import { AIAgentType } from './types';
import { MattermostPresetModal } from './views/modals/MattermostPresetModal';
import { GitLabServerModal } from './views/modals/GitLabServerModal';

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

        // ============================================================
        // 🖼️ 画像・ドキュメント軽量化設定 (容量ゼロ化 Step 1)
        // ============================================================
        containerEl.createEl('h3', { text: '🖼️ 画像・ドキュメント軽量化設定' });

        new Setting(containerEl)
            .setName('画像のWebP自動軽量化')
            .setDesc('画像（PNG/JPG等）投入時、クライアント側で長辺1200px・WebP形式に自動圧縮します（Vault容量・Gitサイズの爆発を防止）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.compressImages ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.compressImages = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('最大長辺ピクセル (px)')
            .setDesc('長辺がこの値を超える画像をアスペクト比維持のまま縮小します (デフォルト: 1200)')
            .addText(text => text
                .setPlaceholder('1200')
                .setValue(String(this.plugin.settings.imageMaxDimension ?? 1200))
                .onChange(async (value) => {
                    const parsed = parseInt(value.trim(), 10);
                    if (!isNaN(parsed) && parsed > 0) {
                        this.plugin.settings.imageMaxDimension = parsed;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('WebP 圧縮品質 (0.1 〜 1.0)')
            .setDesc('WebP変換時の画質クオリティ。0.8で通常80〜95%のファイルサイズ削減が可能です (デフォルト: 0.8)')
            .addText(text => text
                .setPlaceholder('0.8')
                .setValue(String(this.plugin.settings.imageQuality ?? 0.8))
                .onChange(async (value) => {
                    const parsed = parseFloat(value.trim());
                    if (!isNaN(parsed) && parsed > 0 && parsed <= 1.0) {
                        this.plugin.settings.imageQuality = parsed;
                        await this.plugin.saveSettings();
                    }
                }));

        // ============================================================
        // 🦊 GitLab 連携 & 容量ゼロ化設定 (マルチサーバー対応 Step 2)
        // ============================================================
        containerEl.createEl('h3', { text: '🦊 GitLab 連携 & 容量ゼロ化設定 (マルチサーバー対応)' });

        new Setting(containerEl)
            .setName('GitLab Uploads へのバイナリオフロード')
            .setDesc('D&D投入された画像やOffice/PDF原本を GitLab Projects Uploads API に直接保存し、ローカルVaultのSSDおよびGitリポジトリ消費を0バイト化します')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.gitlabUploadsEnabled ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.gitlabUploadsEnabled = value;
                    await this.plugin.saveSettings();
                }));

        const servers = this.plugin.settings.gitlabServers || [];

        if (servers.length > 0) {
            new Setting(containerEl)
                .setName('既定の GitLab サーバー')
                .setDesc('ノートブック側でサーバーが未指定の場合に自動適用される優先サーバーを選択します')
                .addDropdown(dropdown => {
                    for (const s of servers) {
                        dropdown.addOption(s.id, `${s.name} (${s.baseUrl})`);
                    }
                    dropdown.setValue(this.plugin.settings.defaultGitLabServerId || servers[0].id);
                    dropdown.onChange(async (value) => {
                        this.plugin.settings.defaultGitLabServerId = value;
                        await this.plugin.saveSettings();
                    });
                });
        }

        const serverHeaderSetting = new Setting(containerEl)
            .setName('登録済み GitLab サーバー一覧')
            .setDesc('全社GitLab、特定部署用GitLab、GitLab.com などを複数登録して使い分けられます');

        serverHeaderSetting.addButton(btn => btn
            .setButtonText('➕ 新規サーバー追加')
            .setCta()
            .onClick(() => {
                new GitLabServerModal(this.app, this.plugin, null, () => {
                    this.display();
                }).open();
            }));

        if (servers.length === 0) {
            const emptyEl = containerEl.createDiv({ cls: 'ai-notebook-empty-box' });
            emptyEl.createDiv({
                text: '登録されている GitLab サーバーはありません。「新規サーバー追加」から社内GitLab等を登録すると、バイナリオフロードやソースコード検索が利用可能になります。',
                cls: 'ai-notebook-empty-text'
            });
        } else {
            const serverListContainer = containerEl.createDiv({ cls: 'ai-notebook-settings-preset-list' });
            for (const s of servers) {
                const isDefault = (this.plugin.settings.defaultGitLabServerId === s.id) || (servers.length === 1);
                const defaultBadge = isDefault ? ' ★既定' : '';
                const projText = s.defaultProjectId ? ` / プロジェクト: ${s.defaultProjectId}` : ' (プロジェクト未指定)';

                const itemSetting = new Setting(serverListContainer)
                    .setName(`🦊 ${s.name}${defaultBadge}`)
                    .setDesc(`URL: ${s.baseUrl}${projText}`);

                // 疎通テストボタン
                itemSetting.addButton(btn => btn
                    .setButtonText('🔌 テスト')
                    .onClick(async () => {
                        btn.setButtonText('確認中...');
                        btn.setDisabled(true);
                        const res = await this.plugin.gitlabService.testConnection(s, s.defaultProjectId);
                        btn.setButtonText('🔌 テスト');
                        btn.setDisabled(false);
                        if (res.success) {
                            new Notice(res.message, 6000);
                        } else {
                            new Notice(`❌ ${res.message}`, 8000);
                        }
                    }));

                // 編集ボタン
                itemSetting.addButton(btn => btn
                    .setButtonText('編集')
                    .onClick(() => {
                        new GitLabServerModal(this.app, this.plugin, s, () => {
                            this.display();
                        }).open();
                    }));

                // 削除ボタン
                itemSetting.addButton(btn => btn
                    .setButtonText('削除')
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.gitlabServers = servers.filter(item => item.id !== s.id);
                        if (this.plugin.settings.defaultGitLabServerId === s.id) {
                            this.plugin.settings.defaultGitLabServerId = this.plugin.settings.gitlabServers[0]?.id || '';
                        }
                        await this.plugin.saveSettings();
                        new Notice(`GitLab サーバー「${s.name}」を削除しました`);
                        this.display();
                    }));
            }
        }

        // ============================================================
        // 🛠️ デバッグ機能設定 (将来不要時に容易に撤去可能)
        // ============================================================
        containerEl.createEl('h3', { text: '🛠️ デバッグ機能' });

        new Setting(containerEl)
            .setName('デバッグ動線・切り分けログを表示')
            .setDesc('ソースパネルの Finder / 左ペイン展開ボタン、各ファイルのデバッグ詳細確認、および D&D 時の DevTools 詳細パイプラインログを有効化します')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDebugActions ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.enableDebugActions = value;
                    await this.plugin.saveSettings();
                }));
    }
}


