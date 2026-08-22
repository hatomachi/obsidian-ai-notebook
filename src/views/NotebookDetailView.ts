import { ItemView, WorkspaceLeaf, setIcon, TFile, Notice, FileSystemAdapter } from 'obsidian';
import type AINotebookPlugin from '../main';
import { NotebookMetadata, NotebookSource, NotebookArtifact, ChatMessage } from '../types';
import { ArtifactModal } from './modals/ArtifactModal';
import { AgentFactory } from '../adapters/AgentFactory';
import * as path from 'path';

export const VIEW_TYPE_DETAIL = 'ai-notebook-detail';

export class AINotebookDetailView extends ItemView {
    plugin: AINotebookPlugin;
    notebookId: string | null = null;
    metadata: NotebookMetadata | null = null;

    sources: NotebookSource[] = [];
    artifacts: NotebookArtifact[] = [];
    chatHistory: ChatMessage[] = [];

    onBackToGalleryHandler?: () => void;
    onSendMessageHandler?: (prompt: string) => Promise<void>;

    constructor(leaf: WorkspaceLeaf, plugin: AINotebookPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_DETAIL;
    }

    getDisplayText(): string {
        return this.metadata ? this.metadata.title : 'AI Notebook';
    }

    async onOpen(): Promise<void> {
        this.onSendMessageHandler = async (prompt: string) => {
            await this.handleSendMessage(prompt);
        };
        await this.refresh();
    }

    getIcon(): string {
        return 'book-open';
    }

    async setNotebookId(id: string): Promise<void> {
        this.notebookId = id;
        this.onSendMessageHandler = async (prompt: string) => {
            await this.handleSendMessage(prompt);
        };
        await this.refresh();
    }

    async refresh(reloadFromDisk: boolean = true): Promise<void> {
        if (!this.notebookId) return;

        this.metadata = await this.plugin.notebookManager.getNotebookMetadata(this.notebookId);
        this.sources = await this.plugin.notebookManager.getSources(this.notebookId);
        this.artifacts = await this.plugin.notebookManager.getArtifacts(this.notebookId);
        if (reloadFromDisk) {
            this.chatHistory = await this.plugin.notebookManager.getChatHistory(this.notebookId);
        }

        this.render();
    }

    render(): void {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('ai-notebook-detail-container');

        if (!this.metadata) {
            container.createDiv({ text: 'ノートブックが見つかりません', cls: 'ai-notebook-empty-notice' });
            return;
        }

        // 1. トップナビゲーションバー
        const header = container.createDiv({ cls: 'ai-notebook-detail-header' });
        
        const backBtn = header.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-secondary' });
        setIcon(backBtn, 'arrow-left');
        backBtn.createSpan({ text: ' ギャラリー' });
        backBtn.onclick = () => {
            if (this.onBackToGalleryHandler) {
                this.onBackToGalleryHandler();
            }
        };

        const titleArea = header.createDiv({ cls: 'ai-notebook-detail-title-area' });
        titleArea.createEl('h2', { text: this.metadata.title, cls: 'ai-notebook-detail-title' });

        const agentBadge = header.createDiv({ cls: 'ai-notebook-agent-badge' });
        setIcon(agentBadge, 'cpu');
        const agentName = this.plugin.settings.activeAgent === 'antigravity' ? 'Antigravity CLI' : 'Claude Code CLI';
        agentBadge.createSpan({ text: ` Agent: ${agentName}` });

        // 2. 3カラムボディレイアウト
        const body = container.createDiv({ cls: 'ai-notebook-detail-body' });

        // --- LEFT COLUMN: SOURCE PANEL ---
        const leftPanel = body.createDiv({ cls: 'ai-notebook-panel ai-notebook-panel-sources' });
        this.renderSourcePanel(leftPanel);

        // --- CENTER COLUMN: CHAT PANEL ---
        const centerPanel = body.createDiv({ cls: 'ai-notebook-panel ai-notebook-panel-chat' });
        this.renderChatPanel(centerPanel);

        // --- RIGHT COLUMN: ARTIFACT PANEL ---
        const rightPanel = body.createDiv({ cls: 'ai-notebook-panel ai-notebook-panel-artifacts' });
        this.renderArtifactPanel(rightPanel);
    }

