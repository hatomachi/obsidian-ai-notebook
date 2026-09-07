import { NotebookMetadata, ChatSession } from '../../types';
import { div, el, span, button, empty } from '../utils/dom';
import { IViewerAdapter, NotebookDetailData, ViewerArtifact, ViewerSource } from '../adapters/GitLabViewerAdapter';
import { MarkdownRenderer } from './MarkdownRenderer';

export interface NotebookDetailViewProps {
    notebookId: string;
    adapter: IViewerAdapter;
    onBack: () => void;
    onSelectNotebook: (notebookId: string) => void;
    allNotebooks: NotebookMetadata[];
}

type DetailTab = 'chat' | 'artifacts' | 'sources' | 'linked';

export class NotebookDetailView {
    private container: HTMLElement;
    private props: NotebookDetailViewProps;
    private activeTab: DetailTab = 'chat';
    private detailData: NotebookDetailData | null = null;
    private selectedSessionId: string | null = null;
    private isLoading: boolean = true;
    private error: string | null = null;
    private selectedArtifactContent: { name: string; content: string } | null = null;
    private selectedSourceContent: { name: string; content: string } | null = null;

    constructor(container: HTMLElement, props: NotebookDetailViewProps) {
        this.container = container;
        this.props = props;
    }

    async load(): Promise<void> {
        this.isLoading = true;
        this.error = null;
        this.render();

        try {
            this.detailData = await this.props.adapter.getNotebookDetail(this.props.notebookId);
            this.selectedSessionId = this.detailData.activeSessionId || 
                (this.detailData.sessions.length > 0 ? this.detailData.sessions[0].id : null);
            
            // Default tab: If no chat sessions but artifacts exist, switch to artifacts
            if (this.detailData.sessions.length === 0 && this.detailData.artifacts.length > 0) {
                this.activeTab = 'artifacts';
            }
        } catch (e: any) {
            this.error = e.message || 'ノートブックの取得に失敗しました';
        } finally {
            this.isLoading = false;
            this.render();
        }
    }

    render(): void {
        empty(this.container);
        const root = div({ cls: 'ai-notebook-detail-view' }, this.container);

        // 1. Top Navigation Bar
        const topNav = div({ cls: 'ai-notebook-detail-top-nav' }, root);
        const backBtn = button({ text: '← ノート一覧', cls: 'ai-notebook-back-btn' }, topNav);
        backBtn.addEventListener('click', () => this.props.onBack());

        if (this.isLoading) {
            const loading = div({ cls: 'ai-notebook-loading-state' }, root);
            div({ cls: 'ai-notebook-spinner' }, loading);
            span({ text: 'ノートブック詳細を読み込み中...' }, loading);
            return;
        }

        if (this.error || !this.detailData) {
            const errorEl = div({ cls: 'ai-notebook-error-state' }, root);
            el('p', { text: `⚠️ ${this.error || 'データが見つかりませんでした'}` }, errorEl);
            const retryBtn = button({ text: '再読み込み', cls: 'ai-notebook-btn ai-notebook-btn-secondary' }, errorEl);
            retryBtn.addEventListener('click', () => this.load());
            return;
        }

        const { metadata, artifacts, sources, sessions } = this.detailData;

        // 2. Notebook Info Header
        const header = div({ cls: 'ai-notebook-detail-header' }, root);
        const titleRow = div({ cls: 'ai-notebook-detail-title-row' }, header);
        span({ text: this.getIconDisplay(metadata.icon), cls: 'ai-notebook-detail-icon' }, titleRow);
        el('h2', { text: metadata.title, cls: 'ai-notebook-detail-title' }, titleRow);

        if (metadata.description) {
            el('p', { text: metadata.description, cls: 'ai-notebook-detail-desc' }, header);
        }

        if (metadata.tags && metadata.tags.length > 0) {
            const tagsRow = div({ cls: 'ai-notebook-detail-tags' }, header);
            for (const tag of metadata.tags) {
                span({ text: `#${tag}`, cls: 'ai-notebook-card-tag' }, tagsRow);
            }
        }

        // 3. Tab Bar
        const tabBar = div({ cls: 'ai-notebook-tab-bar' }, root);

        const chatTabBtn = button({
            text: `💬 チャット (${sessions.reduce((acc, s) => acc + (s.messages?.length || 0), 0)})`,
            cls: ['ai-notebook-tab-btn', this.activeTab === 'chat' ? 'active' : ''],
        }, tabBar);
        chatTabBtn.addEventListener('click', () => {
            this.activeTab = 'chat';
            this.render();
        });

        const artifactsTabBtn = button({
            text: `📄 成果物 (${artifacts.length})`,
            cls: ['ai-notebook-tab-btn', this.activeTab === 'artifacts' ? 'active' : ''],
        }, tabBar);
        artifactsTabBtn.addEventListener('click', () => {
            this.activeTab = 'artifacts';
            this.render();
        });

        const sourcesTabBtn = button({
            text: `📂 ソース (${sources.length})`,
            cls: ['ai-notebook-tab-btn', this.activeTab === 'sources' ? 'active' : ''],
        }, tabBar);
        sourcesTabBtn.addEventListener('click', () => {
            this.activeTab = 'sources';
            this.render();
        });

        const linkedCount = metadata.linkedNotebookIds?.length || 0;
        const linkedTabBtn = button({
            text: `🔗 参照 (${linkedCount})`,
            cls: ['ai-notebook-tab-btn', this.activeTab === 'linked' ? 'active' : ''],
        }, tabBar);
        linkedTabBtn.addEventListener('click', () => {
            this.activeTab = 'linked';
            this.render();
        });

        // 4. Tab Content Area
        const contentArea = div({ cls: 'ai-notebook-tab-content' }, root);

        switch (this.activeTab) {
            case 'chat':
                this.renderChatTab(contentArea);
                break;
            case 'artifacts':
                this.renderArtifactsTab(contentArea);
                break;
            case 'sources':
                this.renderSourcesTab(contentArea);
                break;
            case 'linked':
                this.renderLinkedTab(contentArea);
                break;
        }
    }

