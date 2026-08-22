import { App, Modal, TFile, Notice, setIcon } from 'obsidian';
import { NotebookManager } from '../../services/NotebookManager';

export class ArtifactModal extends Modal {
    notebookManager: NotebookManager;
    notebookId: string;
    artifactFile: TFile;
    onSaved?: () => void;

    content: string = '';

    constructor(app: App, notebookManager: NotebookManager, notebookId: string, artifactFile: TFile, onSaved?: () => void) {
        super(app);
        this.notebookManager = notebookManager;
        this.notebookId = notebookId;
        this.artifactFile = artifactFile;
        this.onSaved = onSaved;
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('ai-notebook-artifact-modal');

        this.content = await this.app.vault.read(this.artifactFile);

        // モーダルヘッダー
        const header = contentEl.createDiv({ cls: 'ai-notebook-artifact-header' });
        const titleArea = header.createDiv({ cls: 'ai-notebook-artifact-title-area' });
        
        const iconEl = titleArea.createSpan({ cls: 'ai-notebook-artifact-icon' });
        setIcon(iconEl, 'file-text');
        
        titleArea.createEl('h2', { text: this.artifactFile.basename, cls: 'ai-notebook-artifact-title' });

        const actions = header.createDiv({ cls: 'ai-notebook-artifact-actions' });
        
        // 保存ボタン
        const saveBtn = actions.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-primary' });
        setIcon(saveBtn, 'save');
        saveBtn.createSpan({ text: ' 保存' });
        saveBtn.onclick = async () => {
            await this.app.vault.modify(this.artifactFile, textarea.value);
            new Notice(`成果物 "${this.artifactFile.basename}" を保存しました`);
            if (this.onSaved) this.onSaved();
            this.close();
        };

        // 削除ボタン
        const deleteBtn = actions.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-danger' });
        setIcon(deleteBtn, 'trash-2');
        deleteBtn.onclick = async () => {
            if (confirm(`成果物 "${this.artifactFile.basename}" を削除してもよろしいですか？`)) {
                await this.notebookManager.deleteArtifactFile(this.notebookId, this.artifactFile.name);
                new Notice('成果物を削除しました');
                if (this.onSaved) this.onSaved();
                this.close();
            }
        };

        // エディタ領域
        const bodyEl = contentEl.createDiv({ cls: 'ai-notebook-artifact-body' });
        const textarea = bodyEl.createEl('textarea', { cls: 'ai-notebook-artifact-editor' });
        textarea.value = this.content;
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
