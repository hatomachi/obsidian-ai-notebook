import { App, Modal, Setting, Notice } from 'obsidian';
import { NotebookManager } from '../../services/NotebookManager';
import { NotebookMetadata } from '../../types';

export class CreateNotebookModal extends Modal {
    notebookManager: NotebookManager;
    onCreated: (notebook: NotebookMetadata) => void;

    title: string = '';
    description: string = '';

    constructor(app: App, notebookManager: NotebookManager, onCreated: (notebook: NotebookMetadata) => void) {
        super(app);
        this.notebookManager = notebookManager;
        this.onCreated = onCreated;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: '新規 AI ノートブックの作成' });

        new Setting(contentEl)
            .setName('ノートブック タイトル')
            .setDesc('ノートブックの名前を入力してください')
            .addText(text => text
                .setPlaceholder('例: 新規事業リサーチ')
                .onChange(val => this.title = val));

        new Setting(contentEl)
            .setName('説明 (任意)')
            .setDesc('このノートブックの目的やメモを入力してください')
            .addTextArea(text => text
                .setPlaceholder('例: 市場調査データとAI分析レポートを管理する')
                .onChange(val => this.description = val));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('作成')
                .setCta()
                .onClick(async () => {
                    if (!this.title.trim()) {
                        new Notice('タイトルを入力してください');
                        return;
                    }

                    try {
                        const notebook = await this.notebookManager.createNotebook(this.title, this.description);
                        new Notice(`ノートブック "${notebook.title}" を作成しました`);
                        this.onCreated(notebook);
                        this.close();
                    } catch (e) {
                        console.error('Failed to create notebook:', e);
                        new Notice('ノートブックの作成に失敗しました');
                    }
                }))
            .addButton(btn => btn
                .setButtonText('キャンセル')
                .onClick(() => this.close()));
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
