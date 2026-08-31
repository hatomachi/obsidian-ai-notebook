import { ItemView, WorkspaceLeaf, setIcon, TFile, Notice, FileSystemAdapter, MarkdownRenderer } from 'obsidian';
import type AINotebookPlugin from '../main';
import { NotebookMetadata, NotebookSource, NotebookArtifact, ChatMessage } from '../types';
import { ArtifactModal } from './modals/ArtifactModal';
import { LinkNotebookModal } from './modals/LinkNotebookModal';
import { AgentFactory } from '../adapters/AgentFactory';
import * as path from 'path';

export const VIEW_TYPE_DETAIL = 'ai-notebook-detail';

export class AINotebookDetailView extends ItemView {
    plugin: AINotebookPlugin;
    notebookId: string | null = null;
    metadata: NotebookMetadata | null = null;

    sources: NotebookSource[] = [];
    artifacts: NotebookArtifact[] = [];
    linkedNotebooks: NotebookMetadata[] = [];
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

        // リンクされた参照ノートブックのメタデータをロード
        this.linkedNotebooks = [];
        if (this.metadata?.linkedNotebookIds && this.metadata.linkedNotebookIds.length > 0) {
            for (const linkedId of this.metadata.linkedNotebookIds) {
                const linkedMeta = await this.plugin.notebookManager.getNotebookMetadata(linkedId);
                if (linkedMeta) {
                    this.linkedNotebooks.push(linkedMeta);
                }
            }
        }

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

        // 1. トップナビゲーションバー（クリーン & シンプル）
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
        const iconSpan = titleArea.createSpan({ cls: 'ai-notebook-detail-title-icon' });
        setIcon(iconSpan, this.metadata.icon || 'book-open');
        titleArea.createEl('h2', { text: this.metadata.title, cls: 'ai-notebook-detail-title' });

        const headerRight = header.createDiv({ cls: 'ai-notebook-header-right' });
        const agentBadge = headerRight.createDiv({ cls: 'ai-notebook-agent-badge' });
        setIcon(agentBadge, 'bot');
        const agentName = this.plugin.settings.activeAgent === 'antigravity' ? 'Antigravity CLI' : 'Claude Code CLI';
        agentBadge.createSpan({ text: ` ${agentName}` });

        // 2. 3カラムボディレイアウト
        const body = container.createDiv({ cls: 'ai-notebook-detail-body' });

        // --- LEFT COLUMN: CONTEXT & SOURCE PANEL ---
        const leftPanel = body.createDiv({ cls: 'ai-notebook-panel ai-notebook-panel-sources' });
        this.renderContextAndSourcePanel(leftPanel);

        // --- CENTER COLUMN: CHAT PANEL ---
        const centerPanel = body.createDiv({ cls: 'ai-notebook-panel ai-notebook-panel-chat' });
        this.renderChatPanel(centerPanel);

