import { requestUrl, RequestUrlParam } from 'obsidian';
import {
    AINotebookSettings,
    MattermostTeam,
    MattermostChannel,
    MattermostPost,
    MattermostPostList,
    MattermostUser,
    MattermostChannelRef
} from '../types';
import { MattermostFormatter } from './MattermostFormatter';

export interface MattermostSearchableChannel {
    teamId: string;
    teamName: string;
    teamDisplayName: string;
    channelId: string;
    channelName: string;
    displayName: string;
    type: string;
    purpose?: string;
    header?: string;
    searchKey: string;
}

export interface FetchResult {
    markdown: string;
    postCount: number;
    latestPostId?: string;
    latestCreateAt?: number;
}

export class MattermostService {
    private settings: AINotebookSettings;
    private userCache = new Map<string, MattermostUser>();
    private channelsCache: MattermostSearchableChannel[] | null = null;
    private channelsCacheTime: number = 0;
    private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5分間キャッシュ

    constructor(settings: AINotebookSettings) {
        this.settings = settings;
    }

    updateSettings(newSettings: AINotebookSettings): void {
        const urlChanged = this.settings.mattermostUrl !== newSettings.mattermostUrl;
        const tokenChanged = this.settings.mattermostToken !== newSettings.mattermostToken;
        this.settings = newSettings;
        if (urlChanged || tokenChanged) {
            this.clearCache();
        }
    }

    clearCache(): void {
        this.channelsCache = null;
        this.channelsCacheTime = 0;
        this.userCache.clear();
    }

    isConfigured(): boolean {
        return !!(this.settings.mattermostUrl?.trim() && this.settings.mattermostToken?.trim());
    }

    private getBaseUrl(): string {
        return (this.settings.mattermostUrl || '').trim().replace(/\/+$/, '');
    }

    private getHeaders(): Record<string, string> {
        return {
            'Authorization': `Bearer ${this.settings.mattermostToken?.trim() || ''}`,
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        };
    }

    /**
     * API 疎通確認 (/api/v4/users/me)
     */
    async testConnection(): Promise<{ success: boolean; user?: MattermostUser; error?: string }> {
        if (!this.isConfigured()) {
            return { success: false, error: 'Mattermost の URL または PAT (トークン) が未設定です。' };
        }

        try {
            const url = `${this.getBaseUrl()}/api/v4/users/me`;
            const res = await requestUrl({
                url,
                method: 'GET',
                headers: this.getHeaders()
            });

            if (res.status === 200) {
                const user = res.json as MattermostUser;
                this.userCache.set(user.id, user);
                return { success: true, user };
            } else {
                return { success: false, error: `HTTP ${res.status}: ${res.text}` };
            }
        } catch (err: any) {
            return { success: false, error: err.message || String(err) };
        }
    }

    /**
     * ログインユーザーの参加チーム一覧取得
     */
    async getTeams(): Promise<MattermostTeam[]> {
        const url = `${this.getBaseUrl()}/api/v4/users/me/teams`;
        const res = await requestUrl({
            url,
            method: 'GET',
            headers: this.getHeaders()
        });

        if (res.status !== 200) {
            throw new Error(`チーム一覧の取得に失敗しました (HTTP ${res.status}): ${res.text}`);
        }
        return res.json as MattermostTeam[];
    }

    /**
     * 特定チームでユーザーが参加しているチャンネル一覧取得
     */
    async getChannelsForTeam(teamId: string): Promise<MattermostChannel[]> {
        const url = `${this.getBaseUrl()}/api/v4/users/me/teams/${teamId}/channels`;
        const res = await requestUrl({
            url,
            method: 'GET',
            headers: this.getHeaders()
        });

        if (res.status !== 200) {
            throw new Error(`チャンネル一覧の取得に失敗しました (HTTP ${res.status}): ${res.text}`);
        }
        return res.json as MattermostChannel[];
    }

    /**
     * 全チーム・全チャンネルを横断取得し、インクリメンタル検索可能なフラットリストを作成
     */
    async getAllSearchableChannels(forceRefresh: boolean = false): Promise<MattermostSearchableChannel[]> {
        const now = Date.now();
        if (!forceRefresh && this.channelsCache && (now - this.channelsCacheTime < this.CACHE_TTL_MS)) {
            return this.channelsCache;
        }

        const teams = await this.getTeams();
        const results: MattermostSearchableChannel[] = [];

        for (const team of teams) {
            try {
                const channels = await this.getChannelsForTeam(team.id);
                for (const ch of channels) {
                    // ダイレクトメッセージ(D)やグループ(G)は除外し、公開(O)・非公開(P)チャンネルを対象
                    if (ch.type === 'O' || ch.type === 'P') {
                        const searchKey = `${team.name} ${team.display_name} ${ch.name} ${ch.display_name} ${ch.purpose || ''} ${ch.header || ''}`.toLowerCase();
                        results.push({
                            teamId: team.id,
                            teamName: team.name,
                            teamDisplayName: team.display_name,
                            channelId: ch.id,
                            channelName: ch.name,
                            displayName: ch.display_name,
                            type: ch.type,
                            purpose: ch.purpose,
                            header: ch.header,
                            searchKey
                        });
                    }
                }
            } catch (e) {
                console.warn(`[MattermostService] Failed to load channels for team ${team.name}:`, e);
            }
        }

        // 名前順にソート
        results.sort((a, b) => a.teamDisplayName.localeCompare(b.teamDisplayName) || a.displayName.localeCompare(b.displayName));

        this.channelsCache = results;
        this.channelsCacheTime = now;
        return results;
    }

