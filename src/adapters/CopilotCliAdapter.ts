import {
    AIAgentAdapter,
    AgentOptions,
    AgentResult,
    getExtendedEnv,
    resolveCommandPath,
    snapshotArtifacts,
    detectArtifactsDiff,
    detectSupportedFlags,
    runSpawnAgentDetailed,
    prepareNotebookProject,
    newAgentSessionId
} from './AgentAdapter';
import { CopilotStreamJsonAccumulator } from './CopilotStreamJsonParser';
import * as path from 'path';

/**
 * Copilot CLI 引数の構築。
 *
 * 振る舞いはプロンプトではなく CLI のネイティブオプションで表現する（薄いラッパー原則）。
 * 未対応のフラグは渡さない（--help から検出したものだけを使う）。
 */
export function buildCopilotArgs(params: {
    supports: (flag: string) => boolean;
    additionalReadDirs: string[];
    userPrompt: string;
    agentSessionId?: string;
    resumeSession?: boolean;
}): { args: string[]; outputJson: boolean } {
    const { supports, additionalReadDirs, userPrompt, agentSessionId, resumeSession } = params;
    const args: string[] = [];

    // 権限モードは常にバイパスする（-p には承認プロンプトに応答する手段がないため）
    if (supports('--allow-all')) {
        args.push('--allow-all');
    } else {
        if (supports('--allow-all-tools')) args.push('--allow-all-tools');
        if (supports('--allow-all-paths')) args.push('--allow-all-paths');
        if (supports('--allow-all-urls')) args.push('--allow-all-urls');
    }

    // JSON Lines 形式の出力
    const outputJson = supports('--output-format');
    if (outputJson) {
        args.push('--output-format', 'json');
    }

    // 追加参照ディレクトリ (Linked Context 等)
    for (const dir of additionalReadDirs) {
        if (supports('--add-dir')) args.push('--add-dir', dir);
    }

    // セッション継続
    if (agentSessionId) {
        if (resumeSession && supports('--resume')) {
            args.push('--resume', agentSessionId);
        } else if (!resumeSession && supports('--session-id')) {
            args.push('--session-id', agentSessionId);
        }
    }

    // -p <prompt> (Copilot CLI は -p の直後にプロンプト文字列を取る)
    args.push('-p', userPrompt);

    return { args, outputJson };
}

export class CopilotCliAdapter implements AIAgentAdapter {
    id = 'copilot';
    name = 'GitHub Copilot CLI';

    async executePrompt(userPrompt: string, options: AgentOptions): Promise<AgentResult> {
        const command = options.commandPath || 'copilot';
        const exePath = resolveCommandPath(command);
        const env = getExtendedEnv({ cliProxyUrl: options.cliProxyUrl, cliNoProxy: options.cliNoProxy });

        const notebookDir = options.notebookDir || options.contextDir || process.cwd();
        const artifactsDir = options.artifactsDir || path.join(notebookDir, 'artifacts');

        // ノートブックフォルダをプロジェクト化する。
        // Copilot CLI は AGENTS.md を自動読込するため、文脈をプロンプトに重複注入しない。
        const project = prepareNotebookProject(options);

        const supportedFlags = await detectSupportedFlags(exePath, env);
        const supports = (flag: string) => supportedFlags.has(flag);

        const beforeSnapshot = snapshotArtifacts(artifactsDir);

        const run = async (sessionId: string, resume: boolean) => {
            const { args, outputJson } = buildCopilotArgs({
                supports,
                additionalReadDirs: project.additionalReadDirs,
                userPrompt,
                agentSessionId: sessionId,
                resumeSession: resume
            });

            console.log(`[CopilotCliAdapter] resume=${resume} args=${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);

            const acc = outputJson ? new CopilotStreamJsonAccumulator(options.onStdoutChunk
                ? (line) => options.onStdoutChunk!(line)
                : undefined) : null;

            const spawnResult = await runSpawnAgentDetailed(exePath, args, {
                cwd: notebookDir,
                env,
                // json のときは生の JSONL を UI に流さず、整形した進捗テキストのみを流す
                onStdoutChunk: acc ? (chunk) => acc.push(chunk) : options.onStdoutChunk,
                abortSignal: options.abortSignal
            });

            const summary = acc ? acc.finish() : null;
            return { spawnResult, args, summary };
        };

        const startedResuming = !!(options.agentSessionId && options.resumeSession);
        let sessionId = options.agentSessionId || newAgentSessionId();

        try {
            let attempt;
            try {
                attempt = await run(sessionId, startedResuming);
            } catch (err) {
                // --resume に失敗した場合（セッション期限切れ、欠落など）は新規セッションで1度だけやり直す
                if (!startedResuming || options.abortSignal?.aborted) throw err;
                console.warn('[CopilotCliAdapter] --resume failed. Starting a fresh CLI session.', err);
                sessionId = newAgentSessionId();
                attempt = await run(sessionId, false);
            }

            const { created, modified } = detectArtifactsDiff(beforeSnapshot, artifactsDir);
            const summary = attempt.summary;
            const text = summary ? summary.resultText : attempt.spawnResult.stdout;

            if (summary?.toolErrors.length) {
                console.warn('[CopilotCliAdapter] Tool errors:', summary.toolErrors);
            }

            return {
                text,
                sessionId: summary?.sessionId || sessionId,
                artifactsCreated: created,
                artifactsModified: modified,
                debugInfo: {
                    agentId: this.id,
                    command,
                    exePath,
                    args: attempt.args,
                    cwd: notebookDir,
                    prompt: userPrompt,
                    stdout: attempt.spawnResult.stdout,
                    stderr: attempt.spawnResult.stderr,
                    exitCode: attempt.spawnResult.exitCode,
                    durationMs: attempt.spawnResult.durationMs,
                    toolUses: summary?.toolUses,
                    sessionId: summary?.sessionId || sessionId,
                    error: summary?.toolErrors.length
                        ? `ツール実行エラー: ${summary.toolErrors.join(' / ')}`
                        : undefined
                }
            };
        } catch (err: any) {
            console.error('[CopilotCliAdapter] CLI execution error:', err);
            if (err.message && err.message.includes('ユーザーにより処理が中止されました')) {
                throw err;
            }
            throw new Error(`GitHub Copilot CLI (${exePath}) 実行エラー: ${err.message || err}`);
        }
    }
}