        // --- RIGHT COLUMN: ARTIFACT PANEL ---
        const rightPanel = body.createDiv({ cls: 'ai-notebook-panel ai-notebook-panel-artifacts' });
        this.renderArtifactPanel(rightPanel);
    }

    /**
     * コンテキスト & ソースパネルのレンダリング
     * （🔗 参照ノートブック ＋ 📂 直接投入ファイル）
     */
    private renderContextAndSourcePanel(panel: HTMLElement): void {
        panel.empty();

        // ==========================================
        // 1. 参照ノートブック (Linked Context)
        // ==========================================
        const linkedSection = panel.createDiv({ cls: 'ai-notebook-context-section' });
        const linkedHeader = linkedSection.createDiv({ cls: 'ai-notebook-panel-header' });
        
        const linkedTitle = linkedHeader.createEl('h3', { text: '🔗 参照コンテキスト' });
        linkedTitle.setAttribute('title', '仕様書、フォーマットルール、良質サンプルなどのナレッジノート');
        linkedHeader.createSpan({ text: `${this.linkedNotebooks.length}`, cls: 'ai-notebook-count-badge' });

        const addLinkBtn = linkedHeader.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-xs',
            text: '+ 参照追加'
        });
        addLinkBtn.onclick = () => {
            if (!this.notebookId || !this.metadata) return;
            new LinkNotebookModal(
                this.app,
                this.plugin.notebookManager,
                this.notebookId,
                this.metadata.linkedNotebookIds || [],
                async (selectedIds) => {
                    if (!this.notebookId) return;
                    await this.plugin.notebookManager.updateNotebookMetadata(this.notebookId, {
                        linkedNotebookIds: selectedIds
                    });
                    new Notice('参照コンテキストを更新しました');
                    await this.refresh(false);
                }
            ).open();
        };

        const linkedList = linkedSection.createDiv({ cls: 'ai-notebook-linked-list' });
        if (this.linkedNotebooks.length === 0) {
            const emptyEl = linkedList.createDiv({ cls: 'ai-notebook-empty-linked' });
            emptyEl.createDiv({ text: '参照中のナレッジノートはありません', cls: 'ai-notebook-empty-text' });
            const tipEl = emptyEl.createDiv({ text: '「+ 参照追加」から仕様やフォーマットルールを接続できます', cls: 'ai-notebook-hint-text' });
        } else {
            for (const nb of this.linkedNotebooks) {
                const item = linkedList.createDiv({ cls: 'ai-notebook-linked-item' });
                
                const icon = item.createSpan({ cls: 'ai-notebook-linked-icon' });
                setIcon(icon, nb.icon || 'book-open');

                const nameWrap = item.createDiv({ cls: 'ai-notebook-linked-name-wrap' });
                const nameLink = nameWrap.createSpan({ text: nb.title, cls: 'ai-notebook-linked-name' });
                nameLink.setAttribute('title', `クリックして「${nb.title}」へジャンプ`);
                nameLink.onclick = async () => {
                    await this.setNotebookId(nb.id);
                };

                const removeBtn = item.createEl('button', { cls: 'ai-notebook-item-delete-btn' });
                setIcon(removeBtn, 'x');
                removeBtn.setAttribute('title', '参照リンクを解除');
                removeBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (!this.notebookId || !this.metadata) return;
                    const nextIds = (this.metadata.linkedNotebookIds || []).filter(id => id !== nb.id);
                    await this.plugin.notebookManager.updateNotebookMetadata(this.notebookId, {
                        linkedNotebookIds: nextIds
                    });
                    new Notice(`「${nb.title}」の参照を解除しました`);
                    await this.refresh(false);
                };
            }
        }

        // ==========================================
        // 2. 直接投入ファイル (Direct Inputs)
        // ==========================================
        const sourceSection = panel.createDiv({ cls: 'ai-notebook-source-section' });
        const sourceHeader = sourceSection.createDiv({ cls: 'ai-notebook-panel-header' });
        sourceHeader.createEl('h3', { text: '📂 直接投入ファイル' });
        sourceHeader.createSpan({ text: `${this.sources.length}`, cls: 'ai-notebook-count-badge' });

        // D&D ドロップゾーン
        const dropZone = sourceSection.createDiv({ cls: 'ai-notebook-dropzone' });
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
        const sourceList = sourceSection.createDiv({ cls: 'ai-notebook-source-list' });
        if (this.sources.length === 0) {
            sourceList.createDiv({ text: '直接投入ファイルはありません', cls: 'ai-notebook-empty-text' });
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

        // クイックアクションバー
        const actionsBar = panel.createDiv({ cls: 'ai-notebook-chat-actions-bar' });
        
        if (this.linkedNotebooks.length > 0) {
            const draftBtn = actionsBar.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-primary ai-notebook-btn-sm' });
            setIcon(draftBtn, 'sparkles');
            const linkedNames = this.linkedNotebooks.map(n => n.title).join(', ');
            draftBtn.createSpan({ text: ` 🚀 参照コンテキストを踏まえて初稿（ドラフト）を生成` });
            draftBtn.setAttribute('title', `参照中: ${linkedNames}`);
            draftBtn.onclick = async () => {
                const prompt = `インプットソースの内容と、リンクされた参照コンテキスト（${linkedNames}）の仕様・ルール・サンプルをもとに、完成度の高い成果物初稿（ドラフト）を作成してください。注意事項や章立て、ロールバック基準も具体的に記述してください。`;
                await this.handleSendMessage(prompt);
            };
        } else {
            const summarizeBtn = actionsBar.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-sm' });
            setIcon(summarizeBtn, 'sparkles');
            summarizeBtn.createSpan({ text: ' 💡 インプットの要約・分析レポートを生成' });
            summarizeBtn.onclick = async () => {
                await this.handleSendMessage('投入されたインプットソースの内容を詳細に分析し、主要なポイントを整理した要約レポートを作成してください。');
            };
        }

        // メッセージ履歴
        const messagesEl = panel.createDiv({ cls: 'ai-notebook-chat-messages' });
        this.renderMessages(messagesEl);

        // 入力フォーム
        const inputArea = panel.createDiv({ cls: 'ai-notebook-chat-input-area' });
        const textarea = inputArea.createEl('textarea', {
            placeholder: this.linkedNotebooks.length > 0
                ? '参照コンテキストをもとにドキュメント作成・修正・レビュー指示...'
                : 'インプットをもとに会話・成果物作成指示...',
            cls: 'ai-notebook-chat-textarea'
        });

        const sendBtn = inputArea.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-primary' });
        setIcon(sendBtn, 'send');
        sendBtn.setAttribute('title', '送信');

        const doSend = async () => {
            const prompt = textarea.value.trim();
            if (!prompt) return;

            textarea.value = '';
            
            if (this.onSendMessageHandler) {
                await this.onSendMessageHandler(prompt);
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
     * チャットメッセージ履歴のレンダリング (MarkdownRenderer & コピー機能)
     */
    private async renderMessages(messagesEl: HTMLElement): Promise<void> {
        messagesEl.empty();

        if (this.chatHistory.length === 0) {
            const emptyEl = messagesEl.createDiv({ cls: 'ai-notebook-chat-placeholder' });
            setIcon(emptyEl.createDiv({ cls: 'ai-notebook-chat-placeholder-icon' }), 'bot');
            const placeholderText = this.linkedNotebooks.length > 0
                ? `${this.linkedNotebooks.length} 件のナレッジノートがコンテキストとしてリンクされています。上のボタンからドラフト生成するか、チャットで対話してください。`
                : 'インプットソースや参照コンテキストをもとに、AIエージェントに何でも質問・指示してください。';
            emptyEl.createDiv({ text: placeholderText, cls: 'ai-notebook-chat-placeholder-text' });
            return;
        }

        for (const msg of this.chatHistory) {
            const isUser = msg.sender === 'user';
            const msgWrapper = messagesEl.createDiv({
                cls: `ai-notebook-chat-message-wrapper ai-notebook-chat-message-wrapper-${msg.sender}`
            });

            // メッセージヘッダー（送信者名 + コピーボタン）
            const headerEl = msgWrapper.createDiv({ cls: 'ai-notebook-chat-msg-header' });
            const senderName = isUser 
                ? 'あなた' 
                : (this.plugin.settings.activeAgent === 'antigravity' ? 'AI (Antigravity)' : 'AI (Claude)');
            headerEl.createSpan({ text: senderName, cls: 'ai-notebook-chat-sender-name' });

            const copyBtn = headerEl.createEl('button', {
                cls: 'ai-notebook-chat-copy-btn'
            });
            setIcon(copyBtn, 'copy');
            copyBtn.createSpan({ text: ' コピー' });
            copyBtn.setAttribute('title', 'メッセージをコピー');
            copyBtn.onclick = async (e) => {
                e.stopPropagation();
                await navigator.clipboard.writeText(msg.text);
                new Notice('クリップボードにコピーしました');
            };

            // メッセージバブル
            const msgBubble = msgWrapper.createDiv({
                cls: `ai-notebook-chat-message ai-notebook-chat-message-${msg.sender}`
            });
            const textContainer = msgBubble.createDiv({
                cls: 'ai-notebook-chat-text markdown-rendered'
            });

            if (!isUser && msg.text.startsWith('思考中...')) {
                const loadingDiv = textContainer.createDiv({ cls: 'ai-notebook-chat-loading' });
                const spinner = loadingDiv.createSpan({ cls: 'ai-notebook-chat-spinner' });
                setIcon(spinner, 'loader');
                loadingDiv.createSpan({ text: ` ${msg.text}` });
            } else {
                await MarkdownRenderer.render(this.app, msg.text, textContainer, '', this);
            }
        }

        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    /**
     * 成果物パネルのレンダリング
     */
    private renderArtifactPanel(panel: HTMLElement): void {
        panel.empty();

        const panelHeader = panel.createDiv({ cls: 'ai-notebook-panel-header' });
        panelHeader.createEl('h3', { text: '成果物 (Artifacts)' });

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
        if (!this.notebookId) return;

        // 1. ユーザーメッセージを履歴に追加
        const userMsg: ChatMessage = {
            id: Date.now().toString(),
            sender: 'user',
            text: userPrompt,
            timestamp: new Date().toISOString()
        };
        this.chatHistory.push(userMsg);

        // 2. ローディング表示用仮メッセージ追加
        const loadingMsgId = (Date.now() + 1).toString();
        const loadingMsg: ChatMessage = {
            id: loadingMsgId,
            sender: 'agent',
            text: '思考中... (AIエージェント実行中)',
            timestamp: new Date().toISOString()
        };
        this.chatHistory.push(loadingMsg);

        await this.plugin.notebookManager.saveChatHistory(this.notebookId, this.chatHistory);
        await this.refresh(false);

        try {
            let vaultBasePath = '';
            const adapter = this.app.vault.adapter;
            if (adapter instanceof FileSystemAdapter) {
                vaultBasePath = adapter.getBasePath();
            }

            const sourcesRelative = `${this.plugin.settings.rootDir}/notebooks/${this.notebookId}/sources`;
            const artifactsRelative = `${this.plugin.settings.rootDir}/notebooks/${this.notebookId}/artifacts`;

            const contextDirAbs = path.join(vaultBasePath, sourcesRelative);
            const outputDirAbs = path.join(vaultBasePath, artifactsRelative);

            const agentAdapter = AgentFactory.getAdapter(this.plugin.settings);
            const commandPath = AgentFactory.getCommandPath(this.plugin.settings);

            // リンクされた参照ノートブック群の成果物を動的に集約
            const linkedContexts = await this.plugin.notebookManager.getLinkedContexts(this.notebookId);

            // 3. AI エージェントの実行
            const result = await agentAdapter.executePrompt(userPrompt, {
                contextDir: contextDirAbs,
                outputDir: outputDirAbs,
                commandPath: commandPath,
                linkedContexts: linkedContexts
            });

            // 仮ローディングメッセージの置換
            const lastIdx = this.chatHistory.findIndex(m => m.id === loadingMsgId);
            if (lastIdx !== -1) {
                this.chatHistory[lastIdx].text = result.text || '(AIからの応答本文が空です)';
            } else {
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
