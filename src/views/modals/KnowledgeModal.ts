import { App, Modal, TFile, Notice, setIcon } from 'obsidian';

export class KnowledgeModal extends Modal {
    file: TFile;
    title: string;
    onSaved?: () => void;
    content: string = '';

    constructor(app: App, file: TFile, title: string, onSaved?: () => void) {
        super(app);
        this.file = file;
        this.title = title;
        this.onSaved = onSaved;
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('ai-notebook-artifact-modal');

        this.content = await this.app.vault.read(this.file);

        // モーダルヘッダー
        const header = contentEl.createDiv({ cls: 'ai-notebook-artifact-header' });
        const titleArea = header.createDiv({ cls: 'ai-notebook-artifact-title-area' });
        
        const iconEl = titleArea.createSpan({ cls: 'ai-notebook-artifact-icon' });
        setIcon(iconEl, 'database');
        
        titleArea.createEl('h2', { text: this.title, cls: 'ai-notebook-artifact-title' });

        const actions = header.createDiv({ cls: 'ai-notebook-artifact-actions' });
        
        // 保存ボタン
        const saveBtn = actions.createEl('button', { cls: 'ai-notebook-btn ai-notebook-btn-primary' });
        setIcon(saveBtn, 'save');
        saveBtn.createSpan({ text: ' ナレッジ保存' });
        saveBtn.onclick = async () => {
            await this.app.vault.modify(this.file, textarea.value);
            new Notice(`"${this.title}" を保存・更新しました`);
            if (this.onSaved) this.onSaved();
            this.close();
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
