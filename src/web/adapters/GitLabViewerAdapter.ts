import { NotebookMetadata, ChatSession, ChatMessage } from '../../types';
import { parseFrontmatter } from '../utils/frontmatter';

export interface GitLabConfig {
    baseUrl: string;
    projectId: string;
    branch: string;
    token: string;
    rootDir?: string;
}

export interface ViewerArtifact {
    name: string;
    path: string;
    size?: number;
    updatedAt?: string;
}

export interface ViewerSource {
    name: string;
    path: string;
    size?: number;
    extension: string;
}

export interface NotebookDetailData {
    metadata: NotebookMetadata;
    memo: string;
    artifacts: ViewerArtifact[];
    sources: ViewerSource[];
    sessions: ChatSession[];
    activeSessionId?: string;
}

export interface IViewerAdapter {
    getNotebooks(): Promise<NotebookMetadata[]>;
    getNotebookDetail(notebookId: string): Promise<NotebookDetailData>;
    getFileContent(path: string): Promise<string>;
    testConnection(): Promise<{ success: boolean; message: string; projectName?: string }>;
}

interface FileCacheEntry {
    sha: string;
    content: string;
}

/**
 * Normalize GitLab Base URL to support:
 * 1. Root URL: "https://gitlab.example.com" -> "https://gitlab.example.com/api/v4"
 * 2. API URL: "https://gitlab.example.com/api/v4"
 * 3. Reverse Proxy / ALB: "https://alb-domain/ainotebook/api"
 * 4. Relative Path: "/ainotebook/api"
 */
export function normalizeGitLabBaseUrl(rawUrl: string): string {
    let url = (rawUrl || '').trim();
    if (!url) return '';
    url = url.replace(/\/+$/, '');

    if (url.endsWith('/api/v4')) {
        return url;
    }

    if (url.startsWith('/')) {
        return url;
    }

    try {
        const parsed = new URL(url);
        if (parsed.pathname === '' || parsed.pathname === '/') {
            return `${url}/api/v4`;
        }
        if (!parsed.pathname.includes('/api')) {
            return `${url}/api/v4`;
        }
    } catch {
        if (!url.includes('/api')) {
            return `${url}/api/v4`;
        }
    }

    return url;
}

export function encodeProjectId(projectId: string): string {
    const trimmed = (projectId || '').trim();
    if (/^\d+$/.test(trimmed)) {
        return trimmed;
    }
    try {
        return encodeURIComponent(decodeURIComponent(trimmed));
    } catch {
        return encodeURIComponent(trimmed);
    }
}

export function encodeFilePath(filePath: string): string {
    return encodeURIComponent(filePath.replace(/^\/+/, ''));
}

