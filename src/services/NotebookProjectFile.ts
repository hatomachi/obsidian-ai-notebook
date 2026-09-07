import * as fs from 'fs';
import * as path from 'path';
import { LinkedContext, MattermostChannelRef } from '../types';

/**
 * L1: ノートブックフォルダを「本物のプロジェクト」にするための生成物。
 *
 * 従来は sources/ artifacts/ の一覧や参照コンテキストを毎回 argv のプロンプト文字列に
 * 詰め直していたため、(a) 指示が巨大コンテキストに希釈される (b) argv 長制限のリスク
 * (c) ターミナルから素の CLI を叩いても再現できない、という問題があった。
 *
 * ここではそれらをノートブックフォルダ自身に永続化する：
 *   CLAUDE.md            … Claude Code が自動で読み込むプロジェクト文脈（自動生成・上書き）
 *   AGENTS.md            … Antigravity CLI 等の同等規約（同内容・自動生成・上書き）
 *   NOTEBOOK.md          … 人間が育てるノートブック固有の指示（初回のみ生成・以後不可侵）
 *   .claude/settings.json… 参照先ディレクトリの読み取り許可（既存キーはマージ保持）
 */
export interface NotebookProjectInput {
    notebookDir: string;
    sourcesDir: string;
    artifactsDir: string;
    notebookTitle?: string;
    notebookDescription?: string;
    linkedContexts?: LinkedContext[];
    boundFolderPath?: string;
    boundFolderTreeText?: string;
    boundMmChannels?: MattermostChannelRef[];
}

export interface NotebookProjectResult {
    claudeMdPath: string;
    notebookMdPath: string;
    /** CLI に --add-dir で渡すべき、cwd 外の読み取り対象ディレクトリ群 */
    additionalReadDirs: string[];
}

const GENERATED_HEADER = `<!-- このファイルは Obsidian AI Notebook が自動生成します。
     手で編集しても次回のエージェント実行時に上書きされます。
     このノートブック固有の指示は NOTEBOOK.md に書いてください。 -->`;

function listFilesWithSize(dir: string): string[] {
    const lines: string[] = [];
    if (!fs.existsSync(dir)) return lines;
    try {
        for (const file of fs.readdirSync(dir)) {
            const filePath = path.join(dir, file);
            try {
                const stat = fs.statSync(filePath);
                if (stat.isFile()) {
                    lines.push(`- \`${path.basename(dir)}/${file}\` (${stat.size} bytes)`);
                }
            } catch (e) {
                lines.push(`- \`${path.basename(dir)}/${file}\``);
            }
        }
    } catch (e) {
        // ignore
    }
    return lines;
}

/**
 * cwd の外にある読み取り対象ディレクトリを収集（--add-dir 用）。
 * 参照ノートブックの artifacts/ とバインド外部フォルダが対象。
 */
export function collectAdditionalReadDirs(input: NotebookProjectInput): string[] {
    const dirs = new Set<string>();
    const notebookDirNorm = path.normalize(input.notebookDir);

    for (const ctx of input.linkedContexts || []) {
        for (const art of ctx.artifacts) {
            if (!art.absolutePath) continue;
            const dir = path.normalize(path.dirname(art.absolutePath));
            if (dir.startsWith(notebookDirNorm + path.sep) || dir === notebookDirNorm) continue;
            dirs.add(dir);
        }
    }
    if (input.boundFolderPath && fs.existsSync(input.boundFolderPath)) {
        dirs.add(path.normalize(input.boundFolderPath));
    }
    return Array.from(dirs);
}

