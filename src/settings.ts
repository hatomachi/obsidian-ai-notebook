import { App, PluginSettingTab, Setting } from 'obsidian';
import type AINotebookPlugin from './main';
import { AIAgentType } from './types';

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
    }
}
