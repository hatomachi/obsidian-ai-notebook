import { AINotebookSettings, GitLabServerConfig, GitLabUploadResult } from '../types';

/**
 * GitLab Base URL を正規化 (例: "https://gitlab.example.com" -> "https://gitlab.example.com/api/v4")
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

/**
 * プロジェクトIDまたはURLエンコードされたプロジェクトパスを返却
 */
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

/**
 * GitLab のホストベースルートURLを取得 (例: "https://gitlab.example.com/api/v4" -> "https://gitlab.example.com")
 */
export function getGitLabHostUrl(rawUrl: string): string {
    let url = (rawUrl || '').trim().replace(/\/+$/, '');
    if (url.endsWith('/api/v4')) {
        url = url.substring(0, url.length - '/api/v4'.length);
    }
    return url.replace(/\/+$/, '');
}

export class GitLabService {
    private settings: AINotebookSettings;

    constructor(settings: AINotebookSettings) {
        this.settings = settings;
    }

    updateSettings(newSettings: AINotebookSettings): void {
        this.settings = newSettings;
    }

    /**
     * 登録済みの全 GitLab サーバーを取得
     */
    getServers(): GitLabServerConfig[] {
        return this.settings.gitlabServers || [];
    }

    /**
     * サーバーIDから設定を取得（未指定時はデフォルトサーバー、または先頭サーバー）
     */
    getServer(serverId?: string): GitLabServerConfig | undefined {
        const servers = this.getServers();
        if (servers.length === 0) return undefined;

        if (serverId) {
            const found = servers.find(s => s.id === serverId);
            if (found) return found;
        }

        if (this.settings.defaultGitLabServerId) {
            const def = servers.find(s => s.id === this.settings.defaultGitLabServerId);
            if (def) return def;
        }

        return servers[0];
    }

    /**
     * 指定サーバー（またはデフォルト）が利用可能に設定されているか
     */
    isConfigured(serverId?: string): boolean {
        const server = this.getServer(serverId);
        return !!(server && server.baseUrl?.trim() && server.token?.trim());
    }

    /**
     * バイナリオフロード機能が有効化されており、かつ有効なサーバーが存在するか
     */
    isUploadsEnabled(serverId?: string): boolean {
        const enabled = this.settings.gitlabUploadsEnabled ?? true;
        if (!enabled) return false;
        const server = this.getServer(serverId);
        if (!server || !this.isConfigured(server.id)) return false;
        return true;
    }

    /**
     * サーバーへの接続確認テスト (トークン確認 & オプションでプロジェクト確認)
     */
    async testConnection(
        server: GitLabServerConfig,
        projectId?: string
    ): Promise<{ success: boolean; message: string; user?: any; project?: any }> {
        const baseUrl = normalizeGitLabBaseUrl(server.baseUrl);
        const token = (server.token || '').trim();

        if (!baseUrl || !token) {
            return { success: false, message: 'GitLab ホストURLとアクセストークンを入力してください。' };
        }

        try {
            // 1. ユーザー情報確認
            const userRes = await fetch(`${baseUrl}/user`, {
                method: 'GET',
                headers: {
                    'PRIVATE-TOKEN': token,
                    Accept: 'application/json',
                },
            });

            if (!userRes.ok) {
                if (userRes.status === 401) {
                    return { success: false, message: `認証失敗 (401 Unauthorized): トークンが無効または期限切れです。` };
                }
                return { success: false, message: `接続失敗 (HTTP ${userRes.status}): ${userRes.statusText}` };
            }

            const userData = await userRes.json();
            const userName = userData.name ? `${userData.name} (@${userData.username})` : userData.username;

            // 2. プロジェクト確認（指定されている場合）
            const targetProjectId = projectId || server.defaultProjectId;
            let projectData: any = undefined;
            if (targetProjectId?.trim()) {
                const encodedPid = encodeProjectId(targetProjectId);
                const projRes = await fetch(`${baseUrl}/projects/${encodedPid}`, {
                    method: 'GET',
                    headers: {
                        'PRIVATE-TOKEN': token,
                        Accept: 'application/json',
                    },
                });

                if (projRes.ok) {
                    projectData = await projRes.json();
                } else {
                    return {
                        success: false,
                        user: userData,
                        message: `⚠️ 認証成功 (@${userData.username}) ですが、プロジェクト "${targetProjectId}" が見つかりません (HTTP ${projRes.status})。プロジェクトIDまたは権限を確認してください。`
                    };
                }
            }

            const projInfo = projectData ? ` / プロジェクト: ${projectData.name_with_namespace || projectData.name}` : '';
            return {
                success: true,
                user: userData,
                project: projectData,
                message: `✅ 接続成功: ユーザー ${userName}${projInfo}`
            };
        } catch (err: any) {
            return {
                success: false,
                message: `通信エラー: ${err?.message || String(err)}`
            };
        }
    }

