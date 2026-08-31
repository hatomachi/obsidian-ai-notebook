import { App, Modal, Setting, Notice } from 'obsidian';
import { NotebookManager } from '../../services/NotebookManager';
import { BoundFolderReader } from '../../services/BoundFolderReader';

export class BindFolderModal extends Modal {
    notebookManager: NotebookManager;
    notebookId: string;
    currentPath: string;
    onSaved: () => void;

    inputPath: string = '';

    constructor(
        app: App,
        notebookManager: NotebookManager,
        notebookId: string,
        currentPath: string,
        onSaved: () => void
    ) {
        super(app);
        this.notebookManager = notebookManager;
        this.notebookId = notebookId;
        this.currentPath = currentPath;
        this.inputPath = currentPath;
        this.onSaved = onSaved;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-notebook-bind-modal');

        contentEl.createEl('h2', { text: '🗄️ 外部フォルダのバインド設定' });
        contentEl.createEl('p', {
            text: 'ファイルサーバー（CIFS共有）やローカルフォルダの絶対パスを指定すると、AI探索や階層ツリーからの一括取り込み（Extract）が可能になります。',
            cls: 'ai-notebook-hint-text'
        });

        const defaultShared = this.notebookManager.settings.sharedFolderBasePath || '';

        new Setting(contentEl)
            .setName('フォルダの絶対パス')
            .setDesc('例: /Users/username/work/project/docs や /Volumes/share/部内案件')
            .addText(text => {
                text.setPlaceholder(defaultShared || '/path/to/folder')
                    .setValue(this.inputPath)
                    .onChange(val => {
                        this.inputPath = val;
                    });
                text.inputEl.style.width = '100%';
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('保存する')
                .setCta()
                .onClick(async () => {
                    const trimmed = this.inputPath.trim();
                    if (trimmed && !BoundFolderReader.isValidDirectory(trimmed)) {
                        new Notice(`⚠️ 警告: 指定されたパスが見つかりません: ${trimmed}`, 4000);
                    }

                    try {
                        await this.notebookManager.updateNotebookMetadata(this.notebookId, {
                            boundFolderPath: trimmed || undefined
                        });
                        new Notice(trimmed ? '外部フォルダをバインドしました' : 'バインドを解除しました');
                        this.onSaved();
                        this.close();
                    } catch (e: any) {
                        new Notice(`保存に失敗しました: ${e.message}`);
                    }
                }))
            .addButton(btn => btn
                .setButtonText('バインド解除')
                .setWarning()
                .onClick(async () => {
                    await this.notebookManager.updateNotebookMetadata(this.notebookId, {
                        boundFolderPath: undefined
                    });
                    new Notice('バインドを解除しました');
                    this.onSaved();
                    this.close();
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
