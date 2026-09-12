import { App, Modal, setIcon, TFile, Notice } from 'obsidian';
import type AINotebookPlugin from '../../main';
import { NotebookSource } from '../../types';
import { DebugFolderHelper } from '../../utils/debugFolderHelper';
import * as fs from 'fs';

export class ImagePreviewModal extends Modal {
    plugin: AINotebookPlugin;
    source: NotebookSource;

    private imageUrl: string = '';
    private originalName: string = '';
    private webpName: string = '';
    private originalSize: number = 0;
    private compressedSize: number = 0;
    private compressionRatio: number = 0;

    constructor(app: App, plugin: AINotebookPlugin, source: NotebookSource) {
        super(app);
        this.plugin = plugin;
        this.source = source;
    }

    async onOpen(): Promise<void> {
        this.modalEl.addClass('ai-notebook-modal', 'ai-notebook-image-preview-modal');
        const { contentEl } = this;
        contentEl.empty();

        // 1. ノートの Frontmatter または origin から GitLab URL とメタデータを抽出
        await this.resolveMetadata();

        // 2. ヘッダー
        const header = contentEl.createDiv({ cls: 'ai-notebook-image-modal-header' });
        const titleArea = header.createDiv({ cls: 'ai-notebook-image-modal-title' });
        const iconSpan = titleArea.createSpan({ cls: 'ai-notebook-image-modal-icon' });
        setIcon(iconSpan, 'image');
        titleArea.createEl('h2', { text: this.originalName || this.source.name });

        // 3. メタデータバー（WebP軽量化情報）
        if (this.originalSize > 0 && this.compressedSize > 0) {
            const metaBar = contentEl.createDiv({ cls: 'ai-notebook-image-modal-meta' });
            const origKb = Math.round(this.originalSize / 1024);
            const compKb = Math.round(this.compressedSize / 1024);
            metaBar.createSpan({
                text: `🗜️ WebP圧縮: ${origKb} KB ➡ ${compKb} KB (${this.compressionRatio}%削減 / ローカル消費0B)`,
                cls: 'ai-notebook-image-modal-badge'
            });
        }

        // 4. 画像表示コンテナ
        const previewContainer = contentEl.createDiv({ cls: 'ai-notebook-image-modal-body' });
        const loadingEl = previewContainer.createDiv({ cls: 'ai-notebook-image-modal-loading' });
        loadingEl.setText('🦊 GitLabから画像を取得中...');

        // 5. 画像の取得と表示
        try {
            let displayUrl = '';

            // ノートブックIDの特定
            const nbMatch = this.source.path.match(/notebooks\/([^/]+)\/sources/);
            const notebookId = nbMatch ? nbMatch[1] : '';

            // 5-a. ローカルキャッシュ（sources/.cache/images/<webpName>）が存在すれば最優先で高速表示
            if (notebookId && this.webpName && this.plugin.notebookManager.isImageCached(notebookId, this.webpName)) {
                const { absolutePath } = this.plugin.notebookManager.getImageCachePath(notebookId, this.webpName);
                if (absolutePath && fs.existsSync(absolutePath)) {
                    const fileBuf = fs.readFileSync(absolutePath);
                    const blob = new Blob([fileBuf], { type: 'image/webp' });
                    displayUrl = URL.createObjectURL(blob);
                }
            }

            // 5-b. キャッシュに無ければ GitLab API からオンデマンド取得
            if (!displayUrl && this.imageUrl && this.plugin.gitlabService?.isGitLabUploadUrl(this.imageUrl)) {
                displayUrl = await this.plugin.gitlabService.getAuthenticatedImageUrl(this.imageUrl);
                // バックグラウンドでローカルキャッシュにも保存
                if (notebookId && this.webpName) {
                    this.plugin.gitlabService.downloadFile(this.imageUrl)
                        .then(buf => this.plugin.notebookManager.saveImageToCache(notebookId, this.webpName, buf))
                        .catch(cErr => console.warn('[AI Notebook] Image cache save in modal failed:', cErr));
                }
            } else if (!displayUrl) {
                // ローカルに原本がある場合
                const localFile = this.app.vault.getAbstractFileByPath(this.source.path);
                if (localFile instanceof TFile) {
                    displayUrl = this.app.vault.getResourcePath(localFile);
                }
            }

            loadingEl.remove();

            if (displayUrl) {
                const img = previewContainer.createEl('img', {
                    cls: 'ai-notebook-image-modal-img'
                });
                img.src = displayUrl;
                img.alt = this.originalName || this.source.name;
            } else {
                previewContainer.createDiv({
                    text: '⚠️ 画像URLが見つかりませんでした。',
                    cls: 'ai-notebook-empty-text'
                });
            }
        } catch (err: any) {
            loadingEl.remove();
            const errBox = previewContainer.createDiv({ cls: 'ai-notebook-image-modal-error' });
            errBox.createEl('p', { text: `❌ 画像の読み込みに失敗しました: ${err?.message || err}` });
            if (this.imageUrl) {
                const retryBtn = errBox.createEl('button', {
                    text: 'ブラウザで開く',
                    cls: 'ai-notebook-btn ai-notebook-btn-secondary'
                });
                retryBtn.onclick = () => window.open(this.imageUrl, '_blank');
            }
        }

        // 6. フッターアクションボタン
        const footer = contentEl.createDiv({ cls: 'ai-notebook-modal-buttons' });

        if (this.imageUrl) {
            const gitlabBtn = footer.createEl('button', {
                text: '🦊 GitLab で開く',
                cls: 'ai-notebook-btn ai-notebook-btn-secondary'
            });
            gitlabBtn.onclick = () => window.open(this.imageUrl, '_blank');
        }

        const openEditorBtn = footer.createEl('button', {
            text: '📝 ノートを開く',
            cls: 'ai-notebook-btn ai-notebook-btn-secondary'
        });
        openEditorBtn.onclick = async () => {
            this.close();
            await DebugFolderHelper.openInEditor(this.app, this.source.path);
        };

        const closeBtn = footer.createEl('button', {
            text: '閉じる',
            cls: 'ai-notebook-btn ai-notebook-btn-primary'
        });
        closeBtn.onclick = () => this.close();
    }

