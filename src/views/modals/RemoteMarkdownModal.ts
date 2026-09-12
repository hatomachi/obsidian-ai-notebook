import { App, Modal, MarkdownRenderer, Component, setIcon, Notice } from 'obsidian';
import { NotebookManager } from '../../services/NotebookManager';

export class RemoteMarkdownModal extends Modal {
    notebookManager: NotebookManager;
    notebookId: string;
    title: string;
    filePath: string;
    onForkRequested?: () => void;

    private content: string = '';
    private renderComponent: Component = new Component();

    constructor(
        app: App,
        notebookManager: NotebookManager,
        notebookId: string,
        title: string,
        filePath: string,
        onForkRequested?: () => void
    ) {
        super(app);
        this.notebookManager = notebookManager;
        this.notebookId = notebookId;
        this.title = title;
        this.filePath = filePath;
        this.onForkRequested = onForkRequested;
    }

    async onOpen(): Promise<void> {
        this.renderComponent.load();
        this.modalEl.addClass('ai-notebook-artifact-modal', 'ai-notebook-remote-modal');

        const { contentEl } = this;
        contentEl.empty();
        contentEl.createDiv({ text: 'GitLab からコンテンツを読み込み中...', cls: 'ai-notebook-loading-text' });

        try {
            this.content = await this.notebookManager.readTextFileContent(this.filePath, this.notebookId);
            await this.renderModal();
        } catch (err: any) {
            contentEl.empty();
            contentEl.createEl('h3', { text: '⚠️ 読み込みエラー' });
            contentEl.createEl('p', { text: `ファイルの取得に失敗しました: ${err?.message || String(err)}` });
        }
    }

    private async renderModal(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();

        // クラウド閲覧バナー
        const cloudBanner = contentEl.createDiv({ cls: 'ai-notebook-cloud-warning-banner' });
        const bannerIcon = cloudBanner.createSpan({ cls: 'ai-notebook-banner-icon' });
        setIcon(bannerIcon, 'cloud');
        cloudBanner.createSpan({
            text: ' ☁️ このファイルは GitLab 上の共有ノートブックから直接オンデマンド取得されています（閲覧専用）。編集するには「自分の縄張りにフォーク」してください。',
            cls: 'ai-notebook-banner-text'
        });

        // ヘッダーバー
        const headerBar = contentEl.createDiv({ cls: 'ai-notebook-modal-header' });
        const titleArea = headerBar.createDiv({ cls: 'ai-notebook-modal-title-area' });
        titleArea.createEl('h2', { text: this.title, cls: 'ai-notebook-modal-title' });

        const actionsArea = headerBar.createDiv({ cls: 'ai-notebook-modal-actions' });
        
        // フォークボタン
        if (this.onForkRequested) {
            const forkBtn = actionsArea.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-primary' });
            setIcon(forkBtn, 'git-fork');
            forkBtn.createSpan({ text: ' 🍴 自分の縄張りにフォーク' });
            forkBtn.onclick = () => {
                this.close();
                this.onForkRequested?.();
            };
        }

        // コピーボタン
        const copyBtn = actionsArea.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-secondary' });
        setIcon(copyBtn, 'copy');
        copyBtn.createSpan({ text: ' コピー' });
        copyBtn.onclick = async () => {
            await navigator.clipboard.writeText(this.content);
            new Notice('コンテンツをクリップボードにコピーしました');
        };

        // 本文コンテナ
        const bodyContainer = contentEl.createDiv({ cls: 'ai-notebook-modal-body' });
        const previewEl = bodyContainer.createDiv({ cls: 'ai-notebook-artifact-preview markdown-rendered' });

        await MarkdownRenderer.render(
            this.app,
            this.content,
            previewEl,
            this.filePath,
            this.renderComponent
        );

        // フッター
        const footerBar = contentEl.createDiv({ cls: 'ai-notebook-modal-buttons' });
        const closeBtn = footerBar.createEl('button', { text: '閉じる', cls: 'ai-notebook-btn ai-notebook-btn-secondary' });
        closeBtn.onclick = () => this.close();
    }

    onClose(): void {
        this.renderComponent.unload();
        const { contentEl } = this;
        contentEl.empty();
    }
}
