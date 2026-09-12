import { NotebookMetadata } from '../../types';
import { div, el, span, button, empty } from '../utils/dom';

export interface GalleryViewProps {
    notebooks: NotebookMetadata[];
    onSelectNotebook: (notebookId: string) => void;
    isLoading: boolean;
    error?: string | null;
    onRefresh: () => void;
}

export class GalleryView {
    private container: HTMLElement;
    private searchQuery: string = '';
    private props: GalleryViewProps;

    constructor(container: HTMLElement, props: GalleryViewProps) {
        this.container = container;
        this.props = props;
    }

    update(props: GalleryViewProps): void {
        this.props = props;
        this.render();
    }

    render(): void {
        empty(this.container);
        const root = div({ cls: 'ai-notebook-gallery-view' }, this.container);

        // 1. Search Bar & Controls
        const searchSection = div({ cls: 'ai-notebook-gallery-search-section' }, root);
        const searchInput = el('input', {
            type: 'text',
            placeholder: '🔍 ノートブックを検索（タイトル、説明、タグ）...',
            value: this.searchQuery,
            cls: 'ai-notebook-search-input',
        }, searchSection);

        searchInput.addEventListener('input', (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
            this.renderCards(cardsContainer);
        });

        // 2. Status / Error messages
        if (this.props.isLoading) {
            const loadingEl = div({ cls: 'ai-notebook-loading-state' }, root);
            div({ cls: 'ai-notebook-spinner' }, loadingEl);
            span({ text: 'GitLab からノートブックを読み込み中...' }, loadingEl);
            return;
        }

        if (this.props.error) {
            const errorEl = div({ cls: 'ai-notebook-error-state' }, root);
            el('p', { text: `⚠️ ${this.props.error}` }, errorEl);
            const retryBtn = button({ text: '再試行', cls: 'ai-notebook-btn ai-notebook-btn-secondary' }, errorEl);
            retryBtn.addEventListener('click', () => this.props.onRefresh());
            return;
        }

        // 3. Cards Container
        const cardsContainer = div({ cls: 'ai-notebook-gallery-grid' }, root);
        this.renderCards(cardsContainer);
    }

    private renderCards(cardsContainer: HTMLElement): void {
        empty(cardsContainer);

        const filtered = this.props.notebooks.filter((nb) => {
            if (!this.searchQuery) return true;
            const titleMatch = (nb.title || '').toLowerCase().includes(this.searchQuery);
            const descMatch = (nb.description || '').toLowerCase().includes(this.searchQuery);
            const tagMatch = (nb.tags || []).some((t) => t.toLowerCase().includes(this.searchQuery));
            return titleMatch || descMatch || tagMatch;
        });

        if (filtered.length === 0) {
            const emptyEl = div({ cls: 'ai-notebook-empty-state' }, cardsContainer);
            span({ text: this.searchQuery ? '一致するノートブックが見つかりませんでした。' : 'ノートブックが存在しません。' }, emptyEl);
            return;
        }

        for (const nb of filtered) {
            const card = div({ cls: 'ai-notebook-gallery-card' }, cardsContainer);
            card.addEventListener('click', () => {
                this.props.onSelectNotebook(nb.id);
            });

            // Card Header (Icon + Title)
            const cardHeader = div({ cls: 'ai-notebook-card-header' }, card);
            const iconBadge = span({ cls: 'ai-notebook-card-icon' }, cardHeader);
            iconBadge.textContent = this.getIconDisplay(nb.icon);

            if (nb.userName) {
                span({ text: `@${nb.userName}`, cls: 'ai-notebook-user-badge is-others' }, cardHeader);
            }

            el('h3', { text: nb.title, cls: 'ai-notebook-card-title' }, cardHeader);

            // Card Description
            if (nb.description) {
                el('p', { text: nb.description, cls: 'ai-notebook-card-desc' }, card);
            }

            // Tags
            if (nb.tags && nb.tags.length > 0) {
                const tagsWrapper = div({ cls: 'ai-notebook-card-tags' }, card);
                for (const tag of nb.tags) {
                    span({ text: `#${tag}`, cls: 'ai-notebook-card-tag' }, tagsWrapper);
                }
            }

            // Card Footer (Linked count + Updated at)
            const cardFooter = div({ cls: 'ai-notebook-card-footer' }, card);
            
            const badges = div({ cls: 'ai-notebook-card-badges' }, cardFooter);
            if (nb.linkedNotebookIds && nb.linkedNotebookIds.length > 0) {
                span({
                    text: `🔗 参照 ${nb.linkedNotebookIds.length}件`,
                    cls: 'ai-notebook-card-badge-linked',
                }, badges);
            }

            const updatedDate = nb.updatedAt ? nb.updatedAt.slice(0, 10) : '';
            if (updatedDate) {
                span({ text: updatedDate, cls: 'ai-notebook-card-date' }, cardFooter);
            }
        }
    }

    private getIconDisplay(iconName?: string): string {
        switch (iconName) {
            case 'rocket': return '🚀';
            case 'server': return '📘';
            case 'file-text': return '📋';
            case 'database': return '🗄️';
            case 'sparkles': return '✨';
            case 'terminal': return '💻';
            case 'code': return '⚙️';
            default: return '📖';
        }
    }
}
