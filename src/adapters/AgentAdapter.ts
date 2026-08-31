import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const execAsync = promisify(exec);

import { LinkedContext, ChatMessage } from '../types';

export interface AgentOptions {
    notebookDir: string;  // 当該ノートブックのルート絶対パス (<rootDir>/notebooks/<id>)。CLI の cwd
    sourcesDir: string;   // 当該ノートブック sources/ の絶対パス
    artifactsDir: string; // 当該ノートブック artifacts/ の絶対パス
    commandPath: string;  // 実行パス (agy, claude, etc.)
    maxTurns?: number;    // 最大ターン数（デフォルト: 15）
    linkedContexts?: LinkedContext[]; // リンクされた別ノートブックの成果物・ナレッジ群
    chatHistory?: ChatMessage[];      // 直近の会話履歴（マルチターン文脈）
    onStdoutChunk?: (chunk: string) => void; // ストリーミング用コールバック
    abortSignal?: AbortSignal;               // キャンセル用シグナル
    
    // 後方互換用
    contextDir?: string;
    outputDir?: string;
    systemKnowledgeName?: string;
    systemKnowledgeContent?: string;
    templateTitle?: string;
    templateContent?: string;
}

export interface AgentResult {
    text: string;
    artifactsCreated?: string[];
    artifactsModified?: string[];
}

export interface AIAgentAdapter {
    id: string;
    name: string;
    executePrompt(prompt: string, options: AgentOptions): Promise<AgentResult>;
}

/**
 * 拡張 PATH 環境変数を生成
 */
export function getExtendedEnv(): NodeJS.ProcessEnv {
    const home = os.homedir();
    const extraPaths = [
        path.join(home, '.local', 'bin'),
        path.join(home, '.antigravity', 'bin'),
        path.join(home, '.gemini', 'antigravity', 'bin'),
        '/usr/local/bin',
        '/opt/homebrew/bin',
        '/usr/bin',
        '/bin'
    ];

    const currentPath = process.env.PATH || '';
    const combinedPath = extraPaths.concat(currentPath.split(':')).filter(Boolean);
    const uniquePath = Array.from(new Set(combinedPath)).join(':');

    return {
        ...process.env,
        PATH: uniquePath
    };
}

/**
 * コマンド名から実際の実行パスを解決（agy / antigravity の相互フォールバック対応）
 */
export function resolveCommandPath(command: string): string {
    if (path.isAbsolute(command)) {
        return command;
    }

    const candidates = [command];
    if (command === 'antigravity' || command === 'agy') {
        candidates.push('agy', 'antigravity');
    }
    const uniqueCandidates = Array.from(new Set(candidates));

    const home = os.homedir();
    const searchDirs = [
        path.join(home, '.local', 'bin'),
        path.join(home, '.antigravity', 'bin'),
        path.join(home, '.gemini', 'antigravity', 'bin'),
        '/usr/local/bin',
        '/opt/homebrew/bin',
        '/usr/bin',
        '/bin'
    ];

    for (const cand of uniqueCandidates) {
        for (const dir of searchDirs) {
            const fullPath = path.join(dir, cand);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }
    }

    return command;
}

/**
 * プロンプトエスケープ
 */
