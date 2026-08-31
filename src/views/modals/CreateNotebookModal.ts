import { App, Modal, Setting, Notice, setIcon } from 'obsidian';
import { NotebookManager } from '../../services/NotebookManager';
import { NotebookMetadata } from '../../types';

export class CreateNotebookModal extends Modal {
    notebookManager: NotebookManager;
    onCreated: (notebook: NotebookMetadata) => void;

    title: string = '';
    description: string = '';
    boundFolderPath: string = '';
    selectedLinkedIds: Set<string> = new Set();

    constructor(app: App, notebookManager: NotebookManager, onCreated: (notebook: NotebookMetadata) => void) {
        super(app);
        this.notebookManager = notebookManager;
        this.onCreated = onCreated;
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-notebook-create-modal');

        contentEl.createEl('h2', { text: '✨ 新規 AI ノートブックの作成' });

        new Setting(contentEl)
            .setName('ノートブック タイトル')
            .setDesc('ノートブックの名前を入力してください')
            .addText(text => text
                .setPlaceholder('例: 2026-09 APIGW定期リリース')
                .onChange(val => this.title = val));

        new Setting(contentEl)
            .setName('説明 (任意)')
            .setDesc('このノートブックの目的やメモを入力してください')
            .addTextArea(text => text
                .setPlaceholder('例: リリース背景、変更点、切り戻し基準をまとめる')
                .onChange(val => this.description = val));

        // 外部バインドフォルダの設定 (任意)
        const defaultShared = this.notebookManager.settings.sharedFolderBasePath || '';
        new Setting(contentEl)
            .setName('🗄️ バインド外部フォルダ (任意)')
            .setDesc('ファイルサーバーやCIFS共有の絶対パスを指定すると、AI探索や一括取り込みが可能になります')
            .addText(text => text
                .setPlaceholder(defaultShared ? `例: ${defaultShared}/2026_案件` : '例: /Volumes/share/部内案件会議')
                .onChange(val => this.boundFolderPath = val));

        // 参照コンテキスト (Linked Notebooks) の選択
        const allNotebooks = await this.notebookManager.getAllNotebooks();
        if (allNotebooks.length > 0) {
            const contextSection = contentEl.createDiv({ cls: 'ai-notebook-create-context-section' });
            contextSection.createEl('h4', { text: '🔗 参照コンテキスト（他ノートブックを接続）' });
            contextSection.createEl('p', {
                text: '仕様書やテンプレートルールを持つノートブックをリンクして、AIの知識として共有できます。',
                cls: 'ai-notebook-hint-text'
            });

            const listWrap = contextSection.createDiv({ cls: 'ai-notebook-create-link-list' });
            for (const nb of allNotebooks) {
                const item = listWrap.createDiv({ cls: 'ai-notebook-link-item-simple' });
                const checkbox = item.createEl('input', { type: 'checkbox' });
                const icon = item.createSpan({ cls: 'ai-notebook-link-icon' });
                setIcon(icon, nb.icon || 'book-open');
                item.createSpan({ text: nb.title, cls: 'ai-notebook-link-title' });

                const toggle = () => {
                    if (this.selectedLinkedIds.has(nb.id)) {
                        this.selectedLinkedIds.delete(nb.id);
                        checkbox.checked = false;
                    } else {
                        this.selectedLinkedIds.add(nb.id);
                        checkbox.checked = true;
                    }
                };

                checkbox.onchange = () => toggle();
                item.onclick = (e) => {
                    if (e.target !== checkbox) toggle();
                };
            }
        }

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('作成する')
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
                            Array.from(this.selectedLinkedIds),
                            this.boundFolderPath.trim() || undefined
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