    // 💬 Chat Tab
    private renderChatTab(container: HTMLElement): void {
        const sessions = this.detailData?.sessions || [];
        if (sessions.length === 0) {
            const emptyEl = div({ cls: 'ai-notebook-empty-state' }, container);
            span({ text: '対話履歴はまだありません。' }, emptyEl);
            return;
        }

        // Session Selector if multiple
        if (sessions.length > 1) {
            const selectorWrapper = div({ cls: 'ai-notebook-session-selector-wrapper' }, container);
            span({ text: '会話スレッド: ', cls: 'ai-notebook-session-label' }, selectorWrapper);
            const select = el('select', { cls: 'ai-notebook-session-select' }, selectorWrapper);

            for (const s of sessions) {
                const opt = el('option', {
                    value: s.id,
                    text: `${s.title || s.id} (${s.messages?.length || 0}件)`,
                }, select);
                if (s.id === this.selectedSessionId) {
                    opt.selected = true;
                }
            }

            select.addEventListener('change', (e) => {
                this.selectedSessionId = (e.target as HTMLSelectElement).value;
                this.render();
            });
        }

        const activeSession = sessions.find((s) => s.id === this.selectedSessionId) || sessions[0];
        const messages = activeSession.messages || [];

        const messagesList = div({ cls: 'ai-notebook-chat-messages' }, container);

        for (const msg of messages) {
            const msgRow = div({
                cls: ['ai-notebook-chat-row', `sender-${msg.sender}`],
            }, messagesList);

            const bubble = div({ cls: 'ai-notebook-chat-bubble' }, msgRow);

            // Sender Badge & Time
            const metaHeader = div({ cls: 'ai-notebook-msg-header' }, bubble);
            const senderName = msg.sender === 'user' ? '👤 ユーザー' : msg.sender === 'agent' ? '🤖 AI Agent' : 'ℹ️ System';
            span({ text: senderName, cls: 'ai-notebook-msg-sender' }, metaHeader);

            if (msg.timestamp) {
                const timeStr = msg.timestamp.includes('T') ? msg.timestamp.slice(11, 16) : msg.timestamp;
                span({ text: timeStr, cls: 'ai-notebook-msg-time' }, metaHeader);
            }

            // Body
            const bodyEl = div({ cls: 'ai-notebook-msg-body' }, bubble);
            MarkdownRenderer.render(msg.text, bodyEl);

            // Generated Artifacts Badges
            if (msg.artifactsGenerated && msg.artifactsGenerated.length > 0) {
                const artifactsRow = div({ cls: 'ai-notebook-msg-artifacts' }, bubble);
                span({ text: '📄 生成成果物:', cls: 'ai-notebook-msg-artifacts-label' }, artifactsRow);
                for (const artName of msg.artifactsGenerated) {
                    const badge = button({
                        text: artName,
                        cls: 'ai-notebook-msg-artifact-badge',
                    }, artifactsRow);
                    badge.addEventListener('click', () => {
                        this.activeTab = 'artifacts';
                        this.openArtifactPreview(artName);
                    });
                }
            }
        }
    }

