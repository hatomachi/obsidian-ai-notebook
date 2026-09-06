import { MattermostPost, MattermostPostList, MattermostUser, MattermostChannelRef } from '../types';

export interface FormatOptions {
    baseUrl?: string;
    isCatchUp?: boolean;
    searchQuery?: string;
}

export class MattermostFormatter {
    /**
     * タイムスタンプを YYYY-MM-DD HH:mm:ss 形式に変換
     */
    static formatDateTime(epochMs: number): string {
        const d = new Date(epochMs);
        const pad = (n: number) => String(n).padStart(2, '0');
        const year = d.getFullYear();
        const month = pad(d.getMonth() + 1);
        const day = pad(d.getDate());
        const hours = pad(d.getHours());
        const minutes = pad(d.getMinutes());
        const seconds = pad(d.getSeconds());
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    /**
     * ユーザー表示名を整形 (@username (氏名))
     */
    static formatUserName(user?: MattermostUser): string {
        if (!user) return '@unknown';
        const fullName = [user.last_name, user.first_name].filter(Boolean).join(' ');
        if (fullName) {
            return `@${user.username} (${fullName})`;
        }
        if (user.nickname) {
            return `@${user.username} (${user.nickname})`;
        }
        return `@${user.username}`;
    }

    /**
     * Permalink URL を生成
     */
    static getPermalink(baseUrl: string | undefined, teamName: string, postId: string): string {
        if (!baseUrl) return '';
        const cleanBase = baseUrl.replace(/\/+$/, '');
        return `${cleanBase}/${teamName}/pl/${postId}`;
    }

    /**
     * 投稿リストをスレッド構造付きのMarkdown文字列に変換
     */
    static formatPosts(
        channel: MattermostChannelRef,
        postList: MattermostPostList,
        userMap: Map<string, MattermostUser>,
        options: FormatOptions = {}
    ): string {
        const posts = postList.posts || {};
        const order = postList.order || [];

        if (order.length === 0) {
            return options.isCatchUp ? '' : `(取得された投稿はありません)\n`;
        }

        // 投稿を時系列昇順に並べ替え（API は降順で返す場合がある）
        const allPosts: MattermostPost[] = order
            .map(id => posts[id])
            .filter((p): p is MattermostPost => !!p && !p.delete_at);

        allPosts.sort((a, b) => a.create_at - b.create_at);

        // スレッドごとにグルーピング (root_id -> replies)
        // ルート投稿は root_id が空
        const rootPosts: MattermostPost[] = [];
        const threadReplies = new Map<string, MattermostPost[]>();

        for (const post of allPosts) {
            if (post.root_id) {
                const replies = threadReplies.get(post.root_id) || [];
                replies.push(post);
                threadReplies.set(post.root_id, replies);
            } else {
                rootPosts.push(post);
            }
        }

        // もし rootPost が order に含まれず返信だけが来た場合（検索結果や差分取得など）、孤立した返信もルートとして扱う
        for (const [rootId, replies] of threadReplies.entries()) {
            if (!rootPosts.some(r => r.id === rootId)) {
                // 親がリスト内にない場合、親が存在すれば追加するか、返信の先頭を擬似ルートとして展開
                if (posts[rootId]) {
                    rootPosts.push(posts[rootId]);
                } else {
                    // 親が見つからない場合は返信をルート扱い
                    for (const r of replies) {
                        rootPosts.push(r);
                    }
                    threadReplies.delete(rootId);
                }
            }
        }

        // 再度ルート投稿を時系列順にソート
        rootPosts.sort((a, b) => a.create_at - b.create_at);

        const nowStr = this.formatDateTime(Date.now());
        let md = '';

        if (options.isCatchUp) {
            // 追いつき同期用のヘッダー
            md += `\n---\n\n`;
            md += `## 🔄 追いつき同期: ${nowStr} (新着 ${allPosts.length} 件)\n\n`;
        } else if (options.searchQuery) {
            // 検索結果用のヘッダー
            md += `# 🔎 Mattermost 検索結果: "${options.searchQuery}"\n`;
            md += `- 取得日時: ${nowStr}\n`;
            md += `- 対象チャンネル: 🏢 [${channel.teamName}] #${channel.displayName || channel.channelName}\n`;
            md += `- ヒット件数: ${allPosts.length} 件\n\n`;
            md += `---\n\n`;
        } else {
            // 初回全件取り込み用のヘッダー
            md += `# 💬 Mattermost ログ: 🏢 [${channel.teamName}] #${channel.displayName || channel.channelName}\n`;
            md += `- 取得日時: ${nowStr}\n`;
            md += `- チャンネル名: \`${channel.channelName}\` (ID: \`${channel.channelId}\`)\n`;
            if (options.baseUrl) {
                const channelUrl = `${options.baseUrl.replace(/\/+$/, '')}/${channel.teamName}/channels/${channel.channelName}`;
                md += `- チャンネルURL: [${channel.displayName || channel.channelName}](${channelUrl})\n`;
            }
            md += `- 投稿件数: ${allPosts.length} 件\n\n`;
            md += `---\n\n`;
        }

        // 各投稿の出力
        for (const root of rootPosts) {
            const user = userMap.get(root.user_id);
            const userStr = this.formatUserName(user);
            const dateStr = this.formatDateTime(root.create_at);
            const permalink = this.getPermalink(options.baseUrl, channel.teamName, root.id);

            md += `### 🗨️ ${dateStr} | ${userStr}\n`;
            if (permalink) {
                md += `> [元の投稿を開く (Permalink)](${permalink})\n\n`;
            } else {
                md += `\n`;
            }

            // 本文
            const msgLines = (root.message || '').split('\n');
            md += msgLines.join('\n') + '\n\n';

            // スレッド返信の出力
            const replies = threadReplies.get(root.id) || [];
            if (replies.length > 0) {
                replies.sort((a, b) => a.create_at - b.create_at);
                for (const reply of replies) {
                    const replyUser = userMap.get(reply.user_id);
                    const replyUserStr = this.formatUserName(replyUser);
                    const replyDateStr = this.formatDateTime(reply.create_at);
                    const replyPermalink = this.getPermalink(options.baseUrl, channel.teamName, reply.id);

                    md += `  - 💬 **返信** | ${replyDateStr} | ${replyUserStr}\n`;
                    if (replyPermalink) {
                        md += `    > [Permalink](${replyPermalink})\n`;
                    }
                    const replyLines = (reply.message || '').split('\n');
                    for (const line of replyLines) {
                        md += `    ${line}\n`;
                    }
                    md += `\n`;
                }
            }

            md += `---\n\n`;
        }

        return md;
    }
}