export function escapePrompt(promptText: string): string {
    return promptText
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`');
}

/**
 * ノートブック作業ディレクトリ（cwd）の安全性を検証
 * ノートブック配下（.../notebooks/<id>）であることを確認し、Vaultルート等の誤指定を防止する
 */
export function validateNotebookWorkingDir(notebookDir: string): void {
    if (!notebookDir || typeof notebookDir !== 'string') {
        throw new Error('無効な作業ディレクトリです: notebookDir が指定されていません。');
    }
    const normalized = path.normalize(notebookDir);
    // パスが notebooks/<id> という構造を持っているか最低限確認
    if (!normalized.includes(path.join('notebooks')) && !normalized.includes('/notebooks/')) {
        console.warn(`[AgentAdapter] Warning: Working directory does not appear to be within a notebook directory: ${normalized}`);
    }
    if (!fs.existsSync(normalized)) {
        fs.mkdirSync(normalized, { recursive: true });
    }
}

/**
 * artifacts フォルダ内のファイルスナップショットを取得 (ファイル名 -> mtime)
 */
export function snapshotArtifacts(artifactsDir: string): Map<string, number> {
    const map = new Map<string, number>();
    if (fs.existsSync(artifactsDir)) {
        try {
            const files = fs.readdirSync(artifactsDir);
            for (const file of files) {
                const filePath = path.join(artifactsDir, file);
                try {
                    const stat = fs.statSync(filePath);
                    if (stat.isFile()) {
                        map.set(file, stat.mtimeMs);
                    }
                } catch (e) {
                    // ignore
                }
            }
        } catch (e) {
            // ignore
        }
    }
    return map;
}

/**
 * artifacts の前後スナップショットから新規・更新ファイルを検出
 */
export function detectArtifactsDiff(beforeSnapshot: Map<string, number>, artifactsDir: string): {
    created: string[];
    modified: string[];
} {
    const afterSnapshot = snapshotArtifacts(artifactsDir);
    const created: string[] = [];
    const modified: string[] = [];

    for (const [file, afterMtime] of afterSnapshot.entries()) {
        const beforeMtime = beforeSnapshot.get(file);
        if (beforeMtime === undefined) {
            created.push(file);
        } else if (afterMtime > beforeMtime + 50) { // わずかなタイムラグ許容
            modified.push(file);
        }
    }

    return { created, modified };
}

/**
 * spawn を用いたエージェントプロセスのストリーミング実行（キャンセル対応）
 */
export function runSpawnAgent(
    command: string,
    args: string[],
    options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        onStdoutChunk?: (chunk: string) => void;
        abortSignal?: AbortSignal;
    }
): Promise<string> {
    return new Promise((resolve, reject) => {
        validateNotebookWorkingDir(options.cwd);

        if (options.abortSignal?.aborted) {
            return reject(new Error('実行がキャンセルされました'));
        }

        console.log(`[runSpawnAgent] Spawning: ${command} in cwd: ${options.cwd}`);
        const child: ChildProcess = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            shell: false
        });

        // 対話型入力待ちによるハング防止のため、stdin を即時クローズ
        child.stdin?.end();

        let stdoutBuffer = '';
        let stderrBuffer = '';

        if (options.abortSignal) {
            const onAbort = () => {
                console.log(`[runSpawnAgent] Process aborted by user signal`);
                try {
                    child.kill('SIGTERM');
                    setTimeout(() => {
                        if (!child.killed) {
                            child.kill('SIGKILL');
                        }
                    }, 2000);
                } catch (e) {
                    console.error('[runSpawnAgent] Error killing child process:', e);
                }
                reject(new Error('ユーザーにより処理が中止されました'));
            };
            options.abortSignal.addEventListener('abort', onAbort, { once: true });
        }

        child.stdout?.on('data', (data: Buffer) => {
            const str = data.toString('utf-8');
            stdoutBuffer += str;
            if (options.onStdoutChunk) {
                options.onStdoutChunk(str);
            }
        });

        child.stderr?.on('data', (data: Buffer) => {
            const str = data.toString('utf-8');
            stderrBuffer += str;
            console.log(`[runSpawnAgent stderr]`, str);
        });

        child.on('error', (err) => {
            console.error(`[runSpawnAgent error]`, err);
            reject(err);
        });

        child.on('close', (code) => {
            console.log(`[runSpawnAgent] Process closed with exit code: ${code}`);
            if (code === 0 || stdoutBuffer.trim().length > 0) {
                resolve(stdoutBuffer.trim());
            } else {
                reject(new Error(`CLI プロセスがエラー終了しました (終了コード: ${code}): ${stderrBuffer || '出力なし'}`));
            }
        });
    });
}

/**
 * 直接ファイル編集モデル用プロンプトの構築ヘルパー
 */
export function buildDirectEditSystemPrompt(userPrompt: string, options: AgentOptions): string {
    const notebookDir = options.notebookDir || options.contextDir || process.cwd();
    const sourcesDir = options.sourcesDir || path.join(notebookDir, 'sources');
    const artifactsDir = options.artifactsDir || path.join(notebookDir, 'artifacts');

    let prompt = `あなたは高品質な技術・業務ドキュメントの作成およびレビューを自律的に行うエキスパートAIエージェントです。\n\n`;
    prompt += `【現在の作業環境とディレクトリの絶対パス】\n`;
    prompt += `- カレント作業ディレクトリ (cwd): "${notebookDir}"\n`;
    prompt += `- インプットフォルダ (sources/): "${sourcesDir}"\n`;
    prompt += `- 成果物フォルダ (artifacts/): "${artifactsDir}"\n\n`;

    // 1. sources/ 内のファイル一覧
    prompt += `【インプットソースファイル一覧 (sources/)】\n`;
    if (fs.existsSync(sourcesDir)) {
        try {
            const sourceFiles = fs.readdirSync(sourcesDir);
            if (sourceFiles.length > 0) {
                for (const file of sourceFiles) {
                    const filePath = path.join(sourcesDir, file);
                    try {
                        const stat = fs.statSync(filePath);
                        if (stat.isFile()) {
                            prompt += `- sources/${file} (${stat.size} bytes, パス: "${filePath}")\n`;
                        }
                    } catch (e) {
                        prompt += `- sources/${file}\n`;
                    }
                }
                prompt += `※インプットファイルの内容が必要な場合は、ツールを使って上記ファイルを直接読み込んでください。\n\n`;
            } else {
                prompt += `(現在投入されているインプットソースファイルはありません)\n\n`;
            }
        } catch (e) {
            prompt += `(ソースフォルダの読み込みに失敗しました)\n\n`;
        }
    } else {
        prompt += `(sources フォルダが存在しません)\n\n`;
    }

    // 2. artifacts/ 内の既存成果物一覧
    prompt += `【既存の成果物一覧 (artifacts/)】\n`;
    if (fs.existsSync(artifactsDir)) {
        try {
            const artifactFiles = fs.readdirSync(artifactsDir);
            if (artifactFiles.length > 0) {
                for (const file of artifactFiles) {
                    const filePath = path.join(artifactsDir, file);
                    try {
                        const stat = fs.statSync(filePath);
                        if (stat.isFile()) {
                            prompt += `- artifacts/${file} (${stat.size} bytes, パス: "${filePath}", 更新: ${new Date(stat.mtime).toISOString()})\n`;
                        }
                    } catch (e) {
                        prompt += `- artifacts/${file}\n`;
                    }
                }
                prompt += `※既存成果物を更新・追記・レビューする場合は、上記ファイルを読み込んで内容を確認し、ツールで直接編集してください。\n\n`;
            } else {
                prompt += `(現在作成されている成果物はありません。指示に応じて "${artifactsDir}" 配下に新規作成してください)\n\n`;
            }
        } catch (e) {
            prompt += `(成果物フォルダの読み込みに失敗しました)\n\n`;
        }
    } else {
        prompt += `(artifacts フォルダが存在しません)\n\n`;
    }

    // 3. リンクされた参照コンテキスト (Linked Notebooks)
    if (options.linkedContexts && options.linkedContexts.length > 0) {
        prompt += `【参照コンテキスト（Linked Notebooks / 知識・ルール・過去サンプル）】\n`;
        prompt += `以下はこのタスクに関連付けられた別のノートブックから読み込まれた成果物（システム仕様、ドキュメントルール、高品質サンプル等）です。これらを深く理解し、用語・章立て・注意点・過去トラブル教訓をドキュメント生成やレビューに反映してください。\n\n`;

        for (const ctx of options.linkedContexts) {
            prompt += `### 📘 参照ノートブック: "${ctx.notebookTitle}"\n`;
            if (ctx.description) {
                prompt += `説明: ${ctx.description}\n`;
            }
            if (ctx.artifacts.length > 0) {
                for (const art of ctx.artifacts) {
                    prompt += `\n--- 成果物: ${art.title} (${art.name}) ---\n`;
                    prompt += `${art.content}\n`;
                    prompt += `--- 終了: ${art.title} ---\n`;
                }
            } else {
                prompt += `(この参照ノートブックにはまだ成果物がありません)\n`;
            }
            prompt += `\n`;
        }
    }

    // 4. 後方互換ドメイン知識・テンプレート
    if (options.systemKnowledgeContent) {
        prompt += `【ドメイン・システム知識 (${options.systemKnowledgeName || 'システム仕様'})】\n`;
        prompt += `--- 開始: システム知識 ---\n${options.systemKnowledgeContent}\n--- 終了: システム知識 ---\n\n`;
    }
    if (options.templateContent) {
        prompt += `【ドキュメントフォーマット・作成基準 (${options.templateTitle || '指定テンプレート'})】\n`;
        prompt += `--- 開始: テンプレート ---\n${options.templateContent}\n--- 終了: テンプレート ---\n\n`;
    }

    // 5. 対話履歴
    if (options.chatHistory && options.chatHistory.length > 0) {
        const validHistory = options.chatHistory.filter(m => m.text && !m.text.startsWith('思考中...'));
        if (validHistory.length > 0) {
            prompt += `【これまでの対話履歴（セッションの文脈）】\n`;
            const recentHistory = validHistory.slice(-15);
            for (const msg of recentHistory) {
                const senderLabel = msg.sender === 'user' ? 'ユーザー' : 'AI';
                prompt += `${senderLabel}: ${msg.text}\n\n`;
            }
            prompt += `--- 対話履歴ここまで ---\n\n`;
        }
    }

    // 6. ユーザー指示と行動ルール
    prompt += `【今回のユーザー指示】\n${userPrompt}\n\n`;
    prompt += `【最重要行動ガイドライン（厳守）】\n`;
    prompt += `1. **必ずファイル作成/編集ツールを実行すること**: テキストやマークダウンコードブロックを出力するだけではファイルは保存されません。必ずファイル作成/編集ツール（write_to_file, edit_file 等）を実行し、実体ファイルとして "${artifactsDir}/<ファイル名>.md"（またはカレントディレクトリからの相対パス "artifacts/<ファイル名>.md"）に直接書き込んでください。\n`;
    prompt += `2. **段階的編集と既存記述の維持**: 既存の成果物を編集・追記する場合、人間が手作業で修正した箇所や既存の章を勝手に削除・全置換せず、指示されたセクションや章のみを的確に追加・修正してください。\n`;
    prompt += `3. **レビュー指示の実行**: レビューが指示された場合は、リンクされた参照ノートブックのルール・観点に照らし、指摘結果を "${artifactsDir}/review_<対象名>_YYYYMMDD.md" に直接ファイル出力してください（章 / 観点 / 指摘内容 / 対応状況 を含めること）。\n`;
    prompt += `4. **完了報告**: 処理完了後、どの成果物をどのように作成・編集したかの要約をユーザーへわかりやすく回答してください。\n`;

    return prompt;
}
