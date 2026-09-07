import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const execAsync = promisify(exec);

import { LinkedContext, ChatMessage, MattermostChannelRef, AgentDebugInfo } from '../types';
import { AGENT_CHARTER } from './AgentCharter';
import { ensureNotebookProject, buildClaudeMdContent, NotebookProjectResult } from '../services/NotebookProjectFile';

export interface AgentOptions {
    notebookDir: string;  // 当該ノートブックのルート絶対パス (<rootDir>/notebooks/<id>)。CLI の cwd
    sourcesDir: string;   // 当該ノートブック sources/ の絶対パス
    artifactsDir: string; // 当該ノートブック artifacts/ の絶対パス
    commandPath: string;  // 実行パス (agy, claude, etc.)
    maxTurns?: number;    // 最大ターン数（デフォルト: 15）
    linkedContexts?: LinkedContext[]; // リンクされた別ノートブックの成果物・ナレッジ群
    chatHistory?: ChatMessage[];      // 直近の会話履歴（マルチターン文脈）
    boundFolderTreeText?: string;     // バインドされた外部フォルダ資産の階層ツリー概要（読み取り専用・実パス秘匿）
    boundMmChannels?: MattermostChannelRef[]; // 連携されたMattermostチャンネル情報
    onStdoutChunk?: (chunk: string) => void; // ストリーミング用コールバック
    abortSignal?: AbortSignal;               // キャンセル用シグナル

    // L1: ノートブックフォルダをプロジェクト化するためのメタ情報
    notebookTitle?: string;       // CLAUDE.md の見出しに使用
    notebookDescription?: string; // CLAUDE.md の概要に使用
    boundFolderPath?: string;     // バインド外部フォルダの絶対パス (--add-dir 対象)
    /** 再実行時に先頭へ差し込むディレクティブ (成果物ゼロ時の自動リトライ用) */
    retryDirective?: string;
    
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
    debugInfo?: AgentDebugInfo;
}

export interface AIAgentAdapter {
    id: string;
    name: string;
    executePrompt(prompt: string, options: AgentOptions): Promise<AgentResult>;
}

/**
 * 拡張 PATH 環境変数を生成（Mac / Windows 両対応）
 */
export function getExtendedEnv(): NodeJS.ProcessEnv {
    const home = os.homedir();
    const isWin = process.platform === 'win32';
    const extraPaths = isWin
        ? [
            path.join(home, 'AppData', 'Roaming', 'npm'),
            path.join(home, '.antigravity', 'bin'),
            path.join(home, '.gemini', 'antigravity', 'bin'),
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs')
        ]
        : [
            path.join(home, '.local', 'bin'),
            path.join(home, '.antigravity', 'bin'),
            path.join(home, '.gemini', 'antigravity', 'bin'),
            '/usr/local/bin',
            '/opt/homebrew/bin',
            '/usr/bin',
            '/bin'
        ];

    const currentPath = process.env.PATH || '';
    const combinedPath = extraPaths.concat(currentPath.split(path.delimiter)).filter(Boolean);
    const uniquePath = Array.from(new Set(combinedPath)).join(path.delimiter);

    return {
        ...process.env,
        PATH: uniquePath
    };
}

/**
 * コマンド名から実際の実行パスを解決（Windows の .cmd / .bat / .exe 自動補完および agy / antigravity 相互フォールバック）
 */