    /**
     * GitLab Projects Uploads API を使用したバイナリファイルのアップロード
     * POST /projects/:id/uploads
     */
    async uploadFile(
        data: ArrayBuffer | Buffer,
        fileName: string,
        options?: { serverId?: string; projectId?: string }
    ): Promise<GitLabUploadResult> {
        const server = this.getServer(options?.serverId);
        if (!server || !this.isConfigured(server.id)) {
            return {
                success: false,
                fileName,
                error: 'GitLab サーバーが設定されていないか、トークンが未入力です。'
            };
        }

        const projectId = options?.projectId || server.defaultProjectId;
        if (!projectId?.trim()) {
            return {
                success: false,
                fileName,
                serverId: server.id,
                serverName: server.name,
                error: `GitLab プロジェクトIDが指定されていません（サーバー設定「${server.name}」のデフォルトプロジェクトまたはノートブック設定を確認してください）。`
            };
        }

        const baseUrl = normalizeGitLabBaseUrl(server.baseUrl);
        const hostUrl = getGitLabHostUrl(server.baseUrl);
        const encodedPid = encodeProjectId(projectId);
        const uploadEndpoint = `${baseUrl}/projects/${encodedPid}/uploads`;

        try {
            // Buffer または ArrayBuffer を Uint8Array 経由で Blob に変換
            const uint8Array = Buffer.isBuffer(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : new Uint8Array(data);
            const blob = new Blob([uint8Array as any]);

            const formData = new FormData();
            formData.append('file', blob, fileName);

            const res = await fetch(uploadEndpoint, {
                method: 'POST',
                headers: {
                    'PRIVATE-TOKEN': server.token.trim(),
                    // Content-Type は FormData によって boundary 付きで自動付与される
                },
                body: formData
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                return {
                    success: false,
                    fileName,
                    fileSize: blob.size,
                    serverId: server.id,
                    serverName: server.name,
                    projectId,
                    error: `GitLab Uploads API エラー (HTTP ${res.status}): ${errText || res.statusText}`
                };
            }

            const json = await res.json();
            const relUrl = json.url || '';
            const fullPath = json.full_path || '';
            const markdown = json.markdown || '';

            // 完全なアクセス URL の構築
            let absoluteUrl = '';
            if (fullPath) {
                absoluteUrl = `${hostUrl}${fullPath.startsWith('/') ? fullPath : '/' + fullPath}`;
            } else if (relUrl) {
                absoluteUrl = `${hostUrl}${relUrl.startsWith('/') ? relUrl : '/' + relUrl}`;
            }

            return {
                success: true,
                url: relUrl,
                fullPath,
                markdown,
                absoluteUrl,
                fileName,
                fileSize: blob.size,
                serverId: server.id,
                serverName: server.name,
                projectId
            };
        } catch (err: any) {
            return {
                success: false,
                fileName,
                fileSize: Buffer.isBuffer(data) ? data.length : data.byteLength,
                serverId: server.id,
                serverName: server.name,
                projectId,
                error: `GitLab アップロード通信例外: ${err?.message || String(err)}`
            };
        }
    }

    /**
     * GitLab からファイルをオンデマンドダウンロード（再パースや原本ダウンロード用）
     */
    async downloadFile(urlOrPath: string, serverId?: string): Promise<ArrayBuffer> {
        const server = this.getServer(serverId);
        let targetUrl = urlOrPath.trim();

        if (server && !targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            const hostUrl = getGitLabHostUrl(server.baseUrl);
            targetUrl = `${hostUrl}${targetUrl.startsWith('/') ? targetUrl : '/' + targetUrl}`;
        }

        const headers: Record<string, string> = {};
        if (server?.token) {
            headers['PRIVATE-TOKEN'] = server.token.trim();
        }

        const res = await fetch(targetUrl, {
            method: 'GET',
            headers
        });

        if (!res.ok) {
            throw new Error(`GitLab ファイルダウンロード失敗 (HTTP ${res.status}): ${res.statusText}`);
        }

        return await res.arrayBuffer();
    }
}
