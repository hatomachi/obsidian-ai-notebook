import { App, Modal, Setting, Notice } from 'obsidian';
import { NotebookManager } from '../../services/NotebookManager';
import { NotebookMetadata } from '../../types';

export class CreateNotebookModal extends Modal {
    notebookManager: NotebookManager;
    onCreated: (notebook: NotebookMetadata) => void;

    title: string = '';
    description: string = '';
    selectedSystemId: string = '';
    selectedTemplateId: string = '';

    constructor(app: App, notebookManager: NotebookManager, onCreated: (notebook: NotebookMetadata) => void) {
        super(app);
        this.notebookManager = notebookManager;
        this.onCreated = onCreated;
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: '新規 AI ノートブックの作成' });

        new Setting(contentEl)
            .setName('ノートブック タイトル')
            .setDesc('ノートブックの名前を入力してください')
            .addText(text => text
                .setPlaceholder('例: 2026-09 APIGW定期リリース')
                .onChange(val => this.title = val));

        // システム・ドメイン知識の選択
        const systems = await this.notebookManager.getAllSystems();
        const systemOptions: Record<string, string> = { '': '（選択なし - 汎用）' };
        for (const sys of systems) {
            systemOptions[sys.id] = sys.name;
        }

        new Setting(contentEl)
            .setName('対象システム (ドメイン知識)')
            .setDesc('適用するシステムの仕様・運用ノウハウ・過去事例を選択します')
            .addDropdown(drop => drop
                .addOptions(systemOptions)
                .setValue(this.selectedSystemId)
                .onChange(val => this.selectedSystemId = val));

        // ドキュメントテンプレートの選択
        const templates = await this.notebookManager.getAllTemplates();
        const templateOptions: Record<string, string> = { '': '（選択なし - 汎用対話）' };
        for (const tpl of templates) {
            templateOptions[tpl.id] = tpl.title;
        }

        new Setting(contentEl)
            .setName('ドキュメントテンプレート (型・フォーマット)')
            .setDesc('作成する成果物のフォーマットや記述基準を選択します')
            .addDropdown(drop => drop
                .addOptions(templateOptions)
                .setValue(this.selectedTemplateId)
                .onChange(val => this.selectedTemplateId = val));

        new Setting(contentEl)
            .setName('説明 (任意)')
            .setDesc('このノートブックの目的やメモを入力してください')
            .addTextArea(text => text
                .setPlaceholder('例: リリース背景、変更点、切り戻し基準をまとめる')
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
                        const notebook = await this.notebookManager.createNotebook(
                            this.title,
                            this.description,
                            this.selectedSystemId || undefined,
                            this.selectedTemplateId || undefined
                        );
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
