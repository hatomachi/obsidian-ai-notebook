import * as fs from 'fs';
import * as path from 'path';
import { parseYaml, stringifyYaml } from 'obsidian';
import { SearchHintRule, SearchHintsData } from '../types';

export interface SearchHintsOptions {
    notebookDir: string;
    userHintsPath?: string;
    username?: string;
    rootDir?: string;
}

export class SearchHintsManager {
    /**
     * パス解決: ノートブック固有パスとユーザー共通パスを導出
     */
    static resolvePaths(target: string | SearchHintsOptions): {
        notebookHintsPath: string;
        userHintsPath?: string;
        notebookDir: string;
        defaultSavePath: string;
    } {
        let notebookDir: string;
        let userHintsPath: string | undefined;

        if (typeof target === 'string') {
            notebookDir = target;
            const normalized = path.normalize(notebookDir);
            // 例: .../users/<username>/notebooks/... から users/<username>/HINTS.md を推定
            const match = normalized.match(/(.*[\\/]users[\\/][^\\/]+)[\\/]notebooks(?:[\\/]|$)/);
            if (match) {
                userHintsPath = path.join(match[1], 'HINTS.md');
            }
        } else {
            notebookDir = target.notebookDir;
            if (target.userHintsPath) {
                userHintsPath = target.userHintsPath;
            } else if (target.username && target.rootDir) {
                userHintsPath = path.join(target.rootDir, 'users', target.username, 'HINTS.md');
            } else {
                const normalized = path.normalize(notebookDir);
                const match = normalized.match(/(.*[\\/]users[\\/][^\\/]+)[\\/]notebooks(?:[\\/]|$)/);
                if (match) {
                    userHintsPath = path.join(match[1], 'HINTS.md');
                }
            }
        }

        const notebookHintsPath = path.join(notebookDir, 'HINTS.md');
        const defaultSavePath = userHintsPath || notebookHintsPath;

        return {
            notebookHintsPath,
            userHintsPath,
            notebookDir,
            defaultSavePath
        };
    }

    /**
     * ノートブック直下の HINTS.md の絶対パスを取得（後方互換）
     */
    static getHintsPath(notebookDir: string): string {
        return path.join(notebookDir, 'HINTS.md');
    }