export function resolveCommandPath(command: string): string {
    if (path.isAbsolute(command)) {
        return command;
    }

    const isWin = process.platform === 'win32';
    const baseCandidates = [command];
    if (command === 'antigravity' || command === 'agy') {
        baseCandidates.push('agy', 'antigravity');
    }

    // Windows の場合は拡張子バリエーション (.cmd, .bat, .exe) も網羅
    const candidates: string[] = [];
    for (const base of baseCandidates) {
        candidates.push(base);
        if (isWin && !path.extname(base)) {
            candidates.push(`${base}.cmd`, `${base}.bat`, `${base}.exe`);
        }
    }
    const uniqueCandidates = Array.from(new Set(candidates));

    const home = os.homedir();
    const searchDirs = isWin
        ? [
            path.join(home, 'AppData', 'Roaming', 'npm'),
            path.join(home, '.antigravity', 'bin'),
            path.join(home, '.gemini', 'antigravity', 'bin'),
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs')
        ]
        : [
            path.join(home, '.local', 'bin'),
            path.join(home, '.antigravity', 'bin'),
            path.join(home, '.gemini', 'antigravity', 'bin'),
            '/usr/local/bin',
            '/opt/homebrew/bin',
            '/usr/bin',
            '/bin'
        ];

    // PATH 環境変数のディレクトリも検索対象に追加
    const envPaths = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const allSearchDirs = Array.from(new Set([...searchDirs, ...envPaths]));

    for (const cand of uniqueCandidates) {
        for (const dir of allSearchDirs) {
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

export interface SpawnDetailedResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
}

/**
 * spawn を用いたエージェントプロセスのストリーミング実行（詳細メトリクス取得・キャンセル対応）
 */
export function runSpawnAgentDetailed(
    command: string,
    args: string[],
    options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        onStdoutChunk?: (chunk: string) => void;
        abortSignal?: AbortSignal;
        /** stdin へ流し込む本文。argv 長制限(ARG_MAX)を避けるため巨大プロンプトはこちらを使う */
        stdinInput?: string;
    }
): Promise<SpawnDetailedResult> {
    return new Promise((resolve, reject) => {
        validateNotebookWorkingDir(options.cwd);

        if (options.abortSignal?.aborted) {
            return reject(new Error('実行がキャンセルされました'));
        }

        const startTime = Date.now();
        console.log(`[runSpawnAgent] Spawning: ${command} in cwd: ${options.cwd}`);
        const child: ChildProcess = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            shell: process.platform === 'win32'
        });

        // stdin にプロンプト本文を流し込み、必ずクローズする。
        // (クローズしないと CLI が対話入力待ちでハングする)
        child.stdin?.on('error', (e) => {
            // 相手プロセスが先に終了した場合の EPIPE 等を握りつぶす
            console.warn('[runSpawnAgent] stdin error (ignored):', e);
        });
        try {
            if (options.stdinInput) {
                child.stdin?.write(options.stdinInput, 'utf-8');
            }
        } catch (e) {
            console.error('[runSpawnAgent] Failed to write stdin:', e);
        }
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
            const durationMs = Date.now() - startTime;
            console.log(`[runSpawnAgent] Process closed with exit code: ${code} (took ${durationMs}ms)`);
            if (code === 0 || stdoutBuffer.trim().length > 0) {
                resolve({
                    stdout: stdoutBuffer.trim(),
                    stderr: stderrBuffer.trim(),
                    exitCode: code,
                    durationMs
                });
            } else {
                reject(new Error(`CLI プロセスがエラー終了しました (終了コード: ${code}): ${stderrBuffer || '出力なし'}`));
            }
        });
    });
}

/**
 * spawn を用いたエージェントプロセスのストリーミング実行（後方互換用）
 */
export async function runSpawnAgent(
    command: string,
    args: string[],
    options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        onStdoutChunk?: (chunk: string) => void;
        abortSignal?: AbortSignal;
    }
): Promise<string> {
    const result = await runSpawnAgentDetailed(command, args, options);
    return result.stdout;
}

/**
 * ノートブックフォルダをプロジェクト化し、cwd 外の読み取り対象ディレクトリを返す。
 * 各アダプタは CLI 実行前にこれを呼ぶ。
 */
export function prepareNotebookProject(options: AgentOptions): NotebookProjectResult {
    const notebookDir = options.notebookDir || options.contextDir || process.cwd();
    return ensureNotebookProject({
        notebookDir,
        sourcesDir: options.sourcesDir || path.join(notebookDir, 'sources'),
        artifactsDir: options.artifactsDir || path.join(notebookDir, 'artifacts'),
        notebookTitle: options.notebookTitle,
        notebookDescription: options.notebookDescription,
        linkedContexts: options.linkedContexts,
        boundFolderPath: options.boundFolderPath,
        boundFolderTreeText: options.boundFolderTreeText,
        boundMmChannels: options.boundMmChannels
    });
}

/**
 * L0 + L1: システムプロンプト（--append-system-prompt へ渡す）
 *
 * 行動契約とパス情報のみ。ファイル一覧・参照コンテキスト・外部フォルダツリーは
 * ノートブック直下の CLAUDE.md に永続化済みで、CLI が自動で読み込む。
 */