    /**
     * ソースパネルのレンダリング（D&Dエリア ＋ ソース一覧）
     */
    private renderSourcePanel(panel: HTMLElement): void {
        panel.empty();

        const panelHeader = panel.createDiv({ cls: 'ai-notebook-panel-header' });
        panelHeader.createEl('h3', { text: 'ソース (Inputs)' });
        
        const countBadge = panelHeader.createSpan({ text: `${this.sources.length}`, cls: 'ai-notebook-count-badge' });

        // D&D ドロップゾーン
        const dropZone = panel.createDiv({ cls: 'ai-notebook-dropzone' });
        const dropIcon = dropZone.createDiv({ cls: 'ai-notebook-dropzone-icon' });
        setIcon(dropIcon, 'upload-cloud');
        dropZone.createDiv({ text: 'ファイルをドロップ または 選択', cls: 'ai-notebook-dropzone-label' });

        // 隠し file input
        const fileInput = dropZone.createEl('input', { type: 'file' });
        fileInput.multiple = true;
        fileInput.style.display = 'none';

        dropZone.onclick = () => fileInput.click();

        fileInput.onchange = async () => {
            if (fileInput.files && fileInput.files.length > 0) {
                await this.handleFilesAdded(fileInput.files);
            }
        };

        // ドラッグ＆ドロップ イベントハンドラー
        dropZone.ondragover = (e) => {
            e.preventDefault();
            dropZone.addClass('is-dragover');
        };
        dropZone.ondragleave = () => {
            dropZone.removeClass('is-dragover');
        };
        dropZone.ondrop = async (e) => {
            e.preventDefault();
            dropZone.removeClass('is-dragover');
            if (e.dataTransfer && e.dataTransfer.files.length > 0) {
                await this.handleFilesAdded(e.dataTransfer.files);
            }
        };

        // ソース一覧リスト
        const sourceList = panel.createDiv({ cls: 'ai-notebook-source-list' });
        if (this.sources.length === 0) {
            sourceList.createDiv({ text: 'ソースファイルがありません', cls: 'ai-notebook-empty-text' });
        } else {
            for (const src of this.sources) {
                const item = sourceList.createDiv({ cls: 'ai-notebook-source-item' });
                
                const iconSpan = item.createSpan({ cls: 'ai-notebook-source-icon' });
                setIcon(iconSpan, this.getFileIcon(src.extension));

                const nameSpan = item.createSpan({ text: src.name, cls: 'ai-notebook-source-name' });
                nameSpan.setAttribute('title', src.name);

                const deleteBtn = item.createEl('button', { cls: 'ai-notebook-item-delete-btn' });
                setIcon(deleteBtn, 'x');
                deleteBtn.setAttribute('title', '削除');
                deleteBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (!this.notebookId) return;
                    await this.plugin.notebookManager.deleteSourceFile(this.notebookId, src.name);
                    await this.refresh();
                };
            }
        }
    }

    /**
     * ファイル投入の処理ハンドラー
     */
    private async handleFilesAdded(files: FileList): Promise<void> {
        if (!this.notebookId) return;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const buffer = await file.arrayBuffer();
            await this.plugin.notebookManager.addSourceFile(this.notebookId, file.name, buffer);
        }

        new Notice(`${files.length} 件のファイルをソースに追加しました`);
        await this.refresh();
    }

    /**
     * チャットパネルのレンダリング
     */
    private renderChatPanel(panel: HTMLElement): void {
        panel.empty();

        const panelHeader = panel.createDiv({ cls: 'ai-notebook-panel-header' });
        panelHeader.createEl('h3', { text: 'AI チャット' });

        // メッセージ履歴
        const messagesEl = panel.createDiv({ cls: 'ai-notebook-chat-messages' });
        if (this.chatHistory.length === 0) {
            const emptyEl = messagesEl.createDiv({ cls: 'ai-notebook-chat-placeholder' });
            setIcon(emptyEl.createDiv({ cls: 'ai-notebook-chat-placeholder-icon' }), 'bot');
            emptyEl.createDiv({ text: 'インプットソースをもとに、AIエージェントに何でも質問してください。', cls: 'ai-notebook-chat-placeholder-text' });
        } else {
            for (const msg of this.chatHistory) {
                const msgBubble = messagesEl.createDiv({
                    cls: `ai-notebook-chat-message ai-notebook-chat-message-${msg.sender}`
                });
                msgBubble.createDiv({ text: msg.text, cls: 'ai-notebook-chat-text' });
            }
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        // 入力フォーム
        const inputArea = panel.createDiv({ cls: 'ai-notebook-chat-input-area' });
        const textarea = inputArea.createEl('textarea', {
            placeholder: 'ソースフォルダをもとに会話・成果物作成指示...',
            cls: 'ai-notebook-chat-textarea'
        });

        const sendBtn = inputArea.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-primary' });
        setIcon(sendBtn, 'send');
        sendBtn.setAttribute('title', '送信');

        const doSend = async () => {
            const prompt = textarea.value.trim();
            if (!prompt) return;

            console.log('[AI Notebook] Triggering doSend with prompt:', prompt);
            textarea.value = '';
            
            if (this.onSendMessageHandler) {
                await this.onSendMessageHandler(prompt);
            } else {
                console.warn('[AI Notebook] onSendMessageHandler is not registered!');
            }
        };

        sendBtn.onclick = doSend;
        textarea.onkeydown = (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    doSend();
                }
            }
        };
    }

    /**
     * 成果物パネルのレンダリング
     */
    private renderArtifactPanel(panel: HTMLElement): void {
        panel.empty();

        const panelHeader = panel.createDiv({ cls: 'ai-notebook-panel-header' });
        panelHeader.createEl('h3', { text: '成果物 (Notes & Reports)' });

        const headerActions = panelHeader.createDiv({ cls: 'ai-notebook-panel-header-actions' });
        
        // 手動成果物追加ボタン
        const addBtn = headerActions.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-icon-only' });
        setIcon(addBtn, 'plus');
        addBtn.setAttribute('title', '新規成果物メモ作成');
        addBtn.onclick = async () => {
            if (!this.notebookId) return;
            const title = prompt('成果物のタイトルを入力してください:', '新しいメモ');
            if (title) {
                const file = await this.plugin.notebookManager.addArtifactFile(this.notebookId, title, `# ${title}\n\n`);
                await this.refresh();
                new ArtifactModal(this.app, this.plugin.notebookManager, this.notebookId, file, async () => {
                    await this.refresh();
                }).open();
            }
        };

        // 成果物カード一覧
        const artifactList = panel.createDiv({ cls: 'ai-notebook-artifact-list' });
        if (this.artifacts.length === 0) {
            artifactList.createDiv({ text: '生成された成果物がありません', cls: 'ai-notebook-empty-text' });
        } else {
            for (const art of this.artifacts) {
                const card = artifactList.createDiv({ cls: 'ai-notebook-artifact-card' });
                
                const cardHeader = card.createDiv({ cls: 'ai-notebook-artifact-card-header' });
                const iconSpan = cardHeader.createSpan({ cls: 'ai-notebook-artifact-card-icon' });
                setIcon(iconSpan, 'file-text');

                cardHeader.createEl('h4', { text: art.title, cls: 'ai-notebook-artifact-card-title' });

                card.onclick = () => {
                    if (!this.notebookId) return;
                    const file = this.app.vault.getAbstractFileByPath(art.path);
                    if (file instanceof TFile) {
                        new ArtifactModal(this.app, this.plugin.notebookManager, this.notebookId, file, async () => {
                            await this.refresh();
                        }).open();
                    }
                };
            }
        }
    }

    /**
     * AI CLI エージェント実行ハンドラー
     */
    private async handleSendMessage(userPrompt: string): Promise<void> {
        if (!this.notebookId) {
            console.warn('[AI Notebook] handleSendMessage failed: notebookId is null');
            return;
        }

        console.log(`[AI Notebook] Starting handleSendMessage for notebookId: ${this.notebookId}`);

        // 1. ユーザーメッセージを履歴に追加
        const userMsg: ChatMessage = {
            id: Date.now().toString(),
            sender: 'user',
            text: userPrompt,
            timestamp: new Date().toISOString()
        };
        this.chatHistory.push(userMsg);

        // 2. ローディング（思考中）表示用の仮メッセージ追加
        const loadingMsgId = (Date.now() + 1).toString();
        const loadingMsg: ChatMessage = {
            id: loadingMsgId,
            sender: 'agent',
            text: '思考中... (AIエージェント実行中)',
            timestamp: new Date().toISOString()
        };
        this.chatHistory.push(loadingMsg);

        // ディスク保存 & メモリ状態を維持したUI再描画
        await this.plugin.notebookManager.saveChatHistory(this.notebookId, this.chatHistory);
        await this.refresh(false);

        try {
            // Vault のローカル絶対パスを取得
            let vaultBasePath = '';
            const adapter = this.app.vault.adapter;
            if (adapter instanceof FileSystemAdapter) {
                vaultBasePath = adapter.getBasePath();
            }

            const sourcesRelative = `${this.plugin.settings.rootDir}/notebooks/${this.notebookId}/sources`;
            const artifactsRelative = `${this.plugin.settings.rootDir}/notebooks/${this.notebookId}/artifacts`;

            const contextDirAbs = path.join(vaultBasePath, sourcesRelative);
            const outputDirAbs = path.join(vaultBasePath, artifactsRelative);

            console.log(`[AI Notebook] contextDirAbs: ${contextDirAbs}`);

            const agentAdapter = AgentFactory.getAdapter(this.plugin.settings);
            const commandPath = AgentFactory.getCommandPath(this.plugin.settings);

            console.log(`[AI Notebook] Agent: ${agentAdapter.name}, commandPath: ${commandPath}`);

            // 3. AI エージェントの実行
            const result = await agentAdapter.executePrompt(userPrompt, {
                contextDir: contextDirAbs,
                outputDir: outputDirAbs,
                commandPath: commandPath
            });

            console.log(`[AI Notebook] Agent response text received. Length: ${result.text.length}`);

            // 仮ローディングメッセージの置換
            const lastIdx = this.chatHistory.findIndex(m => m.id === loadingMsgId);
            if (lastIdx !== -1) {
                this.chatHistory[lastIdx].text = result.text || '(AIからの応答本文が空です)';
                console.log('[AI Notebook] Successfully replaced loading message with AI response');
            } else {
                console.warn('[AI Notebook] Could not find loading message in chatHistory!');
                this.chatHistory.push({
                    id: Date.now().toString(),
                    sender: 'agent',
                    text: result.text || '(AIからの応答本文が空です)',
                    timestamp: new Date().toISOString()
                });
            }

            // 4. レスポンス内の Markdown Code Block から成果物ファイルの自動抽出・保存
            const codeBlockRegex = /```markdown:([^\n]+)\n([\s\S]*?)```/g;
            let match;
            while ((match = codeBlockRegex.exec(result.text)) !== null) {
                const title = match[1].trim();
                const content = match[2].trim();
                console.log(`[AI Notebook] Extracted artifact: "${title}"`);
                await this.plugin.notebookManager.addArtifactFile(this.notebookId, title, content);
                new Notice(`成果物 "${title}" が生成されました`);
            }

            await this.plugin.notebookManager.saveChatHistory(this.notebookId, this.chatHistory);
        } catch (error: any) {
            console.error('[AI Notebook] Agent Execution Error:', error);
            const lastIdx = this.chatHistory.findIndex(m => m.id === loadingMsgId);
            if (lastIdx !== -1) {
                this.chatHistory[lastIdx].text = `⚠️ AIエージェント実行エラー: ${error.message || error}`;
            }
            await this.plugin.notebookManager.saveChatHistory(this.notebookId, this.chatHistory);
        } finally {
            await this.refresh(false);
        }
    }

    private getFileIcon(ext: string): string {
        switch (ext.toLowerCase()) {
            case 'pdf': return 'file-text';
            case 'png': case 'jpg': case 'jpeg': case 'svg': case 'webp': return 'image';
            case 'pptx': case 'ppt': return 'presentation';
            case 'md': case 'txt': return 'file-code';
            default: return 'file';
        }
    }
}