    /**
     * 指定されたファイルから HINTS.md を読み込み、ルール一覧をパース
     */
    static loadHintsFromFile(filePath: string, scope?: 'user' | 'notebook'): SearchHintsData {
        if (!fs.existsSync(filePath)) {
            return { confluenceHints: [] };
        }

        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const match = raw.match(/^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n|$)/);
            if (match) {
                const yaml = parseYaml(match[1]);
                if (yaml && Array.isArray(yaml.hints)) {
                    const rules: SearchHintRule[] = yaml.hints.map((h: any) => ({
                        id: h.id || `hint_${Math.random().toString(36).substring(2, 7)}`,
                        topic: h.topic || '',
                        keywords: Array.isArray(h.keywords) ? h.keywords : [h.topic || ''],
                        spaceKey: h.space_key || h.spaceKey || undefined,
                        ancestorId: h.ancestor_id || h.ancestorId || undefined,
                        ancestorTitle: h.ancestor_title || h.ancestorTitle || undefined,
                        guidance: h.guidance || '',
                        scope: scope || h.scope || undefined,
                        createdAt: h.created_at || h.createdAt || new Date().toISOString(),
                        updatedAt: h.updated_at || h.updatedAt || new Date().toISOString()
                    }));
                    return {
                        confluenceHints: rules,
                        generalNotes: yaml.general_notes || undefined
                    };
                }
            }
        } catch (e) {
            console.warn(`[SearchHintsManager] Failed to read ${filePath}:`, e);
        }

        return { confluenceHints: [] };
    }

    /**
     * HINTS.md を読み込み、ルール一覧をパース（ユーザー共通 ＋ ノートブック固有をマージ）
     */
    static loadHints(target: string | SearchHintsOptions): SearchHintsData {
        const { notebookHintsPath, userHintsPath } = this.resolvePaths(target);

        // 1. ユーザー共通の知恵を読み込む
        const userHints = userHintsPath ? this.loadHintsFromFile(userHintsPath, 'user') : { confluenceHints: [] };

        // 2. ノートブック固有の知恵を読み込む
        const notebookHints = this.loadHintsFromFile(notebookHintsPath, 'notebook');

        // もしユーザー共通パスとノートブック固有パスが同じ（またはユーザー共通が存在しない）ならそのまま
        if (!userHintsPath || userHintsPath === notebookHintsPath) {
            return notebookHints;
        }

        // 3. マージ: ユーザー共通をベースに、ノートブック固有で上書き/追加
        const mergedHints: SearchHintRule[] = [...userHints.confluenceHints];

        for (const nbRule of notebookHints.confluenceHints) {
            const existingIdx = mergedHints.findIndex(
                u => u.id === nbRule.id ||
                    (u.topic && nbRule.topic && u.topic.toLowerCase() === nbRule.topic.toLowerCase()) ||
                    (u.ancestorId && nbRule.ancestorId && u.ancestorId === nbRule.ancestorId)
            );

            if (existingIdx >= 0) {
                // ノートブック固有の指定で上書き・特化
                mergedHints[existingIdx] = {
                    ...mergedHints[existingIdx],
                    ...nbRule,
                    keywords: Array.from(new Set([
                        ...(mergedHints[existingIdx].keywords || []),
                        ...(nbRule.keywords || [])
                    ])),
                    scope: 'notebook'
                };
            } else {
                mergedHints.push(nbRule);
            }
        }

        return {
            confluenceHints: mergedHints,
            generalNotes: notebookHints.generalNotes || userHints.generalNotes
        };
    }

    /**
     * SearchHintsData を HINTS.md に永続化
     */
    static saveHints(targetPathOrDir: string, data: SearchHintsData): void {
        const hintsPath = targetPathOrDir.endsWith('.md')
            ? targetPathOrDir
            : path.join(targetPathOrDir, 'HINTS.md');

        const yamlObj = {
            hints: data.confluenceHints.map(h => ({
                id: h.id,
                topic: h.topic,
                keywords: h.keywords,
                space_key: h.spaceKey,
                ancestor_id: h.ancestorId,
                ancestor_title: h.ancestorTitle,
                guidance: h.guidance,
                created_at: h.createdAt,
                updated_at: h.updatedAt
            })),
            general_notes: data.generalNotes || undefined
        };

        const frontmatter = stringifyYaml(yamlObj);
        let md = `---\n${frontmatter}---\n# 🧭 探索の知恵 (Search Hints)\n\n`;
        md += `<!-- このファイルは外部ソース探索の知恵・過去の学習履歴を記録します。\n`;
        md += `     ユーザーからの助言やAIの学習結果が蓄積され、次回以降の探索精度が自動で向上します。\n`;
        md += `     手動での編集・追記・他メンバーへの共有も可能です。 -->\n\n`;

        md += `## Confluence 探索ルール\n\n`;
        if (data.confluenceHints.length === 0) {
            md += `(まだ学習されたルールはありません)\n`;
        } else {
            for (const h of data.confluenceHints) {
                md += `### 📌 ${h.topic}\n`;
                if (h.spaceKey) md += `- **推奨スペース**: \`${h.spaceKey}\`\n`;
                if (h.ancestorTitle || h.ancestorId) {
                    const title = h.ancestorTitle ? `\`${h.ancestorTitle}\`` : '';
                    const id = h.ancestorId ? ` (ID: ${h.ancestorId})` : '';
                    md += `- **推奨親ページ (Ancestor)**: ${title}${id}\n`;
                }
                if (h.guidance) md += `- **理由・助言**: ${h.guidance}\n`;
                if (h.keywords && h.keywords.length > 0) {
                    md += `- **対象キーワード**: ${h.keywords.map(k => `\`${k}\``).join(', ')}\n`;
                }
                md += `- *(更新日時: ${h.updatedAt})*\n\n`;
            }
        }

        try {
            const dir = path.dirname(hintsPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(hintsPath, md, 'utf-8');
        } catch (e) {
            console.warn(`[SearchHintsManager] Failed to write ${hintsPath}:`, e);
        }
    }

    /**
     * 人間のフィードバックやAI探索知恵を HINTS.md に学習・蓄積
     * デフォルトではユーザー共通の HINTS.md に永続化し、Notebook跨ぎで知恵を共有
     */
    static learnHint(
        target: string | SearchHintsOptions,
        rule: Partial<SearchHintRule> & { topic: string },
        options?: { scope?: 'user' | 'notebook' }
    ): SearchHintRule {
        const { notebookHintsPath, userHintsPath, defaultSavePath } = this.resolvePaths(target);
        const savePath = options?.scope === 'notebook'
            ? notebookHintsPath
            : (userHintsPath || defaultSavePath);

        const data = this.loadHintsFromFile(savePath, options?.scope || (userHintsPath ? 'user' : 'notebook'));
        const now = new Date().toISOString();

        // 既存の同一トピックまたは同一Ancestorがあるかチェック
        const existingIndex = data.confluenceHints.findIndex(
            h => h.topic.toLowerCase() === rule.topic.toLowerCase() ||
                (rule.ancestorId && h.ancestorId === rule.ancestorId)
        );

        let finalRule: SearchHintRule;

        if (existingIndex >= 0) {
            const existing = data.confluenceHints[existingIndex];
            const mergedKeywords = Array.from(new Set([
                ...(existing.keywords || []),
                ...(rule.keywords || []),
                rule.topic
            ]));

            finalRule = {
                ...existing,
                ...rule,
                keywords: mergedKeywords,
                scope: options?.scope || existing.scope || (userHintsPath ? 'user' : 'notebook'),
                updatedAt: now
            };
            data.confluenceHints[existingIndex] = finalRule;
        } else {
            const keywords = Array.from(new Set([
                ...(rule.keywords || []),
                rule.topic
            ]));

            finalRule = {
                id: rule.id || `hint_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                topic: rule.topic,
                keywords,
                spaceKey: rule.spaceKey,
                ancestorId: rule.ancestorId,
                ancestorTitle: rule.ancestorTitle,
                guidance: rule.guidance || 'ユーザーフィードバックによる学習ルール',
                scope: options?.scope || (userHintsPath ? 'user' : 'notebook'),
                createdAt: now,
                updatedAt: now
            };
            data.confluenceHints.push(finalRule);
        }

        this.saveHints(savePath, data);
        return finalRule;
    }

    /**
     * ユーザーの検索キーワードから、HINTS.md の知恵を照合して最適な CQL を提案
     */
    static buildSuggestedCql(
        query: string,
        target: string | SearchHintsOptions,
        defaultSpaceKey?: string
    ): { cql: string; matchedHint?: SearchHintRule; appliedRules: string[] } {
        const trimmedQuery = query.trim();
        const appliedRules: string[] = [];

        if (!trimmedQuery) {
            return { cql: '', appliedRules };
        }

        const data = this.loadHints(target);
        const lowerQuery = trimmedQuery.toLowerCase();

        // クエリとキーワード・トピックの前方・部分一致を検索
        let matchedHint: SearchHintRule | undefined = undefined;
        for (const hint of data.confluenceHints) {
            const matchInTopic = hint.topic && lowerQuery.includes(hint.topic.toLowerCase());
            const matchInKeywords = (hint.keywords || []).some(k => lowerQuery.includes(k.toLowerCase()) || k.toLowerCase().includes(lowerQuery));

            if (matchInTopic || matchInKeywords) {
                matchedHint = hint;
                break;
            }
        }

        const cqlConditions: string[] = [];

        if (matchedHint) {
            if (matchedHint.spaceKey) {
                cqlConditions.push(`space = "${matchedHint.spaceKey}"`);
                appliedRules.push(`Space: ${matchedHint.spaceKey}`);
            } else if (defaultSpaceKey) {
                cqlConditions.push(`space = "${defaultSpaceKey}"`);
            }

            if (matchedHint.ancestorId) {
                cqlConditions.push(`ancestor = "${matchedHint.ancestorId}"`);
                appliedRules.push(`Ancestor: ${matchedHint.ancestorTitle || matchedHint.ancestorId}`);
            }

            cqlConditions.push(`text ~ "${trimmedQuery}"`);
        } else {
            if (defaultSpaceKey) {
                cqlConditions.push(`space = "${defaultSpaceKey}"`);
            }
            cqlConditions.push(`text ~ "${trimmedQuery}"`);
        }

        return {
            cql: cqlConditions.join(' AND '),
            matchedHint,
            appliedRules
        };
    }
}
