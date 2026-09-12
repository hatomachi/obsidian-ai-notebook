import { Plugin, WorkspaceLeaf } from 'obsidian';
import { AINotebookSettings, DEFAULT_SETTINGS } from './types';
import { AINotebookSettingTab } from './settings';
import { NotebookManager } from './services/NotebookManager';
import { MattermostService } from './services/MattermostService';
import { GitLabService } from './services/GitLabService';
import { AINotebookGalleryView, VIEW_TYPE_GALLERY } from './views/GalleryView';
import { AINotebookDetailView, VIEW_TYPE_DETAIL } from './views/NotebookDetailView';

export default class AINotebookPlugin extends Plugin {
    settings!: AINotebookSettings;
    notebookManager!: NotebookManager;
    mattermostService!: MattermostService;
    gitlabService!: GitLabService;

    async onload(): Promise<void> {
        console.log('Loading Obsidian AI Notebook Plugin');

        await this.loadSettings();

        this.gitlabService = new GitLabService(this.settings);
        this.notebookManager = new NotebookManager(this.app, this.settings, this.gitlabService);
        this.mattermostService = new MattermostService(this.settings);

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

        // 🦊 GitLab Uploads 認証付き画像プレビューの自動レンダリング
        this.registerMarkdownPostProcessor(async (el, ctx) => {
            await this.scanAndRenderGitLabImages(el);
        });

        // ワークスペース変更・エディタ切替時にも自動スキャン
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                setTimeout(() => this.scanAndRenderGitLabImages(), 150);
            })
        );
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                setTimeout(() => this.scanAndRenderGitLabImages(), 150);
            })
        );
    }

    /**
     * 指定されたコンテナ（未指定なら document.body 全体）内の GitLab Uploads 画像を認証付き Blob URL に置換
     */
    async scanAndRenderGitLabImages(container?: HTMLElement): Promise<void> {
        if (!this.gitlabService) return;
        const target = container || document.body;
        const images = target.querySelectorAll<HTMLImageElement>('img');
        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            if (img.hasClass('ai-notebook-gitlab-loaded') || img.hasClass('ai-notebook-gitlab-loading')) {
                continue;
            }
            const src = img.getAttribute('src');
            if (!src) continue;

            if (this.gitlabService.isGitLabUploadUrl(src)) {
                img.addClass('ai-notebook-gitlab-loading');
                try {
                    const blobUrl = await this.gitlabService.getAuthenticatedImageUrl(src);
                    if (blobUrl) {
                        img.src = blobUrl;
                        img.removeClass('ai-notebook-gitlab-loading');
                        img.addClass('ai-notebook-gitlab-loaded');
                    }
                } catch (err: any) {
                    console.error('[AI Notebook] GitLab 画像プレビュー取得失敗:', src, err);
                    img.removeClass('ai-notebook-gitlab-loading');
                    img.addClass('ai-notebook-gitlab-error');
                    img.setAttribute('title', `GitLab 画像の取得に失敗しました: ${err?.message || err}`);
                }
            }
        }
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
        if (this.gitlabService) {
            this.gitlabService.clearImageCache();
        }
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        if (this.notebookManager) {
            this.notebookManager.settings = this.settings;
        }
        if (this.mattermostService) {
            this.mattermostService.updateSettings(this.settings);
        }
        if (this.gitlabService) {
            this.gitlabService.updateSettings(this.settings);
        }
    }
}