export function buildAgentSystemPrompt(options: AgentOptions): string {
    const notebookDir = options.notebookDir || options.contextDir || process.cwd();
    const sourcesDir = options.sourcesDir || path.join(notebookDir, 'sources');
    const artifactsDir = options.artifactsDir || path.join(notebookDir, 'artifacts');

    let prompt = `${AGENT_CHARTER}\n\n`;
    prompt += `# 作業環境\n`;
    prompt += `- カレント作業ディレクトリ (cwd): "${notebookDir}"\n`;
    prompt += `- インプットフォルダ: "${sourcesDir}"\n`;
    prompt += `- 成果物フォルダ: "${artifactsDir}"\n`;
    prompt += `- このノートブックの構造・インプット一覧・参照コンテキストは、cwd 直下の CLAUDE.md に記載されています。\n`;
    prompt += `  必要なファイルは Read / Glob 等のツールで直接読み込んでください。\n`;

    // 後方互換: 明示的に注入されたドメイン知識・テンプレート
    if (options.systemKnowledgeContent) {
        prompt += `\n# ドメイン・システム知識 (${options.systemKnowledgeName || 'システム仕様'})\n`;
        prompt += `${options.systemKnowledgeContent}\n`;
    }
    if (options.templateContent) {
        prompt += `\n# ドキュメントフォーマット・作成基準 (${options.templateTitle || '指定テンプレート'})\n`;
        prompt += `${options.templateContent}\n`;
    }

    return prompt;
}

/**
 * L4: ユーザーターン（stdin へ渡す）
 * 対話履歴と今回の指示のみ。ルールを混ぜないことで指示が希釈されるのを防ぐ。
 */
export function buildUserTurn(userPrompt: string, options: AgentOptions): string {
    let turn = '';

    if (options.retryDirective) {
        turn += `${options.retryDirective}\n`;
    }

    if (options.chatHistory && options.chatHistory.length > 0) {
        const validHistory = options.chatHistory.filter(m => m.text && !m.text.startsWith('思考中...'));
        if (validHistory.length > 0) {
            turn += `【これまでの対話履歴（セッションの文脈）】\n`;
            for (const msg of validHistory.slice(-15)) {
                const senderLabel = msg.sender === 'user' ? 'ユーザー' : 'AI';
                turn += `${senderLabel}: ${msg.text}\n\n`;
            }
            turn += `--- 対話履歴ここまで ---\n\n`;
        }
    }

    turn += `【今回のユーザー指示】\n${userPrompt}\n`;
    return turn;
}

/**
 * 単一プロンプトしか受け付けない CLI 向けの結合版（後方互換）。
 * システムプロンプト分離に対応していないエージェントでは、CLAUDE.md の内容も
 * インラインで同梱して同等の文脈を与える。
 */
export function buildDirectEditSystemPrompt(userPrompt: string, options: AgentOptions): string {
    const notebookDir = options.notebookDir || options.contextDir || process.cwd();
    const projectContext = buildClaudeMdContent({
        notebookDir,
        sourcesDir: options.sourcesDir || path.join(notebookDir, 'sources'),
        artifactsDir: options.artifactsDir || path.join(notebookDir, 'artifacts'),
        notebookTitle: options.notebookTitle,
        notebookDescription: options.notebookDescription,
        linkedContexts: options.linkedContexts,
        boundFolderPath: options.boundFolderPath,
        boundFolderTreeText: options.boundFolderTreeText,
        boundMmChannels: options.boundMmChannels
    });

    return `${buildAgentSystemPrompt(options)}\n${projectContext}\n${buildUserTurn(userPrompt, options)}`;
}

/**
 * CLI が対応しているオプションを --help から検出してキャッシュする。
 *
 * Claude Code / Antigravity CLI はバージョンによって利用可能なフラグが異なるため、
 * 未対応フラグを渡して起動失敗する事故を防ぐ。検出できなかった場合は
 * 「最小限の引数のみ」に安全側で倒す。
 */
const supportedFlagCache = new Map<string, Set<string>>();

export async function detectSupportedFlags(exePath: string, env: NodeJS.ProcessEnv): Promise<Set<string>> {
    const cached = supportedFlagCache.get(exePath);
    if (cached) return cached;

    const flags = new Set<string>();
    try {
        const { stdout, stderr } = await execAsync(`"${exePath}" --help`, {
            env,
            timeout: 15000,
            maxBuffer: 4 * 1024 * 1024
        });
        const helpText = `${stdout || ''}\n${stderr || ''}`;
        const re = /--[a-zA-Z0-9][a-zA-Z0-9-]*/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(helpText)) !== null) {
            flags.add(m[0]);
        }
        console.log(`[detectSupportedFlags] ${exePath}: ${flags.size} flags detected`);
    } catch (e) {
        console.warn(`[detectSupportedFlags] Failed to read --help for ${exePath}. Falling back to minimal args.`, e);
    }

    supportedFlagCache.set(exePath, flags);
    return flags;
}

/** テスト・設定変更時にフラグ検出キャッシュを破棄する */
export function clearSupportedFlagCache(): void {
    supportedFlagCache.clear();
}
