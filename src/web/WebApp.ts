import { NotebookMetadata } from '../types';
import { div, el, span, button, empty } from './utils/dom';
import { IViewerAdapter, GitLabConfig, GitLabViewerAdapter } from './adapters/GitLabViewerAdapter';
import { MockViewerAdapter } from './adapters/MockViewerAdapter';
import { GalleryView } from './components/GalleryView';
import { NotebookDetailView } from './components/NotebookDetailView';
import { SettingsModal, WebStorageMode } from './components/SettingsModal';

const GITLAB_CONFIG_STORAGE_KEY = 'ainotebook_gitlab_config';
const MODE_STORAGE_KEY = 'ainotebook_active_mode';

const DEFAULT_GITLAB_CONFIG: GitLabConfig = {
    baseUrl: '',
    projectId: '',
    branch: 'main',
    token: '',
    rootDir: '_ainotebook',
};

export class WebApp {
    private rootEl: HTMLElement;
    private activeMode: WebStorageMode = 'mock';
    private gitlabConfig: GitLabConfig = DEFAULT_GITLAB_CONFIG;
    private adapter: IViewerAdapter;
    private notebooks: NotebookMetadata[] = [];
    private currentNotebookId: string | null = null;
    private isLoading: boolean = false;
    private error: string | null = null;
    private settingsModal = new SettingsModal();

    // UI Elements
    private headerEl!: HTMLElement;
    private contentEl!: HTMLElement;
    private modeBadgeEl!: HTMLElement;

    constructor(rootEl: HTMLElement) {
        this.rootEl = rootEl;
        this.loadSettings();
        this.adapter = this.createAdapter();
    }

    private loadSettings(): void {
        try {
            const rawConfig = localStorage.getItem(GITLAB_CONFIG_STORAGE_KEY);
            if (rawConfig) {
                this.gitlabConfig = { ...DEFAULT_GITLAB_CONFIG, ...JSON.parse(rawConfig) };
            }
            const rawMode = localStorage.getItem(MODE_STORAGE_KEY);
            if (rawMode === 'gitlab' || rawMode === 'mock') {
                this.activeMode = rawMode;
            } else {
                // If GitLab config has values, default to gitlab, otherwise mock
                this.activeMode = (this.gitlabConfig.baseUrl && this.gitlabConfig.projectId && this.gitlabConfig.token) ? 'gitlab' : 'mock';
            }
        } catch {
            this.gitlabConfig = DEFAULT_GITLAB_CONFIG;
            this.activeMode = 'mock';
        }
    }

    private saveSettings(mode: WebStorageMode, config: GitLabConfig): void {
        this.activeMode = mode;
        this.gitlabConfig = config;
        try {
            localStorage.setItem(MODE_STORAGE_KEY, mode);
            localStorage.setItem(GITLAB_CONFIG_STORAGE_KEY, JSON.stringify(config));
        } catch (e) {
            console.warn('Failed to save settings:', e);
        }
        this.adapter = this.createAdapter();
        this.updateHeaderBadge();
        this.refresh();
    }

    private createAdapter(): IViewerAdapter {
        if (this.activeMode === 'gitlab' && this.gitlabConfig.baseUrl && this.gitlabConfig.projectId && this.gitlabConfig.token) {
            return new GitLabViewerAdapter(this.gitlabConfig);
        }
        return new MockViewerAdapter();
    }

    mount(): void {
        empty(this.rootEl);
        this.rootEl.className = 'ai-notebook-web-app';

        // 1. Header
        this.headerEl = div({ cls: 'ai-notebook-web-header' }, this.rootEl);
        this.renderHeader();

        // 2. Main Content
        this.contentEl = div({ cls: 'ai-notebook-web-content' }, this.rootEl);

        // Initial Load
        this.refresh();
    }

    private renderHeader(): void {
        empty(this.headerEl);

        const leftGroup = div({ cls: 'ai-notebook-web-header-left' }, this.headerEl);
        const titleArea = div({ cls: 'ai-notebook-web-header-title-area' }, leftGroup);
        span({ text: '✨', cls: 'ai-notebook-web-logo-icon' }, titleArea);
        el('h1', { text: 'AI Notebook', cls: 'ai-notebook-web-title' }, titleArea);

        this.modeBadgeEl = button({
            cls: 'ai-notebook-web-mode-badge',
            title: 'クリックして接続設定を開く',
        }, leftGroup);
        this.modeBadgeEl.addEventListener('click', () => this.openSettings());
        this.updateHeaderBadge();

        const rightGroup = div({ cls: 'ai-notebook-web-header-actions' }, this.headerEl);
        const refreshBtn = button({
            text: '↻',
            cls: 'ai-notebook-web-icon-btn',
            title: 'リフレッシュ',
        }, rightGroup);
        refreshBtn.addEventListener('click', () => this.refresh());

        const settingsBtn = button({
            text: '⚙️',
            cls: 'ai-notebook-web-icon-btn',
            title: '設定',
        }, rightGroup);
        settingsBtn.addEventListener('click', () => this.openSettings());
    }

    private updateHeaderBadge(): void {
        empty(this.modeBadgeEl);
        if (this.activeMode === 'gitlab' && this.gitlabConfig.baseUrl && this.gitlabConfig.projectId) {
            this.modeBadgeEl.className = 'ai-notebook-web-mode-badge gitlab';
            span({ text: '🦊', cls: 'badge-icon' }, this.modeBadgeEl);
            span({ text: `GitLab (${this.gitlabConfig.projectId})` }, this.modeBadgeEl);
        } else {
            this.modeBadgeEl.className = 'ai-notebook-web-mode-badge mock';
            span({ text: '📱', cls: 'badge-icon' }, this.modeBadgeEl);
            span({ text: 'Local モック' }, this.modeBadgeEl);
        }
    }

    private openSettings(): void {
        this.settingsModal.open({
            isOpen: true,
            activeMode: this.activeMode,
            gitlabConfig: this.gitlabConfig,
            onSave: (mode, config) => this.saveSettings(mode, config),
            onClose: () => {},
        });
    }

    async refresh(): Promise<void> {
        this.isLoading = true;
        this.error = null;
        this.renderContent();

        try {
            this.notebooks = await this.adapter.getNotebooks();
        } catch (e: any) {
            this.error = e.message || 'ノートブックの取得に失敗しました';
        } finally {
            this.isLoading = false;
            this.renderContent();
        }
    }

    private renderContent(): void {
        empty(this.contentEl);

        if (this.currentNotebookId) {
            // Render Detail View
            const detailView = new NotebookDetailView(this.contentEl, {
                notebookId: this.currentNotebookId,
                adapter: this.adapter,
                allNotebooks: this.notebooks,
                onBack: () => {
                    this.currentNotebookId = null;
                    this.renderContent();
                },
                onSelectNotebook: (id) => {
                    this.currentNotebookId = id;
                    this.renderContent();
                },
            });
            detailView.load();
        } else {
            // Render Gallery View
            const galleryView = new GalleryView(this.contentEl, {
                notebooks: this.notebooks,
                isLoading: this.isLoading,
                error: this.error,
                onRefresh: () => this.refresh(),
                onSelectNotebook: (id) => {
                    this.currentNotebookId = id;
                    this.renderContent();
                },
            });
            galleryView.render();
        }
    }
}
