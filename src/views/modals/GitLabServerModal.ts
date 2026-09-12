import { App, Modal, Notice } from 'obsidian';
import type AINotebookPlugin from '../../main';
import { GitLabServerConfig } from '../../types';

export class GitLabServerModal extends Modal {
    plugin: AINotebookPlugin;
    server: GitLabServerConfig | null; // null の場合は新規作成
    onSaveCallback: () => void;

    private name: string = '';
    private baseUrl: string = '';
    private token: string = '';
    private defaultProjectId: string = '';

    constructor(
        app: App,
        plugin: AINotebookPlugin,
        server: GitLabServerConfig | null,
        onSaveCallback: () => void
    ) {
        super(app);
        this.plugin = plugin;
        this.server = server;
        this.onSaveCallback = onSaveCallback;

        if (server) {
            this.name = server.name;
            this.baseUrl = server.baseUrl;
            this.token = server.token;
            this.defaultProjectId = server.defaultProjectId || '';
        }
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-notebook-modal', 'ai-notebook-gitlab-modal');

        const titleText = this.server ? '🦊 GitLab サーバー設定の編集' : '🦊 新規 GitLab サーバーの追加';
        contentEl.createEl('h2', { text: titleText });

        // サーバー表示名
        const nameGroup = contentEl.createDiv({ cls: 'ai-notebook-form-group' });
        nameGroup.createEl('label', { text: 'サーバー表示名' });
        nameGroup.createEl('small', { text: '識別しやすい名前（例: 全社本番GitLab, 開発用GitLab, gitlab.com）', cls: 'ai-notebook-field-desc' });
        const nameInput = nameGroup.createEl('input', {
            type: 'text',
            value: this.name,
            placeholder: '例: 全社本番GitLab'
        });
        nameInput.oninput = () => {
            this.name = nameInput.value.trim();
        };

        // ホストURL
        const urlGroup = contentEl.createDiv({ cls: 'ai-notebook-form-group' });
        urlGroup.createEl('label', { text: 'GitLab ホストURL' });
        urlGroup.createEl('small', { text: 'GitLab のベースURL（例: https://gitlab.example.com または /api/v4 まで）', cls: 'ai-notebook-field-desc' });
        const urlInput = urlGroup.createEl('input', {
            type: 'text',
            value: this.baseUrl,
            placeholder: 'https://gitlab.example.com'
        });
        urlInput.oninput = () => {
            this.baseUrl = urlInput.value.trim();
        };

        // Access Token
        const tokenGroup = contentEl.createDiv({ cls: 'ai-notebook-form-group' });
        tokenGroup.createEl('label', { text: 'Access Token (PAT または Project Token)' });
        tokenGroup.createEl('small', { text: 'api スコープを持つアクセストークンを入力してください', cls: 'ai-notebook-field-desc' });
        const tokenInput = tokenGroup.createEl('input', {
            type: 'password',
            value: this.token,
            placeholder: 'glpat-xxxxxxxxxxxxxxxxxxxx'
        });
        tokenInput.oninput = () => {
            this.token = tokenInput.value.trim();
        };

        // デフォルトプロジェクトID
        const projectGroup = contentEl.createDiv({ cls: 'ai-notebook-form-group' });
        projectGroup.createEl('label', { text: 'アップロード先プロジェクト ID / パス (任意)' });
        projectGroup.createEl('small', { text: 'バイナリ保存先として使用する既定プロジェクト（例: 1234 または mygroup/ainotebook-uploads）', cls: 'ai-notebook-field-desc' });
        const projectInput = projectGroup.createEl('input', {
            type: 'text',
            value: this.defaultProjectId,
            placeholder: '例: 1234 または mygroup/myproject'
        });
        projectInput.oninput = () => {
            this.defaultProjectId = projectInput.value.trim();
        };

        // 接続テストセクション
        const testSection = contentEl.createDiv({ cls: 'ai-notebook-test-section' });
        const testBtn = testSection.createEl('button', {
            text: '🔌 接続テスト実行',
            cls: 'ai-notebook-btn ai-notebook-btn-secondary'
        });
        const testResultEl = testSection.createDiv({ cls: 'ai-notebook-test-result' });

        testBtn.onclick = async () => {
            if (!this.baseUrl || !this.token) {
                testResultEl.empty();
                testResultEl.setText('⚠️ URLとアクセストークンを入力してください。');
                testResultEl.className = 'ai-notebook-test-result is-error';
                return;
            }

            testResultEl.empty();
            testResultEl.setText('接続確認中...');
            testResultEl.className = 'ai-notebook-test-result is-testing';

            const tempConfig: GitLabServerConfig = {
                id: this.server?.id || 'temp',
                name: this.name || 'テストサーバー',
                baseUrl: this.baseUrl,
                token: this.token,
                defaultProjectId: this.defaultProjectId
            };

            const res = await this.plugin.gitlabService.testConnection(tempConfig, this.defaultProjectId);
            testResultEl.empty();
            testResultEl.setText(res.message);
            testResultEl.className = `ai-notebook-test-result ${res.success ? 'is-success' : 'is-error'}`;
        };

        // アクションボタン
        const btnRow = contentEl.createDiv({ cls: 'ai-notebook-modal-buttons' });
        const cancelBtn = btnRow.createEl('button', {
            text: 'キャンセル',
            cls: 'ai-notebook-btn ai-notebook-btn-secondary'
        });
        cancelBtn.onclick = () => this.close();

        const saveBtn = btnRow.createEl('button', {
            text: '💾 保存',
            cls: 'ai-notebook-btn ai-notebook-btn-primary'
        });
        saveBtn.onclick = async () => {
            await this.handleSave();
        };
    }

    private async handleSave(): Promise<void> {
        if (!this.name.trim()) {
            new Notice('サーバー表示名を入力してください');
            return;
        }
        if (!this.baseUrl.trim()) {
            new Notice('GitLab ホストURLを入力してください');
            return;
        }
        if (!this.token.trim()) {
            new Notice('アクセストークンを入力してください');
            return;
        }

        const servers = this.plugin.settings.gitlabServers || [];
        const serverId = this.server ? this.server.id : `gitlab_${Date.now()}`;

        const configToSave: GitLabServerConfig = {
            id: serverId,
            name: this.name.trim(),
            baseUrl: this.baseUrl.trim(),
            token: this.token.trim(),
            defaultProjectId: this.defaultProjectId.trim() || undefined
        };

        if (this.server) {
            // 更新
            this.plugin.settings.gitlabServers = servers.map(s => s.id === serverId ? configToSave : s);
        } else {
            // 新規追加
            servers.push(configToSave);
            this.plugin.settings.gitlabServers = servers;
            // 最初のサーバーなら自動的にデフォルトに設定
            if (!this.plugin.settings.defaultGitLabServerId) {
                this.plugin.settings.defaultGitLabServerId = serverId;
            }
        }

        await this.plugin.saveSettings();
        this.plugin.gitlabService.updateSettings(this.plugin.settings);
        new Notice(`GitLab サーバー「${configToSave.name}」を保存しました`);
        this.close();
        this.onSaveCallback();
    }
}