    private async resolveMetadata(): Promise<void> {
        this.originalName = this.source.name;
        this.imageUrl = this.source.origin?.remoteUrl || '';

        // Markdown ファイルなら Frontmatter から詳細を取得
        const file = this.app.vault.getAbstractFileByPath(this.source.path);
        if (file instanceof TFile && file.extension === 'md') {
            try {
                const content = await this.app.vault.read(file);
                const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                if (frontmatterMatch) {
                    const yamlText = frontmatterMatch[1];
                    const urlMatch = yamlText.match(/gitlab_url:\s*["']?([^\r\n"']+)["']?/);
                    if (urlMatch) this.imageUrl = urlMatch[1].trim();

                    const origMatch = yamlText.match(/original_name:\s*["']?([^\r\n"']+)["']?/);
                    if (origMatch) this.originalName = origMatch[1].trim();

                    const webpMatch = yamlText.match(/webp_name:\s*["']?([^\r\n"']+)["']?/);
                    if (webpMatch) this.webpName = webpMatch[1].trim();

                    const origSizeMatch = yamlText.match(/original_size:\s*(\d+)/);
                    if (origSizeMatch) this.originalSize = parseInt(origSizeMatch[1], 10);

                    const compSizeMatch = yamlText.match(/compressed_size:\s*(\d+)/);
                    if (compSizeMatch) this.compressedSize = parseInt(compSizeMatch[1], 10);

                    const ratioMatch = yamlText.match(/compression_ratio:\s*(\d+)/);
                    if (ratioMatch) this.compressionRatio = parseInt(ratioMatch[1], 10);
                }

                if (!this.imageUrl) {
                    // 本文内の ![...](url) から探索
                    const imgMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/);
                    if (imgMatch) this.imageUrl = imgMatch[1];
                }
            } catch (e) {
                console.warn('Failed to parse metadata from markdown:', e);
            }
        }

        if (!this.webpName && this.source.name) {
            this.webpName = this.source.name.replace(/\.md$/, '');
        }
    }
}