export function buildClaudeMdContent(input: NotebookProjectInput): string {
    const title = input.notebookTitle || path.basename(input.notebookDir);
    let md = `${GENERATED_HEADER}\n\n# ノートブック: ${title}\n\n`;
    if (input.notebookDescription) {
        md += `${input.notebookDescription}\n\n`;
    }

    md += `## このフォルダの役割\n`;
    md += `このディレクトリは1つのノートブックに対応する自己完結した作業空間です。\n\n`;
    md += `- \`sources/\`   今回の直接インプット（読み取り対象）\n`;
    md += `- \`artifacts/\` 成果物の出力先。**生成・編集した成果物は必ずここに書くこと**\n`;
    md += `- \`NOTEBOOK.md\` このノートブック固有の指示（人間が編集する）\n\n`;

    const sourceLines = listFilesWithSize(input.sourcesDir);
    md += `## インプット (sources/)\n`;
    md += sourceLines.length > 0
        ? `${sourceLines.join('\n')}\n\n※内容が必要なものは Read / Glob 等のツールで直接読み込むこと。\n\n`
        : `(現在インプットファイルはありません)\n\n`;

    const artifactLines = listFilesWithSize(input.artifactsDir);
    md += `## 既存の成果物 (artifacts/)\n`;
    md += artifactLines.length > 0
        ? `${artifactLines.join('\n')}\n\n※更新・追記・レビュー対象は、まず読み込んで現状を確認してから部分編集すること。\n\n`
        : `(まだ成果物はありません。指示に応じて artifacts/ 配下に新規作成すること)\n\n`;

    if (input.linkedContexts && input.linkedContexts.length > 0) {
        md += `## 参照コンテキスト（読み取り専用・編集禁止）\n`;
        md += `他ノートブックで育てられた仕様・作成ルール・過去の良質サンプルです。\n`;
        md += `ドキュメントの生成やレビューの前に、関係するものを必ず読み、用語・章立て・注意点を反映してください。\n\n`;
        for (const ctx of input.linkedContexts) {
            md += `### 📘 ${ctx.notebookTitle}\n`;
            if (ctx.description) md += `${ctx.description}\n`;
            if (ctx.artifacts.length > 0) {
                for (const art of ctx.artifacts) {
                    const p = art.absolutePath || art.path;
                    const size = art.size !== undefined ? ` (${art.size} bytes)` : '';
                    md += `- ${art.title}${size}\n  \`${p}\`\n`;
                }
            } else {
                md += `- (成果物なし)\n`;
            }
            md += `\n`;
        }
    }

    if (input.boundFolderTreeText) {
        md += `## バインドされた外部共有フォルダ（探索用ツリー）\n`;
        md += `社内ファイルサーバー／共有フォルダの一覧です。\n`;
        md += `「過去の見積を探して」等の依頼では、このツリーから候補を特定してユーザーに提示してください。\n\n`;
        md += `\`\`\`\n${input.boundFolderTreeText}\n\`\`\`\n\n`;
    }

    if (input.boundMmChannels && input.boundMmChannels.length > 0) {
        md += `## 連携された社内チャット (Mattermost)\n`;
        for (const ch of input.boundMmChannels) {
            const fileName = ch.sourceFileName || `mattermost_${ch.channelName}.md`;
            md += `- [${ch.teamName}] #${ch.displayName || ch.channelName} → \`sources/${fileName}\` (最終同期: ${ch.lastSyncedAt || '未同期'})\n`;
        }
        md += `\n※決定事項や課題を反映する場合は、上記ファイルを直接読み込むこと。\n\n`;
    }

    md += `## このノートブック固有の指示\n@NOTEBOOK.md\n`;
    return md;
}

const NOTEBOOK_MD_TEMPLATE = `# このノートブック固有の指示

<!-- ここは自動生成されません。自由に編集してください。CLAUDE.md から読み込まれます。
     例:
     - 章立ては参照コンテキストの「リリース計画書_作成ルール.md」に必ず従うこと
     - 対象システムは APIGW。用語は「API Gateway」ではなく「APIGW」で統一すること
     - 顧客名は伏字（A社 等）で記載すること
-->

（まだ指示はありません）
`;

function writeIfChanged(filePath: string, content: string): void {
    try {
        if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf-8') === content) return;
        fs.writeFileSync(filePath, content, 'utf-8');
    } catch (e) {
        console.warn(`[NotebookProjectFile] Failed to write ${filePath}:`, e);
    }
}

function mergeClaudeSettings(notebookDir: string, additionalReadDirs: string[]): void {
    const settingsDir = path.join(notebookDir, '.claude');
    const settingsPath = path.join(settingsDir, 'settings.json');
    let existing: any = {};
    try {
        if (fs.existsSync(settingsPath)) {
            existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) || {};
        }
    } catch (e) {
        console.warn('[NotebookProjectFile] Existing .claude/settings.json is invalid, regenerating:', e);
        existing = {};
    }

    const merged = {
        ...existing,
        permissions: {
            ...(existing.permissions || {}),
            additionalDirectories: additionalReadDirs
        }
    };

    try {
        if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
        writeIfChanged(settingsPath, JSON.stringify(merged, null, 2) + '\n');
    } catch (e) {
        console.warn('[NotebookProjectFile] Failed to write .claude/settings.json:', e);
    }
}

/**
 * ノートブックフォルダにプロジェクトファイル群を生成し、--add-dir 対象を返す。
 * 実行のたびに呼んでよい（差分がなければ書き込まない）。
 */
export function ensureNotebookProject(input: NotebookProjectInput): NotebookProjectResult {
    const claudeMdPath = path.join(input.notebookDir, 'CLAUDE.md');
    const agentsMdPath = path.join(input.notebookDir, 'AGENTS.md');
    const notebookMdPath = path.join(input.notebookDir, 'NOTEBOOK.md');

    try {
        if (!fs.existsSync(input.notebookDir)) {
            fs.mkdirSync(input.notebookDir, { recursive: true });
        }
        const content = buildClaudeMdContent(input);
        writeIfChanged(claudeMdPath, content);
        writeIfChanged(agentsMdPath, content);

        // 人間が育てる層。既にあれば絶対に触らない。
        if (!fs.existsSync(notebookMdPath)) {
            writeIfChanged(notebookMdPath, NOTEBOOK_MD_TEMPLATE);
        }
    } catch (e) {
        console.warn('[NotebookProjectFile] Failed to generate project files:', e);
    }

    const additionalReadDirs = collectAdditionalReadDirs(input);
    mergeClaudeSettings(input.notebookDir, additionalReadDirs);

    return { claudeMdPath, notebookMdPath, additionalReadDirs };
}
