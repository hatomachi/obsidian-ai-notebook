import { requestUrl } from 'obsidian';
import {
    AINotebookSettings,
    ConfluenceServerConfig,
    ConfluenceSearchResult,
    ConfluencePageSummary,
    ConfluencePageDetail,
    SourceOrigin,
    AddSourceResult
} from '../types';
import { confluenceHtmlToMarkdown } from './confluence/ConfluenceHtmlToMarkdown';

/**
 * Confluence Base URL を正規化 (末尾スラッシュを削除)
 */
export function normalizeConfluenceBaseUrl(rawUrl: string): string {
    let url = (rawUrl || '').trim();
    if (!url) return '';
    return url.replace(/\/+$/, '');
}

/**
 * タイトルからファイル名用の安全なスラッグを生成
 */
export function slugifyTitle(title: string): string {
    return (title || '')
        .replace(/[\/\\:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .trim()
        .slice(0, 50);
}

export class ConfluenceService {
    private settings: AINotebookSettings;

    constructor(settings: AINotebookSettings) {
        this.settings = settings;
    }

    /**
     * 登録済みの全 Confluence サーバーを取得
     */
    getServers(): ConfluenceServerConfig[] {
        return this.settings.confluenceServers || [];
    }

    /**
     * サーバーIDから設定を取得（未指定時はデフォルトサーバー、または先頭サーバー）
     */
    getServer(serverId?: string): ConfluenceServerConfig | undefined {
        const servers = this.getServers();
        if (servers.length === 0) return undefined;

        if (serverId) {
            const found = servers.find(s => s.id === serverId);
            if (found) return found;
        }

        if (this.settings.defaultConfluenceServerId) {
            const def = servers.find(s => s.id === this.settings.defaultConfluenceServerId);
            if (def) return def;
        }

        return servers[0];
    }

    /**
     * 指定サーバーが利用可能に設定されているか
     */
    isConfigured(serverId?: string): boolean {
        const server = this.getServer(serverId);
        return !!(server && server.baseUrl?.trim() && server.token?.trim());
    }

    /**
     * 認証ヘッダーを構築
     */
    private buildAuthHeaders(server: ConfluenceServerConfig): Record<string, string> {
        const headers: Record<string, string> = {
            Accept: 'application/json'
        };

        const token = (server.token || '').trim();
        if (!token) return headers;

        if (server.authType === 'basic') {
            const username = (server.username || '').trim();
            const credentials = Buffer.from(`${username}:${token}`).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
        } else {
            // Bearer (Personal Access Token)
            headers['Authorization'] = `Bearer ${token}`;
        }

        return headers;
    }

    /**
     * サーバーへの接続確認テスト
     */
    async testConnection(server: ConfluenceServerConfig): Promise<{ success: boolean; message: string }> {
        const baseUrl = normalizeConfluenceBaseUrl(server.baseUrl);
        const token = (server.token || '').trim();

        if (!baseUrl) {
            return { success: false, message: 'Confluence ホストURLを入力してください。' };
        }
        if (!token) {
            return { success: false, message: 'アクセストークンまたはAPIトークンを入力してください。' };
        }

        try {
            // /rest/api/space または /wiki/rest/api/space を叩く
            const headers = this.buildAuthHeaders(server);
            let testUrl = `${baseUrl}/rest/api/space`;
            let res = await requestUrl({
                url: testUrl,
                method: 'GET',
                headers,
                throw: false
            });

            // 404 の場合、Atlassian Cloud 形式 (/wiki/rest/api/space) を試行
            if (res.status === 404 && !baseUrl.includes('/wiki')) {
                testUrl = `${baseUrl}/wiki/rest/api/space`;
                res = await requestUrl({
                    url: testUrl,
                    method: 'GET',
                    headers,
                    throw: false
                });
            }

            if (res.status >= 400) {
                if (res.status === 401) {
                    return { success: false, message: '認証失敗 (401 Unauthorized): トークンまたは認証情報が無効です。' };
                }
                if (res.status === 403) {
                    return { success: false, message: 'アクセス拒否 (403 Forbidden): 権限が不足しています。' };
                }
                return { success: false, message: `接続失敗 (HTTP ${res.status})` };
            }

            const spacesCount = res.json?.results?.length ?? 0;
            return {
                success: true,
                message: `✅ 接続成功 (参照可能スペース: ${spacesCount} 件)`
            };
        } catch (err: any) {
            return {
                success: false,
                message: `通信エラー: ${err?.message || String(err)}`
            };
        }
    }

    /**
     * CQL 検索を実行
     */
    async search(
        cql: string,
        options: { serverId?: string; limit?: number; start?: number } = {}
    ): Promise<ConfluenceSearchResult> {
        const server = this.getServer(options.serverId);
        if (!server) {
            throw new Error('Confluence サーバーが設定されていません。設定画面でサーバーを登録してください。');
        }

        const baseUrl = normalizeConfluenceBaseUrl(server.baseUrl);
        const headers = this.buildAuthHeaders(server);
        const limit = options.limit ?? 25;
        const start = options.start ?? 0;

        const queryParams = new URLSearchParams({
            cql: cql.trim(),
            limit: String(limit),
            start: String(start),
            expand: 'ancestors,space,version'
        });

        let searchUrl = `${baseUrl}/rest/api/content/search?${queryParams.toString()}`;
        let res = await requestUrl({
            url: searchUrl,
            method: 'GET',
            headers,
            throw: false
        });

        if (res.status === 404 && !baseUrl.includes('/wiki')) {
            searchUrl = `${baseUrl}/wiki/rest/api/content/search?${queryParams.toString()}`;
            res = await requestUrl({
                url: searchUrl,
                method: 'GET',
                headers,
                throw: false
            });
        }

        if (res.status >= 400) {
            throw new Error(`Confluence 検索エラー (HTTP ${res.status}): ${res.text || 'Unknown error'}`);
        }

        const data = res.json;
        const results: ConfluencePageSummary[] = (data.results || []).map((item: any) => {
            const webuiPath = item._links?.webui || '';
            const webuiUrl = webuiPath.startsWith('http')
                ? webuiPath
                : `${baseUrl}${webuiPath.startsWith('/') ? '' : '/'}${webuiPath}`;

            return {
                id: item.id,
                title: item.title,
                type: item.type || 'page',
                status: item.status || 'current',
                space: item.space ? {
                    id: item.space.id,
                    key: item.space.key,
                    name: item.space.name
                } : undefined,
                ancestors: (item.ancestors || []).map((a: any) => ({
                    id: a.id,
                    title: a.title
                })),
                version: item.version ? {
                    number: item.version.number,
                    when: item.version.when,
                    message: item.version.message,
                    by: item.version.by ? {
                        displayName: item.version.by.displayName,
                        username: item.version.by.username
                    } : undefined
                } : undefined,
                webuiUrl,
                url: item._links?.self
            };
        });

        return {
            results,
            start: data.start ?? start,
            limit: data.limit ?? limit,
            size: data.size ?? results.length,
            totalSize: data.totalSize ?? results.length
        };
    }

    /**
     * ページ詳細（本文 Storage XML / View HTML）を取得
     */
    async getPage(
        pageId: string,
        options: { serverId?: string; expand?: string } = {}
    ): Promise<ConfluencePageDetail> {
        const server = this.getServer(options.serverId);
        if (!server) {
            throw new Error('Confluence サーバーが設定されていません。');
        }

        const baseUrl = normalizeConfluenceBaseUrl(server.baseUrl);
        const headers = this.buildAuthHeaders(server);
        const expand = options.expand || 'body.storage,body.view,ancestors,space,version';

        let pageUrl = `${baseUrl}/rest/api/content/${pageId}?expand=${expand}`;
        let res = await requestUrl({
            url: pageUrl,
            method: 'GET',
            headers,
            throw: false
        });

        if (res.status === 404 && !baseUrl.includes('/wiki')) {
            pageUrl = `${baseUrl}/wiki/rest/api/content/${pageId}?expand=${expand}`;
            res = await requestUrl({
                url: pageUrl,
                method: 'GET',
                headers,
                throw: false
            });
        }

        if (res.status >= 400) {
            throw new Error(`Confluence ページ取得エラー (ID: ${pageId}, HTTP ${res.status}): ${res.text || 'Unknown error'}`);
        }

        const item = res.json;
        const webuiPath = item._links?.webui || '';
        const webuiUrl = webuiPath.startsWith('http')
            ? webuiPath
            : `${baseUrl}${webuiPath.startsWith('/') ? '' : '/'}${webuiPath}`;

        const bodyStorage = item.body?.storage?.value || '';
        const bodyView = item.body?.view?.value || '';
        const rawContent = bodyStorage || bodyView || '';
        const markdown = confluenceHtmlToMarkdown(rawContent);

        return {
            id: item.id,
            title: item.title,
            type: item.type || 'page',
            status: item.status || 'current',
            space: item.space ? {
                id: item.space.id,
                key: item.space.key,
                name: item.space.name
            } : undefined,
            ancestors: (item.ancestors || []).map((a: any) => ({
                id: a.id,
                title: a.title
            })),
            version: item.version ? {
                number: item.version.number,
                when: item.version.when,
                message: item.version.message,
                by: item.version.by ? {
                    displayName: item.version.by.displayName,
                    username: item.version.by.username
                } : undefined
            } : undefined,
            webuiUrl,
            url: item._links?.self,
            bodyStorage,
            bodyView,
            markdown
        };
    }

    /**
     * Storage / View HTML を Markdown に変換
     */
    htmlToMarkdown(html: string): string {
        return confluenceHtmlToMarkdown(html);
    }

    /**
     * Confluence ページを取得してノートブックの sources/ にインポート
     */
    async importPageToNotebook(
        notebookId: string,
        pageId: string,
        notebookManager: any,
        options: { serverId?: string } = {}
    ): Promise<AddSourceResult> {
        const server = this.getServer(options.serverId);
        if (!server) {
            throw new Error('Confluence サーバーが設定されていません。');
        }

        // 1. ページ詳細を取得
        const page = await this.getPage(pageId, { serverId: server.id });

        // 2. Markdown 本文および Frontmatter を構成
        const slug = slugifyTitle(page.title);
        const fileName = `confluence_${page.id}_${slug}.md`;

        const ancestorTitles = (page.ancestors || []).map(a => a.title);
        const relativeFolder = ancestorTitles.length > 0 ? ancestorTitles.join('/') : (page.space?.key || '');

        const frontmatterLines = [
            '---',
            'origin: confluence',
            `page_id: "${page.id}"`,
            `title: "${page.title.replace(/"/g, '\\"')}"`,
            page.space ? `space_key: "${page.space.key}"` : null,
            page.space ? `space_name: "${page.space.name.replace(/"/g, '\\"')}"` : null,
            ancestorTitles.length > 0 ? `ancestors: ${JSON.stringify(ancestorTitles)}` : null,
            `remote_url: "${page.webuiUrl || ''}"`,
            page.version ? `version: ${page.version.number}` : null,
            `synced_at: "${new Date().toISOString()}"`,
            '---',
            '',
            `# ${page.title}`,
            '',
            page.markdown || '(本文なし)'
        ].filter(l => l !== null).join('\n');

        // 3. SourceOrigin オブジェクト
        const origin: SourceOrigin = {
            connectorId: 'confluence',
            remoteId: page.id,
            remoteUrl: page.webuiUrl || `${server.baseUrl}/pages/viewpage.action?pageId=${page.id}`,
            relativeFolder: relativeFolder || undefined,
            remoteVersion: page.version ? `v${page.version.number}` : undefined,
            lastSyncedAt: new Date().toISOString()
        };

        // 4. NotebookManager の addSourceFile で sources/ に配置
        return await notebookManager.addSourceFile(notebookId, fileName, frontmatterLines, origin);
    }
}
