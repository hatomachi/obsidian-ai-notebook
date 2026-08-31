import { App, Modal, TFile, Notice, setIcon, MarkdownRenderer, Component } from 'obsidian';
import { NotebookManager } from '../../services/NotebookManager';

export class ArtifactModal extends Modal {
    notebookManager: NotebookManager;
    notebookId: string;
    artifactFile: TFile;
    onSaved?: () => void;

    content: string = '';
    isEditing: boolean = false;
    textareaEl: HTMLTextAreaElement | null = null;
    renderComponent: Component = new Component();

    constructor(app: App, notebookManager: NotebookManager, notebookId: string, artifactFile: TFile, onSaved?: () => void) {
        super(app);
        this.notebookManager = notebookManager;
        this.notebookId = notebookId;
        this.artifactFile = artifactFile;
        this.onSaved = onSaved;
    }

    async onOpen(): Promise<void> {
        this.renderComponent.load();
        this.modalEl.addClass('ai-notebook-artifact-modal');
        this.content = await this.app.vault.read(this.artifactFile);
        this.isEditing = false;
        await this.renderModal();
    }

    private async renderModal(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();

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

        // 保存ボタン
        const saveBtn = actions.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-primary' });
        setIcon(saveBtn, 'save');
        saveBtn.createSpan({ text: ' 保存' });
        saveBtn.onclick = async () => {
            if (this.isEditing && this.textareaEl) {
                this.content = this.textareaEl.value;
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