    /**
     * チャンネルの直近メッセージ取得 (since 指定で差分取得)
     */
    async getChannelPosts(channelId: string, perPage: number = 50, since?: number): Promise<MattermostPostList> {
        let url = `${this.getBaseUrl()}/api/v4/channels/${channelId}/posts?page=0&per_page=${perPage}`;
        if (since && since > 0) {
            url += `&since=${since}`;
        }

        const res = await requestUrl({
            url,
            method: 'GET',
            headers: this.getHeaders()
        });

        if (res.status !== 200) {
            throw new Error(`投稿の取得に失敗しました (HTTP ${res.status}): ${res.text}`);
        }
        return res.json as MattermostPostList;
    }

    /**
     * チーム内の投稿キーワード検索
     */
    async searchPosts(teamId: string, terms: string): Promise<MattermostPostList> {
        const url = `${this.getBaseUrl()}/api/v4/teams/${teamId}/posts/search`;
        const res = await requestUrl({
            url,
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({
                terms,
                is_or_search: false
            })
        });

        if (res.status !== 200) {
            throw new Error(`投稿検索に失敗しました (HTTP ${res.status}): ${res.text}`);
        }
        return res.json as MattermostPostList;
    }

    /**
     * ユーザーID配列からユーザー表示名情報を一括取得・キャッシュ
     */
    async getUsersByIds(userIds: string[]): Promise<Map<string, MattermostUser>> {
        const missingIds = userIds.filter(id => id && !this.userCache.has(id));
        if (missingIds.length > 0) {
            try {
                // 最大60件ずつ分割して取得
                const chunkSize = 60;
                for (let i = 0; i < missingIds.length; i += chunkSize) {
                    const chunk = missingIds.slice(i, i + chunkSize);
                    const url = `${this.getBaseUrl()}/api/v4/users/ids`;
                    const res = await requestUrl({
                        url,
                        method: 'POST',
                        headers: this.getHeaders(),
                        body: JSON.stringify(chunk)
                    });

                    if (res.status === 200) {
                        const users = res.json as MattermostUser[];
                        for (const u of users) {
                            this.userCache.set(u.id, u);
                        }
                    }
                }
            } catch (err) {
                console.warn('[MattermostService] Failed to batch fetch users:', err);
            }
        }
        return this.userCache;
    }

    /**
     * チャンネルの投稿を取得し、Markdown に変換して最新メタデータとともに返す
     */
    async fetchAndFormatPosts(
        channel: MattermostChannelRef,
        options: {
            perPage?: number;
            since?: number;
            isCatchUp?: boolean;
            searchQuery?: string;
        } = {}
    ): Promise<FetchResult> {
        let postList: MattermostPostList;

        if (options.searchQuery) {
            postList = await this.searchPosts(channel.teamId, options.searchQuery);
        } else {
            postList = await this.getChannelPosts(channel.channelId, options.perPage || 50, options.since);
        }

        const posts = postList.posts || {};
        const order = postList.order || [];

        if (order.length === 0) {
            return {
                markdown: '',
                postCount: 0
            };
        }

        // 全 user_id を収集
        const userIds = new Set<string>();
        let latestPostId: string | undefined;
        let latestCreateAt = 0;

        for (const id of order) {
            const post = posts[id];
            if (post) {
                if (post.user_id) userIds.add(post.user_id);
                if (post.create_at > latestCreateAt) {
                    latestCreateAt = post.create_at;
                    latestPostId = post.id;
                }
            }
        }

        // ユーザー情報をキャッシュ解決
        const userMap = await this.getUsersByIds(Array.from(userIds));

        // Markdown 整形
        const markdown = MattermostFormatter.formatPosts(channel, postList, userMap, {
            baseUrl: this.getBaseUrl(),
            isCatchUp: options.isCatchUp,
            searchQuery: options.searchQuery
        });

        return {
            markdown,
            postCount: order.length,
            latestPostId,
            latestCreateAt
        };
    }
}
