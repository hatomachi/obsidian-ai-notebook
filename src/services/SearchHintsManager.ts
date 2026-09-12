import * as fs from 'fs';
import * as path from 'path';
import { parseYaml, stringifyYaml } from 'obsidian';
import { SearchHintRule, SearchHintsData } from '../types';

export class SearchHintsManager {
    /**
     * ノートブック直下の HINTS.md の絶対パスを取得
     */
    static getHintsPath(notebookDir: string): string {
        return path.join(notebookDir, 'HINTS.md');
    }

    /**
     * HINTS.md を読み込み、ルール一覧をパース
     */
    static loadHints(notebookDir: string): SearchHintsData {
        const hintsPath = this.getHintsPath(notebookDir);
        if (!fs.existsSync(hintsPath)) {
            return { confluenceHints: [] };
        }

        try {
            const raw = fs.readFileSync(hintsPath, 'utf-8');
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
            console.warn(`[SearchHintsManager] Failed to read HINTS.md:`, e);
        }

        return { confluenceHints: [] };
    }

    /**
     * SearchHintsData を HINTS.md に永続化
     */
    static saveHints(notebookDir: string, data: SearchHintsData): void {
        const hintsPath = this.getHintsPath(notebookDir);
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
        md += `     手動での編集・追記も可能です。 -->\n\n`;

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
            if (!fs.existsSync(notebookDir)) {
                fs.mkdirSync(notebookDir, { recursive: true });
            }
            fs.writeFileSync(hintsPath, md, 'utf-8');
        } catch (e) {
            console.warn(`[SearchHintsManager] Failed to write HINTS.md:`, e);
        }
    }

    /**
     * 人間のフィードバックやAI探索知恵を HINTS.md に学習・蓄積
     */
    static learnHint(notebookDir: string, rule: Partial<SearchHintRule> & { topic: string }): SearchHintRule {
        const data = this.loadHints(notebookDir);
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
                createdAt: now,
                updatedAt: now
            };
            data.confluenceHints.push(finalRule);
        }

        this.saveHints(notebookDir, data);
        return finalRule;
    }

    /**
     * ユーザーの検索キーワードから、HINTS.md の知恵を照合して最適な CQL を提案
     */
    static buildSuggestedCql(
        query: string,
        notebookDir: string,
        defaultSpaceKey?: string
    ): { cql: string; matchedHint?: SearchHintRule; appliedRules: string[] } {
        const trimmedQuery = query.trim();
        const appliedRules: string[] = [];

        if (!trimmedQuery) {
            return { cql: '', appliedRules };
        }

        const data = this.loadHints(notebookDir);
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
