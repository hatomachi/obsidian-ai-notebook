import { App, Modal, Notice } from 'obsidian';
import type AINotebookPlugin from '../../main';
import { ConfluenceServerConfig } from '../../types';

export class ConfluenceServerModal extends Modal {
    plugin: AINotebookPlugin;
    server: ConfluenceServerConfig | null;
    onSaveCallback: () => void;

    private name: string = '';
    private baseUrl: string = '';
    private authType: 'bearer' | 'basic' = 'bearer';
    private username: string = '';
    private token: string = '';
    private defaultSpaceKey: string = '';

    constructor(
        app: App,
        plugin: AINotebookPlugin,
        server: ConfluenceServerConfig | null,
        onSaveCallback: () => void
    ) {
        super(app);
        this.plugin = plugin;
        this.server = server;
        this.onSaveCallback = onSaveCallback;

        if (server) {
            this.name = server.name;
            this.baseUrl = server.baseUrl;
            this.authType = server.authType || 'bearer';
            this.username = server.username || '';
            this.token = server.token;
            this.defaultSpaceKey = server.defaultSpaceKey || '';
        }
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-notebook-modal', 'ai-notebook-confluence-modal');

        const titleText = this.server ? '🌐 Confluence サーバー設定の編集' : '🌐 新規 Confluence サーバーの追加';
        contentEl.createEl('h2', { text: titleText });

        // サーバー表示名
        const nameGroup = contentEl.createDiv({ cls: 'ai-notebook-form-group' });
        nameGroup.createEl('label', { text: 'サーバー表示名' });
        nameGroup.createEl('small', { text: '識別しやすい名前（例: 社内本番Confluence, 開発Wiki, ローカルモック）', cls: 'ai-notebook-field-desc' });
        const nameInput = nameGroup.createEl('input', {
            type: 'text',
            value: this.name,
            placeholder: '例: 社内本番Confluence'
        });
        nameInput.oninput = () => {
            this.name = nameInput.value.trim();
        };

        // ホストURL
        const urlGroup = contentEl.createDiv({ cls: 'ai-notebook-form-group' });
        urlGroup.createEl('label', { text: 'Confluence ホストURL' });
        urlGroup.createEl('small', { text: 'Confluence のベースURL（例: https://confluence.example.com または http://localhost:3333）', cls: 'ai-notebook-field-desc' });
        const urlInput = urlGroup.createEl('input', {
            type: 'text',
            value: this.baseUrl,
            placeholder: 'https://confluence.company.internal'
        });
        urlInput.oninput = () => {
            this.baseUrl = urlInput.value.trim();
        };

        // 認証タイプ
        const authTypeGroup = contentEl.createDiv({ cls: 'ai-notebook-form-group' });
        authTypeGroup.createEl('label', { text: '認証方式' });
        const authSelect = authTypeGroup.createEl('select');
        const optBearer = authSelect.createEl('option', { value: 'bearer', text: 'Bearer Token (Server / Data Center PAT)' });
        const optBasic = authSelect.createEl('option', { value: 'basic', text: 'Basic 認証 (Cloud API Token / ユーザー名)' });
        authSelect.value = this.authType;

        // ユーザー名 / Email (Basic時のみ表示)
        const usernameGroup = contentEl.createDiv({ cls: 'ai-notebook-form-group' });
        usernameGroup.createEl('label', { text: 'ユーザー名 / メールアドレス' });
        usernameGroup.createEl('small', { text: 'Atlassian Cloud の場合は登録メールアドレスを入力', cls: 'ai-notebook-field-desc' });
        const usernameInput = usernameGroup.createEl('input', {
            type: 'text',
            value: this.username,
            placeholder: 'user@example.com'
        });
        usernameInput.oninput = () => {
            this.username = usernameInput.value.trim();
        };

        const updateAuthVisibility = () => {
            if (this.authType === 'basic') {
                usernameGroup.style.display = 'block';
            } else {
                usernameGroup.style.display = 'none';
            }
        };
        authSelect.onchange = () => {
            this.authType = authSelect.value as 'bearer' | 'basic';
            updateAuthVisibility();
        };
        updateAuthVisibility();

        // トークン入力
        const tokenGroup = contentEl.createDiv({ cls: 'ai-notebook-form-group' });
        tokenGroup.createEl('label', { text: 'トークン / パスワード' });
        tokenGroup.createEl('small', { text: 'Personal Access Token (PAT) または Atlassian API Token', cls: 'ai-notebook-field-desc' });
        const tokenInput = tokenGroup.createEl('input', {
            type: 'password',
            value: this.token,
            placeholder: 'トークン文字列'
        });
        tokenInput.oninput = () => {
            this.token = tokenInput.value.trim();
        };

        // デフォルトスペースキー (任意)
        const spaceGroup = contentEl.createDiv({ cls: 'ai-notebook-form-group' });
        spaceGroup.createEl('label', { text: 'デフォルトスペースキー (任意)' });
        spaceGroup.createEl('small', { text: '既定で優先検索するスペース（例: DEV-ARCH）', cls: 'ai-notebook-field-desc' });
        const spaceInput = spaceGroup.createEl('input', {
            type: 'text',
            value: this.defaultSpaceKey,
            placeholder: '例: DEV-ARCH'
        });
        spaceInput.oninput = () => {
            this.defaultSpaceKey = spaceInput.value.trim();
        };

        // テスト接続結果エリア
        const testResultEl = contentEl.createDiv({ cls: 'ai-notebook-test-result' });
        testResultEl.style.display = 'none';
        testResultEl.style.marginBottom = '12px';

        // アクションボタン行
        const actionsRow = contentEl.createDiv({ cls: 'ai-notebook-modal-actions', attr: { style: 'display: flex; gap: 8px; justify-content: flex-end;' } });

        // テスト接続ボタン
        const testBtn = actionsRow.createEl('button', { text: '🔌 接続テスト' });
        testBtn.onclick = async () => {
            if (!this.baseUrl) {
                new Notice('ホストURLを入力してください');
                return;
            }
            if (!this.token) {
                new Notice('トークンを入力してください');
                return;
            }

            testBtn.disabled = true;
            testBtn.setText('テスト中...');
            testResultEl.style.display = 'block';
            testResultEl.setText('接続確認中...');
            testResultEl.className = 'ai-notebook-test-result';

            const tempConfig: ConfluenceServerConfig = {
                id: this.server?.id || 'temp',
                name: this.name || 'Test',
                baseUrl: this.baseUrl,
                authType: this.authType,
                username: this.username,
                token: this.token,
                defaultSpaceKey: this.defaultSpaceKey
            };

            try {
                const res = await (this.plugin as any).confluenceService.testConnection(tempConfig);
                testResultEl.setText(res.message);
                if (res.success) {
                    testResultEl.addClass('ai-notebook-success');
                } else {
                    testResultEl.addClass('ai-notebook-error');
                }
            } catch (err: any) {
                testResultEl.setText(`エラー: ${err?.message || String(err)}`);
                testResultEl.addClass('ai-notebook-error');
            } finally {
                testBtn.disabled = false;
                testBtn.setText('🔌 接続テスト');
            }
        };

        // キャンセルボタン
        const cancelBtn = actionsRow.createEl('button', { text: 'キャンセル' });
        cancelBtn.onclick = () => this.close();

        // 保存ボタン
        const saveBtn = actionsRow.createEl('button', { text: '💾 保存', cls: 'mod-cta' });
        saveBtn.onclick = async () => {
            if (!this.name) {
                new Notice('サーバー表示名を入力してください');
                return;
            }
            if (!this.baseUrl) {
                new Notice('ホストURLを入力してください');
                return;
            }
            if (!this.token) {
                new Notice('トークンを入力してください');
                return;
            }

            const servers = this.plugin.settings.confluenceServers || [];
            if (this.server) {
                // 既存編集
                const idx = servers.findIndex(s => s.id === this.server!.id);
                if (idx >= 0) {
                    servers[idx] = {
                        ...this.server,
                        name: this.name,
                        baseUrl: this.baseUrl,
                        authType: this.authType,
                        username: this.username,
                        token: this.token,
                        defaultSpaceKey: this.defaultSpaceKey
                    };
                }
            } else {
                // 新規作成
                const newServer: ConfluenceServerConfig = {
                    id: `confluence_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    name: this.name,
                    baseUrl: this.baseUrl,
                    authType: this.authType,
                    username: this.username,
                    token: this.token,
                    defaultSpaceKey: this.defaultSpaceKey
                };
                servers.push(newServer);
                if (!this.plugin.settings.defaultConfluenceServerId) {
                    this.plugin.settings.defaultConfluenceServerId = newServer.id;
                }
            }

            this.plugin.settings.confluenceServers = servers;
            await this.plugin.saveSettings();
            new Notice(`Confluence サーバー "${this.name}" を保存しました`);
            this.onSaveCallback();
            this.close();
        };
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
