import { marked } from 'marked';
import { div } from '../utils/dom';

export class MarkdownRenderer {
    static render(markdownText: string, container?: HTMLElement): HTMLElement {
        const root = container || div({ cls: 'ai-notebook-markdown-body' });
        if (!container) {
            root.className = 'ai-notebook-markdown-body';
        }

        try {
            // Configure marked options
            marked.setOptions({
                gfm: true,
                breaks: true,
            });

            const rawHtml = marked.parse(markdownText || '') as string;
            root.innerHTML = rawHtml;

            // Make external links open in new tab
            const links = root.querySelectorAll('a');
            links.forEach((a) => {
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer');
            });
        } catch (e) {
            console.error('Failed to render markdown:', e);
            root.textContent = markdownText;
        }

        return root;
    }
}