    // 📄 Artifacts Tab
    private renderArtifactsTab(container: HTMLElement): void {
        const artifacts = this.detailData?.artifacts || [];
        if (artifacts.length === 0) {
            const emptyEl = div({ cls: 'ai-notebook-empty-state' }, container);
            span({ text: '生成された成果物はまだありません。' }, emptyEl);
            return;
        }

        const list = div({ cls: 'ai-notebook-item-list' }, container);

        for (const art of artifacts) {
            const itemCard = div({ cls: 'ai-notebook-item-card' }, list);
            const left = div({ cls: 'ai-notebook-item-left' }, itemCard);
            span({ text: '📄', cls: 'ai-notebook-item-icon' }, left);
            const textGroup = div({ cls: 'ai-notebook-item-text' }, left);
            el('h4', { text: art.name, cls: 'ai-notebook-item-name' }, textGroup);
            if (art.size) {
                span({ text: `${(art.size / 1024).toFixed(1)} KB`, cls: 'ai-notebook-item-size' }, textGroup);
            }

            const viewBtn = button({ text: 'プレビュー', cls: 'ai-notebook-btn ai-notebook-btn-secondary' }, itemCard);
            viewBtn.addEventListener('click', () => {
                this.openArtifactPreview(art.name, art.path);
            });
        }

        // Inline Preview if selected
        if (this.selectedArtifactContent) {
            this.renderContentPreview(container, this.selectedArtifactContent.name, this.selectedArtifactContent.content, () => {
                this.selectedArtifactContent = null;
                this.render();
            });
        }
    }

    private async openArtifactPreview(name: string, path?: string): Promise<void> {
        const targetPath = path || `${this.detailData?.metadata.id}/artifacts/${name}`;
        try {
            const content = await this.props.adapter.getFileContent(targetPath);
            this.selectedArtifactContent = { name, content };
            this.render();
        } catch (e: any) {
            alert(`ファイル取得エラー: ${e.message}`);
        }
    }

    // 📂 Sources Tab
    private renderSourcesTab(container: HTMLElement): void {
        const sources = this.detailData?.sources || [];
        if (sources.length === 0) {
            const emptyEl = div({ cls: 'ai-notebook-empty-state' }, container);
            span({ text: '投入されたソース資料はありません。' }, emptyEl);
            return;
        }

        const list = div({ cls: 'ai-notebook-item-list' }, container);

        for (const src of sources) {
            const itemCard = div({ cls: 'ai-notebook-item-card' }, list);
            const left = div({ cls: 'ai-notebook-item-left' }, itemCard);
            span({ text: this.getSourceIcon(src.extension), cls: 'ai-notebook-item-icon' }, left);
            const textGroup = div({ cls: 'ai-notebook-item-text' }, left);
            el('h4', { text: src.name, cls: 'ai-notebook-item-name' }, textGroup);
            if (src.size) {
                span({ text: `${(src.size / 1024).toFixed(1)} KB`, cls: 'ai-notebook-item-size' }, textGroup);
            }

            const isText = ['md', 'txt', 'patch', 'json', 'yaml', 'yml'].includes(src.extension.toLowerCase());
            if (isText) {
                const viewBtn = button({ text: '表示', cls: 'ai-notebook-btn ai-notebook-btn-secondary' }, itemCard);
                viewBtn.addEventListener('click', async () => {
                    try {
                        const content = await this.props.adapter.getFileContent(src.path);
                        this.selectedSourceContent = { name: src.name, content };
                        this.render();
                    } catch (e: any) {
                        alert(`ファイル取得エラー: ${e.message}`);
                    }
                });
            }
        }

        // Inline Preview if selected
        if (this.selectedSourceContent) {
            this.renderContentPreview(container, this.selectedSourceContent.name, this.selectedSourceContent.content, () => {
                this.selectedSourceContent = null;
                this.render();
            });
        }
    }