export async function testGitLabConnection(
    config: GitLabConfig
): Promise<{ success: boolean; message: string; projectName?: string }> {
    const baseUrl = normalizeGitLabBaseUrl(config.baseUrl);
    const encodedId = encodeProjectId(config.projectId);
    const token = (config.token || '').trim();

    if (!baseUrl || !encodedId || !token) {
        return { success: false, message: 'GitLab URL、Project ID、Token をすべて入力してください。' };
    }

    try {
        const url = `${baseUrl}/projects/${encodedId}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'PRIVATE-TOKEN': token,
                Accept: 'application/json',
            },
        });

        if (res.ok) {
            const data = await res.json();
            const projName = data.name_with_namespace || data.name || data.path_with_namespace || config.projectId;
            const visibility = data.visibility ? ` (${data.visibility})` : '';
            return {
                success: true,
                message: `接続成功: ${projName}${visibility}`,
                projectName: projName,
            };
        }

        if (res.status === 401 || res.status === 403) {
            return { success: false, message: `認証エラー (${res.status}): Personal Access Token の権限 (read_api または read_repository) を確認してください。` };
        }
        if (res.status === 404) {
            return { success: false, message: `プロジェクトが見つかりません (404): URL または Project ID (${config.projectId}) を確認してください。` };
        }

        return { success: false, message: `接続失敗: HTTP ${res.status} ${res.statusText}` };
    } catch (e: any) {
        return { success: false, message: `ネットワーク通信エラー: ${e.message || '接続できませんでした'}` };
    }
}

export class GitLabViewerAdapter implements IViewerAdapter {
    private config: GitLabConfig;
    private baseUrl: string;
    private encodedProjectId: string;
    private rootDir: string;
    private fileShaCache = new Map<string, string>();
    private memoryCache: Record<string, FileCacheEntry> = {};

    constructor(config: GitLabConfig) {
        this.config = {
            ...config,
            branch: config.branch?.trim() || 'main',
            rootDir: config.rootDir?.trim() || '_ainotebook',
        };
        this.rootDir = this.config.rootDir!;
        this.baseUrl = normalizeGitLabBaseUrl(this.config.baseUrl);
        this.encodedProjectId = encodeProjectId(this.config.projectId);
        this.memoryCache = this.loadCache();
    }

    private getCacheKey(): string {
        return `ainotebook_file_cache_gitlab_${this.config.projectId}_${this.config.branch}`;
    }

    private loadCache(): Record<string, FileCacheEntry> {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const raw = localStorage.getItem(this.getCacheKey());
                if (raw) return JSON.parse(raw);
            }
        } catch (e) {
            console.warn('Failed to load GitLab cache:', e);
        }
        return {};
    }

    private saveCache(): void {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                localStorage.setItem(this.getCacheKey(), JSON.stringify(this.memoryCache));
            }
        } catch (e) {
            console.warn('Failed to save GitLab cache:', e);
        }
    }

    private async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
        const headers = new Headers(options.headers || {});
        headers.set('PRIVATE-TOKEN', this.config.token.trim());
        return fetch(url, {
            ...options,
            headers,
        });
    }

    async testConnection(): Promise<{ success: boolean; message: string; projectName?: string }> {
        return testGitLabConnection(this.config);
    }

    /**
     * Fetch tree from GitLab recursively under rootDir
     */
    private async fetchTree(): Promise<{ path: string; sha: string; size?: number }[]> {
        const allBlobs: { path: string; sha: string; size?: number }[] = [];
        let page = 1;

        while (true) {
            const treeUrl = `${this.baseUrl}/projects/${this.encodedProjectId}/repository/tree?path=${encodeURIComponent(
                this.rootDir
            )}&ref=${encodeURIComponent(this.config.branch)}&recursive=true&per_page=100&page=${page}`;

            const res = await this.fetchWithAuth(treeUrl);
            if (!res.ok) {
                if (res.status === 404) break;
                throw new Error(`GitLab tree API error: ${res.status} ${res.statusText}`);
            }

            const items = await res.json();
            if (!Array.isArray(items) || items.length === 0) break;

            for (const item of items) {
                if (item.type === 'blob' && item.path) {
                    allBlobs.push({
                        path: item.path,
                        sha: item.id || '',
                    });
                    if (item.id) {
                        this.fileShaCache.set(item.path, item.id);
                    }
                }
            }

            const nextPageHeader = res.headers.get('x-next-page');
            if (nextPageHeader && nextPageHeader !== '' && nextPageHeader !== `${page}`) {
                page = parseInt(nextPageHeader, 10);
            } else {
                break;
            }
        }

        return allBlobs;
    }

    async getFileContent(filePath: string): Promise<string> {
        const currentSha = this.fileShaCache.get(filePath);
        if (currentSha && this.memoryCache[filePath] && this.memoryCache[filePath].sha === currentSha) {
            return this.memoryCache[filePath].content;
        }

        const rawUrl = `${this.baseUrl}/projects/${this.encodedProjectId}/repository/files/${encodeFilePath(
            filePath
        )}/raw?ref=${encodeURIComponent(this.config.branch)}`;

        const res = await this.fetchWithAuth(rawUrl);
        if (!res.ok) {
            throw new Error(`Failed to fetch file ${filePath}: ${res.status} ${res.statusText}`);
        }

        const content = await res.text();
        const blobSha = res.headers.get('x-gitlab-blob-id') || currentSha || '';
        this.memoryCache[filePath] = { sha: blobSha, content };
        this.saveCache();
        return content;
    }

    async getNotebooks(): Promise<NotebookMetadata[]> {
        const tree = await this.fetchTree();
        const indexPrefix = `${this.rootDir}/index/`;
        const indexFiles = tree.filter((t) => t.path.startsWith(indexPrefix) && t.path.endsWith('.md'));

        const notebooks: NotebookMetadata[] = [];

        await Promise.all(
            indexFiles.map(async (f) => {
                try {
                    const content = await this.getFileContent(f.path);
                    const parsed = parseFrontmatter<any>(content);
                    const data = parsed.data;

                    const id = data.notebook_id || f.path.slice(indexPrefix.length, -3);
                    const title = data.title || id;
                    const createdAt = data.created_at || '';
                    const updatedAt = data.updated_at || createdAt;
                    const tags = Array.isArray(data.tags) ? data.tags : [];
                    const icon = data.icon || 'book-open';
                    const description = data.description || '';
                    const linkedNotebookIds = Array.isArray(data.linked_notebook_ids) ? data.linked_notebook_ids : [];
                    const activeSessionId = data.active_session_id || undefined;

                    notebooks.push({
                        id,
                        title,
                        createdAt,
                        updatedAt,
                        tags,
                        icon,
                        description,
                        linkedNotebookIds,
                        activeSessionId,
                    });
                } catch (e) {
                    console.warn(`Failed to parse notebook index file ${f.path}:`, e);
                }
            })
        );

        // Sort by updatedAt descending
        notebooks.sort((a, b) => {
            const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
            const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
            return timeB - timeA;
        });

        return notebooks;
    }

    async getNotebookDetail(notebookId: string): Promise<NotebookDetailData> {
        const tree = await this.fetchTree();
        const indexPath = `${this.rootDir}/index/${notebookId}.md`;
        let metadata: NotebookMetadata;
        let memo = '';

        try {
            const indexContent = await this.getFileContent(indexPath);
            const parsed = parseFrontmatter<any>(indexContent);
            metadata = {
                id: parsed.data.notebook_id || notebookId,
                title: parsed.data.title || notebookId,
                createdAt: parsed.data.created_at || '',
                updatedAt: parsed.data.updated_at || '',
                tags: Array.isArray(parsed.data.tags) ? parsed.data.tags : [],
                icon: parsed.data.icon || 'book-open',
                description: parsed.data.description || '',
                linkedNotebookIds: parsed.data.linked_notebook_ids || [],
                activeSessionId: parsed.data.active_session_id || undefined,
            };
            memo = parsed.content;
        } catch {
            metadata = {
                id: notebookId,
                title: notebookId,
                createdAt: '',
                updatedAt: '',
                tags: [],
                icon: 'book-open',
                description: '',
            };
        }

        const nbPrefix = `${this.rootDir}/notebooks/${notebookId}/`;
        const artifactsPrefix = `${nbPrefix}artifacts/`;
        const sourcesPrefix = `${nbPrefix}sources/`;
        const sessionsPrefix = `${nbPrefix}sessions/`;

        const artifacts: ViewerArtifact[] = [];
        const sources: ViewerSource[] = [];
        const sessions: ChatSession[] = [];

        // 1. Artifacts
        const artifactFiles = tree.filter((t) => t.path.startsWith(artifactsPrefix));
        for (const f of artifactFiles) {
            const name = f.path.slice(artifactsPrefix.length);
            if (name && !name.includes('/')) {
                artifacts.push({
                    name,
                    path: f.path,
                    size: f.size,
                });
            }
        }

        // 2. Sources
        const sourceFiles = tree.filter((t) => t.path.startsWith(sourcesPrefix));
        for (const f of sourceFiles) {
            const name = f.path.slice(sourcesPrefix.length);
            if (name && !name.includes('/')) {
                const ext = name.split('.').pop() || '';
                sources.push({
                    name,
                    path: f.path,
                    size: f.size,
                    extension: ext,
                });
            }
        }

        // 3. Sessions
        const sessionFiles = tree.filter((t) => t.path.startsWith(sessionsPrefix) && t.path.endsWith('.json'));
        if (sessionFiles.length > 0) {
            await Promise.all(
                sessionFiles.map(async (f) => {
                    try {
                        const raw = await this.getFileContent(f.path);
                        const parsed = JSON.parse(raw);
                        if (parsed && parsed.id) {
                            sessions.push(parsed);
                        }
                    } catch (e) {
                        console.warn(`Failed to parse session file ${f.path}:`, e);
                    }
                })
            );
        } else {
            // Check legacy chat.json
            const chatJsonPath = `${nbPrefix}chat.json`;
            const hasChatJson = tree.some((t) => t.path === chatJsonPath);
            if (hasChatJson) {
                try {
                    const raw = await this.getFileContent(chatJsonPath);
                    const messages: ChatMessage[] = JSON.parse(raw);
                    if (Array.isArray(messages)) {
                        sessions.push({
                            id: 'default',
                            title: 'メインチャット',
                            createdAt: metadata.createdAt,
                            updatedAt: metadata.updatedAt,
                            messages,
                        });
                    }
                } catch (e) {
                    console.warn(`Failed to parse chat.json:`, e);
                }
            }
        }

        // Sort sessions by updatedAt descending
        sessions.sort((a, b) => {
            const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
            const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
            return timeB - timeA;
        });

        return {
            metadata,
            memo,
            artifacts,
            sources,
            sessions,
            activeSessionId: metadata.activeSessionId || (sessions.length > 0 ? sessions[0].id : undefined),
        };
    }
}
