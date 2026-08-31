import { App, Modal, TFile, Notice, setIcon, MarkdownRenderer, Component } from 'obsidian';
import { NotebookManager } from '../../services/NotebookManager';

export class ArtifactModal extends Modal {
    notebookManager: NotebookManager;
    notebookId: string;
    artifactFile: TFile;
    onSaved?: () => void;
    isAgentExecuting: boolean;

    content: string = '';
    isEditing: boolean = false;
    openedMtime: number = 0;
    textareaEl: HTMLTextAreaElement | null = null;
    renderComponent: Component = new Component();

    constructor(
        app: App, 
        notebookManager: NotebookManager, 
        notebookId: string, 
        artifactFile: TFile, 
        onSaved?: () => void,
        isAgentExecuting: boolean = false
    ) {
        super(app);
        this.notebookManager = notebookManager;
        this.notebookId = notebookId;
        this.artifactFile = artifactFile;
        this.onSaved = onSaved;
        this.isAgentExecuting = isAgentExecuting;
    }

    async onOpen(): Promise<void> {
        this.renderComponent.load();
        this.modalEl.addClass('ai-notebook-artifact-modal');
        this.content = await this.app.vault.read(this.artifactFile);
        this.openedMtime = this.artifactFile.stat.mtime;
        this.isEditing = false;
        await this.renderModal();
    }

    private async renderModal(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();

        // エージェント実行中の警告バナー
        if (this.isAgentExecuting) {
            const warningBanner = contentEl.createDiv({ cls: 'ai-notebook-executing-banner' });
            setIcon(warningBanner.createSpan({ cls: 'ai-notebook-banner-icon' }), 'alert-triangle');
            warningBanner.createSpan({ text: ' AIエージェントが現在バックグラウンドで実行中です。ファイルの保存時に競合が発生する可能性があります。' });
        }

        // モーダルヘッダー
        const header = contentEl.createDiv({ cls: 'ai-notebook-artifact-header' });
        const titleArea = header.createDiv({ cls: 'ai-notebook-artifact-title-area' });
        
        const iconEl = titleArea.createSpan({ cls: 'ai-notebook-artifact-icon' });
        setIcon(iconEl, 'file-text');
        
        titleArea.createEl('h2', { text: this.artifactFile.basename, cls: 'ai-notebook-artifact-title' });

        const actions = header.createDiv({ cls: 'ai-notebook-artifact-actions' });

        // プレビュー / 編集 切替ボタン
        const toggleBtn = actions.createEl('button', {
            cls: 'ai-notebook-btn ai-notebook-btn-secondary'
        });
        if (this.isEditing) {
            setIcon(toggleBtn, 'eye');
            toggleBtn.createSpan({ text: ' プレビュー' });
            toggleBtn.setAttribute('title', 'レンダリング表示に戻る');
            toggleBtn.onclick = async () => {
                if (this.textareaEl) {
                    this.content = this.textareaEl.value;
                }
                this.isEditing = false;
                await this.renderModal();
            };
        } else {
            setIcon(toggleBtn, 'edit-3');
            toggleBtn.createSpan({ text: ' 編集' });
            toggleBtn.setAttribute('title', 'Markdownテキストを編集');
            toggleBtn.onclick = async () => {
                this.isEditing = true;
                await this.renderModal();
            };
        }

        // コピーボタン
        const copyBtn = actions.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-secondary' });
        setIcon(copyBtn, 'copy');
        copyBtn.createSpan({ text: ' コピー' });
        copyBtn.setAttribute('title', '成果物のMarkdownをクリップボードにコピー');
        copyBtn.onclick = async () => {
            const textToCopy = this.isEditing && this.textareaEl ? this.textareaEl.value : this.content;
            await navigator.clipboard.writeText(textToCopy);
            new Notice('成果物をクリップボードにコピーしました');
        };

        // 保存ボタン（競合検知付き）
        const saveBtn = actions.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-primary' });
        setIcon(saveBtn, 'save');
        saveBtn.createSpan({ text: ' 保存' });
        saveBtn.onclick = async () => {
            if (this.isEditing && this.textareaEl) {
                this.content = this.textareaEl.value;
            }

            // mtime による競合チェック
            const currentAbstract = this.app.vault.getAbstractFileByPath(this.artifactFile.path);
            if (currentAbstract instanceof TFile && currentAbstract.stat.mtime > this.openedMtime) {
                const reloadConfirm = confirm(
                    `⚠️ 【編集競合の警告】\n\nこの成果物ファイルはモーダルを開いた後に外部（AIエージェント等）によって更新されています。\n\n` +
                    `[OK] 最新の内容を再読み込みする（現在の手動編集内容は破棄されます）\n` +
                    `[キャンセル] 上書き保存を中止して、編集内容を確認・コピーする`
                );

                if (reloadConfirm) {
                    this.content = await this.app.vault.read(currentAbstract);
                    this.openedMtime = currentAbstract.stat.mtime;
                    this.isEditing = false;
                    await this.renderModal();
                    new Notice('最新の内容を再読み込みしました');
                    return;
                } else {
                    return; // 保存を中断
                }
            }

            await this.app.vault.modify(this.artifactFile, this.content);
            new Notice(`成果物 "${this.artifactFile.basename}" を保存しました`);
            if (this.onSaved) this.onSaved();
            this.close();
        };

        // 削除ボタン
        const deleteBtn = actions.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-danger' });
        setIcon(deleteBtn, 'trash-2');
        deleteBtn.setAttribute('title', '削除');
        deleteBtn.onclick = async () => {
            if (confirm(`成果物 "${this.artifactFile.basename}" を削除してもよろしいですか？`)) {
                await this.notebookManager.deleteArtifactFile(this.notebookId, this.artifactFile.name);
                new Notice('成果物を削除しました');
                if (this.onSaved) this.onSaved();
                this.close();
            }
        };

        // エディタ・プレビュー領域
        const bodyEl = contentEl.createDiv({ cls: 'ai-notebook-artifact-body' });

        if (this.isEditing) {
            this.textareaEl = bodyEl.createEl('textarea', { cls: 'ai-notebook-artifact-editor' });
            this.textareaEl.value = this.content;
            this.textareaEl.focus();
        } else {
            this.textareaEl = null;
            const previewEl = bodyEl.createDiv({ cls: 'ai-notebook-artifact-preview markdown-rendered' });
            await MarkdownRenderer.render(this.app, this.content, previewEl, this.artifactFile.path, this.renderComponent);
        }
    }

    onClose(): void {
        this.renderComponent.unload();
        const { contentEl } = this;
        contentEl.empty();
    }
}