    // 🔗 Linked Tab
    private renderLinkedTab(container: HTMLElement): void {
        const linkedIds = this.detailData?.metadata.linkedNotebookIds || [];
        if (linkedIds.length === 0) {
            const emptyEl = div({ cls: 'ai-notebook-empty-state' }, container);
            span({ text: '参照しているノートブックはありません。' }, emptyEl);
            return;
        }

        const list = div({ cls: 'ai-notebook-item-list' }, container);

        for (const id of linkedIds) {
            const linkedNb = this.props.allNotebooks.find((n) => n.id === id);
            const itemCard = div({ cls: 'ai-notebook-item-card clickable' }, list);
            itemCard.addEventListener('click', () => {
                this.props.onSelectNotebook(id);
            });

            const left = div({ cls: 'ai-notebook-item-left' }, itemCard);
            span({ text: this.getIconDisplay(linkedNb?.icon), cls: 'ai-notebook-item-icon' }, left);
            const textGroup = div({ cls: 'ai-notebook-item-text' }, left);
            el('h4', { text: linkedNb?.title || id, cls: 'ai-notebook-item-name' }, textGroup);
            if (linkedNb?.description) {
                el('p', { text: linkedNb.description, cls: 'ai-notebook-item-sub' }, textGroup);
            }

            span({ text: '開く →', cls: 'ai-notebook-link-action' }, itemCard);
        }
    }

    // Modal/Inline Preview
    private renderContentPreview(container: HTMLElement, title: string, content: string, onClose: () => void): void {
        const modalBackdrop = div({ cls: 'ai-notebook-modal-backdrop' }, document.body);
        const modal = div({ cls: 'ai-notebook-modal preview-modal' }, modalBackdrop);

        const header = div({ cls: 'ai-notebook-modal-header' }, modal);
        el('h3', { text: title, cls: 'ai-notebook-modal-title' }, header);

        const actions = div({ cls: 'ai-notebook-modal-header-actions' }, header);
        const copyBtn = button({ text: '📋 コピー', cls: 'ai-notebook-btn ai-notebook-btn-secondary' }, actions);
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(content);
                copyBtn.textContent = '✅ コピー完了';
                setTimeout(() => (copyBtn.textContent = '📋 コピー'), 2000);
            } catch {
                alert('クリップボードへのコピーに失敗しました');
            }
        });

        const closeBtn = button({ text: '✕', cls: 'ai-notebook-modal-close-btn' }, actions);
        closeBtn.addEventListener('click', () => {
            modalBackdrop.remove();
            onClose();
        });

        const body = div({ cls: 'ai-notebook-modal-body preview-body' }, modal);
        MarkdownRenderer.render(content, body);

        modalBackdrop.addEventListener('click', (e) => {
            if (e.target === modalBackdrop) {
                modalBackdrop.remove();
                onClose();
            }
        });
    }

    private getIconDisplay(iconName?: string): string {
        switch (iconName) {
            case 'rocket': return '🚀';
            case 'server': return '📘';
            case 'file-text': return '📋';
            case 'database': return '🗄️';
            case 'sparkles': return '✨';
            default: return '📖';
        }
    }

    private getSourceIcon(ext: string): string {
        switch (ext.toLowerCase()) {
            case 'md': return '📝';
            case 'txt': return '📄';
            case 'patch': return '🔧';
            case 'pdf': return '📕';
            case 'docx': return '📘';
            case 'xlsx': return '📗';
            default: return '📁';
        }
    }
}
