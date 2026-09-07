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
import { StreamJsonAccumulator } from './StreamJsonParser';
import * as path from 'path';

/**
 * CLI 引数の構築。
 *
 * 振る舞いはプロンプトではなく CLI のオプションで表現する。
 * 未対応のフラグは渡さない（--help から検出したものだけを使う）。
 */
export function buildClaudeArgs(params: {
    supports: (flag: string) => boolean;
    additionalReadDirs: string[];
    agentSessionId?: string;
    resumeSession?: boolean;
}): { args: string[]; streamJson: boolean } {
    const { supports, additionalReadDirs, agentSessionId, resumeSession } = params;
    const args: string[] = [];

    // 権限モードは常にバイパスする。-p には承認プロンプトに応答する手段がなく、
    // プロンプトが出た時点で「許可待ち」のまま何も起きずに終わるため。
    if (supports('--permission-mode')) {
        args.push('--permission-mode', 'bypassPermissions');
    } else {
        args.push('--dangerously-skip-permissions');
    }

    // stream-json は --verbose とセットでないと print モードで拒否される
    const streamJson = supports('--output-format') && supports('--verbose');
    if (streamJson) {
        args.push('--output-format', 'stream-json', '--verbose');
    }

    for (const dir of additionalReadDirs) {
        if (supports('--add-dir')) args.push('--add-dir', dir);
    }

    if (agentSessionId) {
        if (resumeSession && supports('--resume')) {
            args.push('--resume', agentSessionId);
        } else if (!resumeSession && supports('--session-id')) {
            args.push('--session-id', agentSessionId);
        }
    }

    // 値を付けずに置くと stdin からプロンプトを読む
    args.push('-p');
    return { args, streamJson };
}

export class ClaudeCodeAdapter implements AIAgentAdapter {
    id = 'claude';
    name = 'Claude Code CLI';

    async executePrompt(userPrompt: string, options: AgentOptions): Promise<AgentResult> {
        const command = options.commandPath || 'claude';
        const exePath = resolveCommandPath(command);
        const env = getExtendedEnv();

        const notebookDir = options.notebookDir || options.contextDir || process.cwd();
        const artifactsDir = options.artifactsDir || path.join(notebookDir, 'artifacts');

        // ノートブックフォルダをプロジェクト化する。文脈は CLAUDE.md 経由で
        // Claude Code 自身が読むため、プロンプトには一切注入しない。
        const project = prepareNotebookProject(options);

        const supportedFlags = await detectSupportedFlags(exePath, env);
        const supports = (flag: string) => supportedFlags.has(flag);

        const beforeSnapshot = snapshotArtifacts(artifactsDir);

        const run = async (sessionId: string, resume: boolean) => {
            const { args, streamJson } = buildClaudeArgs({
                supports,
                additionalReadDirs: project.additionalReadDirs,
                agentSessionId: sessionId,
                resumeSession: resume
            });

            console.log(`[ClaudeCodeAdapter] resume=${resume} args=${args.join(' ')}`);

            const acc = streamJson ? new StreamJsonAccumulator(options.onStdoutChunk
                ? (line) => options.onStdoutChunk!(`${line}\n`)
                : undefined) : null;

            const spawnResult = await runSpawnAgentDetailed(exePath, args, {
                cwd: notebookDir,
                env,
                // stream-json のときは生の JSON を UI に流さず、整形した進捗のみを流す
                onStdoutChunk: acc ? (chunk) => acc.push(chunk) : options.onStdoutChunk,
                abortSignal: options.abortSignal,
                stdinInput: userPrompt
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
                // --resume に失敗した場合（フォルダ移動、セッション欠落など）だけは
                // 新しいセッションで一度だけやり直す。挙動ではなく機構の回復。
                if (!startedResuming || options.abortSignal?.aborted) throw err;
                console.warn('[ClaudeCodeAdapter] --resume failed. Starting a fresh CLI session.', err);
                sessionId = newAgentSessionId();
                attempt = await run(sessionId, false);
            }

            const { created, modified } = detectArtifactsDiff(beforeSnapshot, artifactsDir);
            const summary = attempt.summary;
            const text = summary ? summary.resultText : attempt.spawnResult.stdout;

            if (summary?.toolErrors.length) {
                console.warn('[ClaudeCodeAdapter] Tool errors:', summary.toolErrors);
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
            console.error('[ClaudeCodeAdapter] CLI execution error:', err);
            if (err.message && err.message.includes('ユーザーにより処理が中止されました')) {
                throw err;
            }
            throw new Error(`Claude Code CLI (${exePath}) 実行エラー: ${err.message || err}`);
        }
    }
}
