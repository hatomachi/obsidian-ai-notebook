import { App, Modal, Setting, Notice } from 'obsidian';
import { NotebookManager } from '../../services/NotebookManager';
import { TextInputModal } from './TextInputModal';

export class MoveSourceModal extends Modal {
    private notebookManager: NotebookManager;
    private notebookId: string;
    private fileName: string;
    private sourceRelativePath: string;
    private currentSubfolder?: string;
    private onMoved: () => void;

    constructor(
        app: App,
        notebookManager: NotebookManager,
        notebookId: string,
        fileName: string,
        sourceRelativePath: string,
        currentSubfolder: string | undefined,
        onMoved: () => void
    ) {
        super(app);
        this.notebookManager = notebookManager;
        this.notebookId = notebookId;
        this.fileName = fileName;
        this.sourceRelativePath = sourceRelativePath;
        this.currentSubfolder = currentSubfolder;
        this.onMoved = onMoved;
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-notebook-move-source-modal');

        contentEl.createEl('h3', { text: `📁 ファイルの移動: ${this.fileName}` });
        
        const currentLocStr = this.currentSubfolder ? `📁 ${this.currentSubfolder}` : '📄 直下 (ルート)';
        contentEl.createEl('p', {
            text: `現在の配置場所: ${currentLocStr}`,
            cls: 'ai-notebook-hint-text'
        });

        const folders = await this.notebookManager.getSourceFolders(this.notebookId);

        const listContainer = contentEl.createDiv({ cls: 'ai-notebook-move-target-list' });

        // 1. 直下（ルート）への移動オプション
        const rootItem = listContainer.createDiv({
            cls: `ai-notebook-move-target-item ${!this.currentSubfolder ? 'is-current' : 'is-clickable'}`
        });
        rootItem.createSpan({ text: '📄 直下 (ルート)', cls: 'ai-notebook-move-target-name' });
        if (!this.currentSubfolder) {
            rootItem.createSpan({ text: '（現在の場所）', cls: 'ai-notebook-move-target-current' });
        } else {
            rootItem.onclick = async () => {
                await this.executeMove(null);
            };
        }

        // 2. 既存サブフォルダ一覧
        for (const folder of folders) {
            const isCurrent = this.currentSubfolder === folder;
            const folderItem = listContainer.createDiv({
                cls: `ai-notebook-move-target-item ${isCurrent ? 'is-current' : 'is-clickable'}`
            });
            folderItem.createSpan({ text: `📁 ${folder}`, cls: 'ai-notebook-move-target-name' });
            if (isCurrent) {
                folderItem.createSpan({ text: '（現在の場所）', cls: 'ai-notebook-move-target-current' });
            } else {
                folderItem.onclick = async () => {
                    await this.executeMove(folder);
                };
            }
        }

        // 3. 新規フォルダ作成して移動
        const newFolderSetting = new Setting(contentEl);
        newFolderSetting.setName('新しいフォルダを作成して移動');
        newFolderSetting.setDesc('新しいサブフォルダを作成し、このファイルを即座に移動します');
        newFolderSetting.addButton(btn => {
            btn.setButtonText('＋ 新規フォルダ作成...')
                .setCta()
                .onClick(() => {
                    this.close();
                    new TextInputModal(
                        this.app,
                        '📁 新規サブフォルダを作成して移動',
                        '',
                        async (newFolderName) => {
                            if (!newFolderName.trim()) return;
                            try {
                                const created = await this.notebookManager.createSourceFolder(this.notebookId, newFolderName.trim());
                                await this.notebookManager.moveSourceFile(this.notebookId, this.sourceRelativePath, created);
                                new Notice(`"${this.fileName}" を 📁 ${created} へ移動しました`);
                                this.onMoved();
                            } catch (e: any) {
                                new Notice(`移動に失敗しました: ${e?.message || e}`);
                            }
                        },
                        {
                            description: `"${this.fileName}" を移動する新しいフォルダ名を入力してください`,
                            placeholder: '例: 01_ヒアリング'
                        }
                    ).open();
                });
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('キャンセル')
                .onClick(() => this.close()));
    }

    private async executeMove(targetFolder: string | null): Promise<void> {
        try {
            await this.notebookManager.moveSourceFile(this.notebookId, this.sourceRelativePath, targetFolder);
            const destStr = targetFolder ? `📁 ${targetFolder}` : '直下';
            new Notice(`"${this.fileName}" を ${destStr} へ移動しました`);
            this.close();
            this.onMoved();
        } catch (e: any) {
            new Notice(`移動に失敗しました: ${e?.message || e}`);
        }
    }
}
