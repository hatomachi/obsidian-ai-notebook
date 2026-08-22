import { Plugin, WorkspaceLeaf } from 'obsidian';
import { AINotebookSettings, DEFAULT_SETTINGS } from './types';
import { AINotebookSettingTab } from './settings';
import { NotebookManager } from './services/NotebookManager';
import { AINotebookGalleryView, VIEW_TYPE_GALLERY } from './views/GalleryView';
import { AINotebookDetailView, VIEW_TYPE_DETAIL } from './views/NotebookDetailView';

export default class AINotebookPlugin extends Plugin {
    settings!: AINotebookSettings;
    notebookManager!: NotebookManager;

    async onload(): Promise<void> {
        console.log('Loading Obsidian AI Notebook Plugin');

        await this.loadSettings();

        this.notebookManager = new NotebookManager(this.app, this.settings);

        // 基本フォルダ構造の自動作成
        this.app.workspace.onLayoutReady(async () => {
            await this.notebookManager.ensureBaseDirectories();
        });

        // ビューの登録
        this.registerView(
            VIEW_TYPE_GALLERY,
            (leaf) => {
                const galleryView = new AINotebookGalleryView(leaf, this);
                galleryView.onSelectNotebookHandler = (id) => this.activateDetailView(id);
                return galleryView;
            }
        );

        this.registerView(
            VIEW_TYPE_DETAIL,
            (leaf) => {
                const detailView = new AINotebookDetailView(leaf, this);
                detailView.onBackToGalleryHandler = () => this.activateGalleryView();
                return detailView;
            }
        );

        // 設定タブを追加
        this.addSettingTab(new AINotebookSettingTab(this.app, this));

        // リボンアイコンの追加
        this.addRibbonIcon('book-open', 'AI Notebook Gallery', () => {
            this.activateGalleryView();
        });

        // コマンドの追加
        this.addCommand({
            id: 'open-ai-notebook-gallery',
            name: 'Open AI Notebook Gallery',
            callback: () => {
                this.activateGalleryView();
            }
        });
    }

    async activateGalleryView(): Promise<void> {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;

        const leaves = workspace.getLeavesOfType(VIEW_TYPE_GALLERY);
        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({
                type: VIEW_TYPE_GALLERY,
                active: true,
            });
        }

        const view = leaf.view;
        if (view instanceof AINotebookGalleryView) {
            await view.refresh();
        }

        workspace.revealLeaf(leaf);
    }

    async activateDetailView(notebookId: string): Promise<void> {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;

        const leaves = workspace.getLeavesOfType(VIEW_TYPE_DETAIL);
        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({
                type: VIEW_TYPE_DETAIL,
                active: true,
            });
        }

        const view = leaf.view;
        if (view instanceof AINotebookDetailView) {
            await view.setNotebookId(notebookId);
        }

        workspace.revealLeaf(leaf);
    }

    onunload(): void {
        console.log('Unloading Obsidian AI Notebook Plugin');
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        if (this.notebookManager) {
            this.notebookManager.settings = this.settings;
        }
    }
}
