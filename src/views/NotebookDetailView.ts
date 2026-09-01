import { ItemView, WorkspaceLeaf, setIcon, TFile, Notice, FileSystemAdapter, MarkdownRenderer } from 'obsidian';
import type AINotebookPlugin from '../main';
import { NotebookMetadata, NotebookSource, NotebookArtifact, ChatMessage, ChatSessionMetadata, ChatSession } from '../types';
import { ArtifactModal } from './modals/ArtifactModal';
import { LinkNotebookModal } from './modals/LinkNotebookModal';
import { BoundFolderExplorerModal } from './modals/BoundFolderExplorerModal';
import { BindFolderModal } from './modals/BindFolderModal';
import { TextInputModal } from './modals/TextInputModal';
import { BoundFolderReader } from '../services/BoundFolderReader';
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
    
    // マルチセッション管理
    sessions: ChatSessionMetadata[] = [];
    currentSessionId: string | null = null;
    currentSession: ChatSession | null = null;
    chatHistory: ChatMessage[] = [];

    // エージェント実行・キャンセル状態
    isExecuting: boolean = false;
    abortController: AbortController | null = null;

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
        this.currentSessionId = null;
        this.currentSession = null;
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

        // セッション一覧のロード
        this.sessions = await this.plugin.notebookManager.getChatSessions(this.notebookId);

        // アクティブセッションの決定
        const activeId = this.metadata?.activeSessionId;
        if (!this.currentSessionId || !this.sessions.some(s => s.id === this.currentSessionId)) {
            if (activeId && this.sessions.some(s => s.id === activeId)) {
                this.currentSessionId = activeId;
            } else if (this.sessions.length > 0) {
                this.currentSessionId = this.sessions[0].id;
            } else {
                this.currentSessionId = null;
            }
        }

        // アクティブセッションデータの読み込み
        if (this.currentSessionId) {
            if (reloadFromDisk || !this.currentSession || this.currentSession.id !== this.currentSessionId) {
                this.currentSession = await this.plugin.notebookManager.getChatSession(this.notebookId, this.currentSessionId);
            }
            this.chatHistory = this.currentSession ? this.currentSession.messages : [];
        } else {
            this.currentSession = null;
            this.chatHistory = [];
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
        // 2. バインド外部フォルダ (Bound Folder & AI Discovery)
        // ==========================================
        const boundSection = panel.createDiv({ cls: 'ai-notebook-bound-section' });
        const boundHeader = boundSection.createDiv({ cls: 'ai-notebook-panel-header' });
        boundHeader.createEl('h3', { text: '🗄️ バインド外部フォルダ' });

        const effectiveBoundPath = this.metadata?.boundFolderPath || this.plugin.settings.sharedFolderBasePath || '';
        const isCustomBound = !!this.metadata?.boundFolderPath;

        const configBoundBtn = boundHeader.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-xs',
            text: isCustomBound ? '変更/解除' : 'バインド設定'
        });
        configBoundBtn.onclick = () => {
            if (!this.notebookId) return;
            new BindFolderModal(
                this.app,
                this.plugin.notebookManager,
                this.notebookId,
                this.metadata?.boundFolderPath || '',
                async () => {
                    await this.refresh(false);
                }
            ).open();
        };

        const boundBody = boundSection.createDiv({ cls: 'ai-notebook-bound-body' });
        if (effectiveBoundPath) {
            const pathCard = boundBody.createDiv({ cls: 'ai-notebook-bound-path-card' });
            const iconSpan = pathCard.createSpan({ cls: 'ai-notebook-bound-icon' });
            setIcon(iconSpan, 'folder-symlink');
            
            const pathText = pathCard.createSpan({ 
                text: isCustomBound ? effectiveBoundPath : `${effectiveBoundPath} (グローバル設定)`,
                cls: 'ai-notebook-bound-path'
            });
            pathText.setAttribute('title', effectiveBoundPath);

            const exploreBtn = boundBody.createEl('button', {
                cls: 'ai-notebook-btn ai-notebook-btn-primary ai-notebook-btn-xs ai-notebook-btn-block',
                text: '📁 フォルダツリーから探索・一括取込 (Extract)'
            });
            exploreBtn.onclick = () => {
                if (!this.notebookId) return;
                new BoundFolderExplorerModal(
                    this.app,
                    this.plugin.notebookManager,
                    this.notebookId,
                    effectiveBoundPath,
                    async () => {
                        await this.refresh(true);
                    }
                ).open();
            };
        } else {
            const emptyBound = boundBody.createDiv({ cls: 'ai-notebook-empty-bound' });
            emptyBound.createDiv({ text: '外部フォルダは未バインドです', cls: 'ai-notebook-empty-text' });
            emptyBound.createDiv({ text: '「バインド設定」からファイルサーバー等のパスを登録できます', cls: 'ai-notebook-hint-text' });
        }

        // ==========================================
        // 3. 直接投入ファイル (Direct Inputs)
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
                
                const effectiveExt = src.convertedFrom
                    ? src.convertedFrom.split('.').pop() || src.extension
                    : src.extension;
                const iconSpan = item.createSpan({ cls: 'ai-notebook-source-icon' });
                setIcon(iconSpan, this.getFileIcon(effectiveExt));

                const nameWrap = item.createDiv({ cls: 'ai-notebook-source-name-wrap' });
                const nameSpan = nameWrap.createSpan({ text: src.name, cls: 'ai-notebook-source-name' });
                nameSpan.setAttribute('title', src.name);

                // 出典元フォルダのバッジ表示 (例: 📁 2024/A社_基幹刷新)
                if (src.origin?.relativeFolder) {
                    const folderBadge = nameWrap.createSpan({ cls: 'ai-notebook-badge-origin-folder' });
                    folderBadge.setText(`📁 ${src.origin.relativeFolder}`);
                    folderBadge.setAttribute('title', `出典フォルダ: ${src.origin.relativeFolder}`);
                }

                if (src.convertedFrom) {
                    const badge = nameWrap.createSpan({ cls: 'ai-notebook-badge-converted' });
                    const origExt = (src.convertedFrom.split('.').pop() || '').toLowerCase();
                    if (origExt === 'xlsx' || origExt === 'xls') {
                        badge.setText('📊 Excel変換');
                    } else if (origExt === 'pptx' || origExt === 'ppt') {
                        badge.setText('📑 PPTX変換');
                    } else if (origExt === 'docx' || origExt === 'doc') {
                        badge.setText('📄 Word変換');
                    } else {
                        badge.setText('変換済');
                    }
                }

                // 変換エラー時の警告バッジ表示
                if (src.transcriptionError) {
                    const errorBadge = nameWrap.createSpan({ cls: 'ai-notebook-badge-error' });
                    errorBadge.setText('⚠️ 変換失敗');
                    const errDetail = src.transcriptionError.errorMessage || '不明なエラー';
                    errorBadge.setAttribute('title', `変換エラー: ${errDetail}\n(クリックでエラー詳細を表示)`);
                    errorBadge.onclick = (e) => {
                        e.stopPropagation();
                        new Notice(`【変換エラー詳細: ${src.name}】\n${errDetail}\nサイズ: ${src.transcriptionError?.fileSize} bytes`, 10000);
                    };
                }

                // 未変換のバイナリまたはエラー発生ソースに対する再変換（リラン）ボタン
                const isTranscribableRaw = ['xlsx', 'xls', 'docx', 'pptx'].includes(src.extension.toLowerCase()) && !src.convertedFrom;
                if (isTranscribableRaw || src.transcriptionError) {
                    const retryBtn = item.createEl('button', { cls: 'ai-notebook-item-retry-btn' });
                    setIcon(retryBtn, 'refresh-cw');
                    retryBtn.setAttribute('title', 'Markdownへ再変換を実行');
                    retryBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (!this.notebookId) return;
                        retryBtn.addClass('is-loading');
                        new Notice(`${src.name} の再変換を実行中...`);
                        const result = await this.plugin.notebookManager.retranscribeSource(this.notebookId, src.name);
                        if (result.success) {
                            new Notice(`✅ ${src.name} を Markdown に変換しました`);
                        } else {
                            new Notice(`❌ 再変換に失敗しました: ${result.error}`, 8000);
                        }
                        await this.refresh();
                    };
                }

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
     * ファイル投入の処理ハンドラー（レース状態対策・0バイトガード・Electronフォールバック）
     */
    private async handleFilesAdded(files: FileList): Promise<void> {
        if (!this.notebookId) return;

        let addedCount = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            let buffer: ArrayBuffer | Buffer | null = null;
            
            // Electron 環境での確実なローカルファイル読み込み
            const localPath = (file as any).path;
            if (localPath && typeof require !== 'undefined') {
                try {
                    const fs = require('fs');
                    if (fs.existsSync(localPath)) {
                        buffer = fs.readFileSync(localPath);
                    }
                } catch (e) {
                    console.warn(`Failed to read file via fs: ${localPath}`, e);
                }
            }

            if (!buffer || (buffer as any).byteLength === 0) {
                buffer = await file.arrayBuffer();
            }

            // 0バイト判定 & レース状態リトライ (150ms待機 × 最大2回)
            let retries = 0;
            while ((!buffer || buffer.byteLength === 0) && retries < 2) {
                retries++;
                await new Promise(r => setTimeout(r, 150));
                if (localPath && typeof require !== 'undefined') {
                    try {
                        const fs = require('fs');
                        if (fs.existsSync(localPath)) {
                            buffer = fs.readFileSync(localPath);
                        }
                    } catch {}
                }
                if (!buffer || (buffer as any).byteLength === 0) {
                    buffer = await file.arrayBuffer();
                }
            }

            if (!buffer || buffer.byteLength === 0) {
                new Notice(`⚠️ "${file.name}" のデータが空（0バイト）です。ファイルの保存中または未同期の可能性があります。スキップしました。`, 6000);
                continue;
            }

            try {
                await this.plugin.notebookManager.addSourceFile(this.notebookId, file.name, buffer);
                addedCount++;
            } catch (err: any) {
                console.error(`Failed to add source file ${file.name}:`, err);
                new Notice(`❌ "${file.name}" の追加に失敗しました: ${err?.message || err}`, 6000);
            }
        }

        if (addedCount > 0) {
            new Notice(`${addedCount} 件のファイルをソースに追加しました`);
        }
        await this.refresh();
    }

    // ==========================================
    // チャットセッション操作 (Session Actions)
    // ==========================================

    /**
     * 指定したセッションに切り替え
     */
    async switchSession(sessionId: string): Promise<void> {
        if (this.currentSessionId === sessionId) return;
        this.currentSessionId = sessionId;
        if (this.notebookId) {
            await this.plugin.notebookManager.updateNotebookMetadata(this.notebookId, { activeSessionId: sessionId });
        }
        await this.refresh(true);
    }

    /**
     * 新規セッションを作成して切り替え
     */
    async createNewSession(title?: string): Promise<void> {
        if (!this.notebookId) return;
        const newSession = await this.plugin.notebookManager.createChatSession(this.notebookId, title);
        this.currentSessionId = newSession.id;
        await this.plugin.notebookManager.updateNotebookMetadata(this.notebookId, { activeSessionId: newSession.id });
        await this.refresh(true);
        new Notice('新しいチャットセッションを開始しました');
    }

    /**
     * 現在のセッションのタイトルを変更
     */
    async renameCurrentSession(): Promise<void> {
        if (!this.notebookId || !this.currentSessionId || !this.currentSession) return;
        const currentTitle = this.currentSession.title;
        new TextInputModal(
            this.app,
            '✏️ セッション名の変更',
            currentTitle,
            async (newTitle) => {
                if (!this.notebookId || !this.currentSessionId) return;
                await this.plugin.notebookManager.updateChatSessionTitle(this.notebookId, this.currentSessionId, newTitle);
                await this.refresh(true);
                new Notice('セッション名を変更しました');
            },
            { placeholder: 'セッション名を入力' }
        ).open();
    }

    /**
     * 現在のセッションを削除
     */
    async deleteCurrentSession(): Promise<void> {
        if (!this.notebookId || !this.currentSessionId || !this.currentSession) return;
        const confirmDelete = confirm(`セッション「${this.currentSession.title}」を削除しますか？\n（成果物やソースファイルは保持されます）`);
        if (!confirmDelete) return;

        await this.plugin.notebookManager.deleteChatSession(this.notebookId, this.currentSessionId);
        this.currentSessionId = null;
        this.currentSession = null;
        await this.refresh(true);
        new Notice('セッションを削除しました');
    }

    /**
     * チャットパネルのレンダリング
     */
    private renderChatPanel(panel: HTMLElement): void {
        panel.empty();

        const panelHeader = panel.createDiv({ cls: 'ai-notebook-panel-header ai-notebook-chat-header' });
        
        const titleArea = panelHeader.createDiv({ cls: 'ai-notebook-chat-header-title-area' });
        titleArea.createEl('h3', { text: '💬 AI チャット' });

        // セッション管理コントロールバー
        const sessionControls = panelHeader.createDiv({ cls: 'ai-notebook-session-controls' });

        if (this.sessions.length > 0) {
            // セッション選択ドロップダウン
            const selectEl = sessionControls.createEl('select', { cls: 'ai-notebook-session-select dropdown' });
            for (const s of this.sessions) {
                const opt = selectEl.createEl('option', {
                    value: s.id,
                    text: `${s.title}${s.messageCount !== undefined ? ` (${s.messageCount})` : ''}`
                });
                if (s.id === this.currentSessionId) {
                    opt.selected = true;
                }
            }
            selectEl.onchange = async () => {
                await this.switchSession(selectEl.value);
            };

            // リネームボタン
            const renameBtn = sessionControls.createEl('button', {
                cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-icon-only ai-notebook-btn-xs'
            });
            setIcon(renameBtn, 'pencil');
            renameBtn.setAttribute('title', 'セッション名を変更');
            renameBtn.onclick = async () => {
                await this.renameCurrentSession();
            };

            // 削除ボタン (複数ある場合のみ表示)
            if (this.sessions.length > 1) {
                const deleteBtn = sessionControls.createEl('button', {
                    cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-icon-only ai-notebook-btn-xs'
                });
                setIcon(deleteBtn, 'trash-2');
                deleteBtn.setAttribute('title', '現在のセッションを削除');
                deleteBtn.onclick = async () => {
                    await this.deleteCurrentSession();
                };
            }
        }

        // 新規セッションボタン
        const newSessionBtn = sessionControls.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-primary ai-notebook-btn-xs'
        });
        setIcon(newSessionBtn, 'plus');
        newSessionBtn.createSpan({ text: ' 新規' });
        newSessionBtn.setAttribute('title', '新しいチャットセッションを開始');
        newSessionBtn.onclick = async () => {
            await this.createNewSession();
        };

        // クイックアクションバー
        const actionsBar = panel.createDiv({ cls: 'ai-notebook-chat-actions-bar' });
        
        if (this.linkedNotebooks.length > 0) {
            const draftBtn = actionsBar.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-primary ai-notebook-btn-sm' });
            setIcon(draftBtn, 'sparkles');
            const linkedNames = this.linkedNotebooks.map(n => n.title).join(', ');
            draftBtn.createSpan({ text: ` 🚀 ドラフト生成` });
            draftBtn.setAttribute('title', `参照中: ${linkedNames}`);
            draftBtn.onclick = async () => {
                if (this.isExecuting) return;
                const prompt = `インプットソースの内容と、リンクされた参照コンテキスト（${linkedNames}）の仕様・ルール・サンプルをもとに、完成度の高い成果物初稿（ドラフト）を artifacts/ 配下に直接作成してください。注意事項や章立て、ロールバック基準も具体的に記述してください。`;
                await this.handleSendMessage(prompt);
            };

            const reviewBtn = actionsBar.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-sm' });
            setIcon(reviewBtn, 'check-square');
            reviewBtn.createSpan({ text: ` 🔍 成果物レビュー実行` });
            reviewBtn.setAttribute('title', 'リンクされた観点・ルールに照らして成果物をレビューし、指摘ファイルを出力');
            reviewBtn.onclick = async () => {
                if (this.isExecuting) return;
                const artList = this.artifacts.map(a => a.id).join(', ');
                const targetDesc = artList ? `対象成果物 (${artList})` : '既存成果物';
                const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
                const prompt = `リンクされた参照コンテキストの仕様・作成ルール・チェック観点に照らし、${targetDesc} を詳細に点検してください。指摘結果は artifacts/review_result_${today}.md として出力してください（各指摘に 章 / 観点 / 指摘内容 / 対応状況 [ ] を含めること）。`;
                await this.handleSendMessage(prompt);
            };
        } else {
            const summarizeBtn = actionsBar.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-secondary ai-notebook-btn-sm' });
            setIcon(summarizeBtn, 'sparkles');
            summarizeBtn.createSpan({ text: ' 💡 インプットの要約・分析レポートを生成' });
            summarizeBtn.onclick = async () => {
                if (this.isExecuting) return;
                await this.handleSendMessage('投入されたインプットソースの内容を詳細に分析し、主要なポイントを整理した要約レポートを artifacts/ 配下に作成してください。');
            };
        }

        // メッセージ履歴
        const messagesEl = panel.createDiv({ cls: 'ai-notebook-chat-messages' });
        this.renderMessages(messagesEl);

        // 入力フォーム
        const inputArea = panel.createDiv({ cls: 'ai-notebook-chat-input-area' });
        const textarea = inputArea.createEl('textarea', {
            placeholder: this.isExecuting
                ? 'AIエージェントが実行中です... 完了するか中止するまでお待ちください'
                : (this.linkedNotebooks.length > 0
                    ? '参照コンテキストをもとにドキュメント作成・修正・レビュー指示...'
                    : 'インプットをもとに会話・成果物作成指示...'),
            cls: 'ai-notebook-chat-textarea'
        });

        if (this.isExecuting) {
            textarea.disabled = true;
            textarea.addClass('is-disabled');

            // 中止ボタン
            const abortBtn = inputArea.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-danger' });
            setIcon(abortBtn, 'square');
            abortBtn.createSpan({ text: ' 中止' });
            abortBtn.setAttribute('title', 'AIエージェントの実行を中止');
            abortBtn.onclick = () => {
                if (this.abortController) {
                    this.abortController.abort();
                    new Notice('AIエージェントの中止リクエストを送信しました');
                }
            };
        } else {
            const sendBtn = inputArea.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-primary' });
            setIcon(sendBtn, 'send');
            sendBtn.setAttribute('title', '送信 (Ctrl+Enter / Cmd+Enter / Enter)');

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
    }

    /**
     * チャットメッセージ履歴のレンダリング (MarkdownRenderer & コピー機能)
     */
    private async renderMessages(messagesEl: HTMLElement): Promise<void> {
        messagesEl.empty();

        if (this.chatHistory.length === 0) {
            const emptyEl = messagesEl.createDiv({ cls: 'ai-notebook-chat-placeholder' });
            setIcon(emptyEl.createDiv({ cls: 'ai-notebook-chat-placeholder-icon' }), 'bot');
            const sessionTitle = this.currentSession ? `「${this.currentSession.title}」` : '';
            const placeholderText = this.linkedNotebooks.length > 0
                ? `${this.linkedNotebooks.length} 件のナレッジノートがコンテキストとしてリンクされています。上のボタンからドラフト生成するか、チャットで対話してください。`
                : `${sessionTitle} インプットソースや参照コンテキストをもとに、AIエージェントに何でも質問・指示してください。`;
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
                loadingDiv.createSpan({ text: ` ${msg.text}`, cls: 'ai-notebook-chat-loading-text' });
            } else {
                await MarkdownRenderer.render(this.app, msg.text, textContainer, '', this);
            }

            // 生成来歴 (Provenance) の表示
            if (msg.artifactsGenerated && msg.artifactsGenerated.length > 0) {
                const provDiv = msgBubble.createDiv({ cls: 'ai-notebook-chat-provenance' });
                const artIcon = provDiv.createSpan({ cls: 'ai-notebook-prov-icon' });
                setIcon(artIcon, 'file-check');
                provDiv.createSpan({ 
                    text: ` 成果物作成/更新: ${msg.artifactsGenerated.join(', ')}`,
                    cls: 'ai-notebook-prov-text' 
                });
            }

            if (msg.linkedNotebookIds && msg.linkedNotebookIds.length > 0) {
                const provLinkDiv = msgBubble.createDiv({ cls: 'ai-notebook-chat-provenance ai-notebook-chat-prov-links' });
                const linkIcon = provLinkDiv.createSpan({ cls: 'ai-notebook-prov-icon' });
                setIcon(linkIcon, 'link');
                provLinkDiv.createSpan({ 
                    text: ` 参照: ${msg.linkedNotebookIds.length} 件のナレッジノート`,
                    cls: 'ai-notebook-prov-text' 
                });
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
            new TextInputModal(
                this.app,
                '📄 新規成果物メモの作成',
                '新しいメモ',
                async (title) => {
                    if (!this.notebookId) return;
                    const file = await this.plugin.notebookManager.addArtifactFile(this.notebookId, title, `# ${title}\n\n`);
                    await this.refresh();
                    new ArtifactModal(this.app, this.plugin.notebookManager, this.notebookId, file, async () => {
                        await this.refresh();
                    }).open();
                },
                { placeholder: '成果物のタイトルを入力' }
            ).open();
        };

        // 成果物カード一覧
        const artifactList = panel.createDiv({ cls: 'ai-notebook-artifact-list' });
        if (this.artifacts.length === 0) {
            artifactList.createDiv({ text: '生成された成果物がありません', cls: 'ai-notebook-empty-text' });
        } else {
            for (const art of this.artifacts) {
                const isReview = art.id.toLowerCase().startsWith('review_') || art.title.includes('レビュー') || art.title.toLowerCase().includes('review');
                
                const card = artifactList.createDiv({ 
                    cls: `ai-notebook-artifact-card ${isReview ? 'ai-notebook-artifact-card-review' : ''}` 
                });
                
                const cardHeader = card.createDiv({ cls: 'ai-notebook-artifact-card-header' });
                const iconSpan = cardHeader.createSpan({ cls: 'ai-notebook-artifact-card-icon' });
                setIcon(iconSpan, isReview ? 'check-square' : 'file-text');

                const titleSpan = cardHeader.createEl('h4', { text: art.title, cls: 'ai-notebook-artifact-card-title' });
                if (isReview) {
                    const badge = cardHeader.createSpan({ text: 'レビュー指摘', cls: 'ai-notebook-review-badge' });
                }

                card.onclick = () => {
                    if (!this.notebookId) return;
                    const file = this.app.vault.getAbstractFileByPath(art.path);
                    if (file instanceof TFile) {
                        new ArtifactModal(
                            this.app, 
                            this.plugin.notebookManager, 
                            this.notebookId, 
                            file, 
                            async () => {
                                await this.refresh();
                            },
                            this.isExecuting
                        ).open();
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

        // セッションが未作成または未ロードなら新規作成
        if (!this.currentSession || !this.currentSessionId) {
            const newSession = await this.plugin.notebookManager.createChatSession(this.notebookId);
            this.currentSessionId = newSession.id;
            this.currentSession = newSession;
        }

        // 初回メッセージ送信時、デフォルトタイトル（新規チャット/新規セッション等）であればプロンプトからスマートにリネーム
        const isDefaultTitle = /^新規(チャット|セッション)/.test(this.currentSession.title);
        if (this.currentSession.messages.length === 0 && isDefaultTitle) {
            const cleanTitle = userPrompt.replace(/[\r\n]+/g, ' ').trim().slice(0, 22);
            if (cleanTitle) {
                this.currentSession.title = cleanTitle;
                await this.plugin.notebookManager.updateChatSessionTitle(this.notebookId, this.currentSession.id, cleanTitle);
            }
        }

        // 1. ユーザーメッセージを履歴に追加
        const userMsg: ChatMessage = {
            id: Date.now().toString(),
            sender: 'user',
            text: userPrompt,
            timestamp: new Date().toISOString()
        };
        this.currentSession.messages.push(userMsg);
        this.chatHistory = this.currentSession.messages;

        // 2. ローディング表示用仮メッセージ追加
        const loadingMsgId = (Date.now() + 1).toString();
        const loadingMsg: ChatMessage = {
            id: loadingMsgId,
            sender: 'agent',
            text: '思考中... (AIエージェント実行中)',
            timestamp: new Date().toISOString()
        };
        this.currentSession.messages.push(loadingMsg);
        this.chatHistory = this.currentSession.messages;

        await this.plugin.notebookManager.saveChatSession(this.notebookId, this.currentSession);
        
        // 実行状態をONにしてUI更新（中止ボタン表示等）
        this.isExecuting = true;
        this.abortController = new AbortController();
        await this.refresh(false);

        try {
            let vaultBasePath = '';
            const adapter = this.app.vault.adapter;
            if (adapter instanceof FileSystemAdapter) {
                vaultBasePath = adapter.getBasePath();
            }

            const notebookRelative = `${this.plugin.settings.rootDir}/notebooks/${this.notebookId}`;
            const notebookDirAbs = path.join(vaultBasePath, notebookRelative);
            const sourcesDirAbs = path.join(notebookDirAbs, 'sources');
            const artifactsDirAbs = path.join(notebookDirAbs, 'artifacts');

            const agentAdapter = AgentFactory.getAdapter(this.plugin.settings);
            const commandPath = AgentFactory.getCommandPath(this.plugin.settings);

            // リンクされた参照ノートブック群の成果物を動的に集約
            const linkedContexts = await this.plugin.notebookManager.getLinkedContexts(this.notebookId);

            // バインドされた外部フォルダのツリー概要を取得 (AI探索・提案用・実OSパス秘匿)
            let boundFolderTreeText: string | undefined = undefined;
            const effectiveBoundPath = this.metadata?.boundFolderPath || this.plugin.settings.sharedFolderBasePath;
            if (effectiveBoundPath && BoundFolderReader.isValidDirectory(effectiveBoundPath)) {
                try {
                    const tree = await BoundFolderReader.listTree(effectiveBoundPath, 4);
                    boundFolderTreeText = BoundFolderReader.formatTreeForAgent(tree);
                } catch (treeErr) {
                    console.warn('[AI Notebook] Failed to scan bound folder for prompt:', treeErr);
                }
            }

            let streamedOutput = '';
            const onStdoutChunk = (chunk: string) => {
                streamedOutput += chunk;
                const targetMsg = this.currentSession?.messages.find(m => m.id === loadingMsgId);
                if (targetMsg) {
                    targetMsg.text = streamedOutput || '思考中... (AIエージェント実行中)';
                }
                const loadingTextEl = this.containerEl.querySelector('.ai-notebook-chat-loading-text');
                if (loadingTextEl) {
                    loadingTextEl.textContent = streamedOutput.length > 250 
                        ? '...' + streamedOutput.slice(-250) 
                        : streamedOutput;
                }
            };

            // 3. AI エージェントの実行 (ノートブックルートを作業ディレクトリとして渡す)
            const result = await agentAdapter.executePrompt(userPrompt, {
                notebookDir: notebookDirAbs,
                sourcesDir: sourcesDirAbs,
                artifactsDir: artifactsDirAbs,
                contextDir: sourcesDirAbs,
                outputDir: artifactsDirAbs,
                commandPath: commandPath,
                maxTurns: this.plugin.settings.maxTurns || 15,
                linkedContexts: linkedContexts,
                boundFolderTreeText: boundFolderTreeText,
                chatHistory: this.currentSession.messages.filter(m => m.id !== loadingMsgId),
                onStdoutChunk: onStdoutChunk,
                abortSignal: this.abortController.signal
            });

            // 4. 成果物差分の集計
            const allArtifactsTouched = [
                ...(result.artifactsCreated || []),
                ...(result.artifactsModified || [])
            ];
            const uniqueTouched = Array.from(new Set(allArtifactsTouched));

            // 仮ローディングメッセージの置換
            const lastIdx = this.currentSession.messages.findIndex(m => m.id === loadingMsgId);
            const finalAgentMsg: ChatMessage = {
                id: loadingMsgId,
                sender: 'agent',
                text: result.text || '(AIエージェントの処理が完了しました)',
                timestamp: new Date().toISOString(),
                artifactsGenerated: uniqueTouched.length > 0 ? uniqueTouched : undefined,
                linkedNotebookIds: this.metadata?.linkedNotebookIds && this.metadata.linkedNotebookIds.length > 0
                    ? [...this.metadata.linkedNotebookIds]
                    : undefined
            };

            if (lastIdx !== -1) {
                this.currentSession.messages[lastIdx] = finalAgentMsg;
            } else {
                this.currentSession.messages.push(finalAgentMsg);
            }

            // 5. 差分検出時の通知および後方互換コードブロック抽出
            if (uniqueTouched.length > 0) {
                for (const artName of uniqueTouched) {
                    new Notice(`成果物 "${artName}" が作成/更新されました`);
                }
            } else {
                // 差分が検出されなかった場合の後方互換フォールバック（コードブロック抽出）
                const fallbackCreated: string[] = [];
                const codeBlockRegex = /```(?:markdown:([^\n]+)|([a-zA-Z0-9_\-.]+?\.md))\n([\s\S]*?)```/g;
                let match;
                while ((match = codeBlockRegex.exec(result.text)) !== null) {
                    const title = (match[1] || match[2] || '').trim();
                    const content = match[3].trim();
                    if (title) {
                        const cleanTitle = title.endsWith('.md') ? title.slice(0, -3) : title;
                        await this.plugin.notebookManager.addArtifactFile(this.notebookId, cleanTitle, content);
                        fallbackCreated.push(`${cleanTitle}.md`);
                        new Notice(`成果物 "${cleanTitle}" が生成されました`);
                    }
                }

                if (fallbackCreated.length > 0) {
                    finalAgentMsg.artifactsGenerated = fallbackCreated;
                }
            }

            await this.plugin.notebookManager.saveChatSession(this.notebookId, this.currentSession);
        } catch (error: any) {
            console.error('[AI Notebook] Agent Execution Error:', error);
            const lastIdx = this.currentSession.messages.findIndex(m => m.id === loadingMsgId);
            const isCancelled = error.message && (error.message.includes('中止') || error.message.includes('キャンセル'));
            const errorText = isCancelled
                ? '⏹ AIエージェントの実行がユーザーにより中止されました。'
                : `⚠️ AIエージェント実行エラー: ${error.message || error}`;

            if (lastIdx !== -1) {
                this.currentSession.messages[lastIdx].text = errorText;
            }
            if (isCancelled) {
                new Notice('処理を中止しました');
            }
            await this.plugin.notebookManager.saveChatSession(this.notebookId, this.currentSession);
        } finally {
            this.isExecuting = false;
            this.abortController = null;
            this.chatHistory = this.currentSession ? this.currentSession.messages : [];
            await this.refresh(true);
        }
    }

    private getFileIcon(ext: string): string {
        switch (ext.toLowerCase()) {
            case 'xlsx': case 'xls': case 'csv': return 'table';
            case 'docx': case 'doc': case 'pdf': return 'file-text';
            case 'png': case 'jpg': case 'jpeg': case 'svg': case 'webp': return 'image';
            case 'pptx': case 'ppt': return 'presentation';
            case 'md': case 'txt': return 'file-code';
            default: return 'file';
        }
    }
}
