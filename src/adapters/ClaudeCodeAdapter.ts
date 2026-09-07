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
    buildAgentSystemPrompt,
    buildUserTurn
} from './AgentAdapter';
import { RETRY_DIRECTIVE } from './AgentCharter';
import * as path from 'path';

export class ClaudeCodeAdapter implements AIAgentAdapter {
    id = 'claude';
    name = 'Claude Code CLI';

    async executePrompt(userPrompt: string, options: AgentOptions): Promise<AgentResult> {
        const command = options.commandPath || 'claude';
        const exePath = resolveCommandPath(command);
        const env = getExtendedEnv();

        const notebookDir = options.notebookDir || options.contextDir || process.cwd();
        const artifactsDir = options.artifactsDir || path.join(notebookDir, 'artifacts');

        // L1: ノートブックフォルダをプロジェクト化（CLAUDE.md / AGENTS.md / .claude/settings.json）
        const project = prepareNotebookProject(options);

        const supportedFlags = await detectSupportedFlags(exePath, env);
        const supports = (flag: string) => supportedFlags.size === 0 ? false : supportedFlags.has(flag);

        console.log(`[ClaudeCodeAdapter] cwd: "${notebookDir}", additionalReadDirs: ${project.additionalReadDirs.join(', ') || 'none'}`);

        const beforeSnapshot = snapshotArtifacts(artifactsDir);

        const runOnce = async (opts: AgentOptions) => {
            // L0+L1 はシステムプロンプト、L4(履歴+指示) は stdin。
            // 巨大コンテキストによる指示の希釈と argv 長制限の両方を回避する。
            const systemPrompt = buildAgentSystemPrompt(opts);
            const userTurn = buildUserTurn(userPrompt, opts);

            const args: string[] = [];
            if (supports('--append-system-prompt')) {
                args.push('--append-system-prompt', systemPrompt);
            }
            if (supports('--max-turns') && opts.maxTurns) {
                args.push('--max-turns', String(opts.maxTurns));
            }
            if (supports('--add-dir')) {
                for (const dir of project.additionalReadDirs) {
                    args.push('--add-dir', dir);
                }
            }
            args.push('--dangerously-skip-permissions');
            // -p を値なしで置くと stdin からプロンプトを読む
            args.push('-p');

            // システムプロンプト分離に未対応のバージョンでは、単一プロンプトに結合して stdin へ流す
            const stdinInput = supports('--append-system-prompt')
                ? userTurn
                : `${systemPrompt}\n\n${userTurn}`;

            const spawnResult = await runSpawnAgentDetailed(exePath, args, {
                cwd: notebookDir,
                env,
                onStdoutChunk: opts.onStdoutChunk,
                abortSignal: opts.abortSignal,
                stdinInput
            });

            return { spawnResult, args, promptForDebug: `${systemPrompt}\n\n--- stdin ---\n${stdinInput}` };
        };

        try {
            let attempt = await runOnce(options);
            let diff = detectArtifactsDiff(beforeSnapshot, artifactsDir);
            let retried = false;

            // 構造的セーフティネット: 成果物が1件も動いていなければ、
            // 「質問だけ返して終了」したとみなして1回だけ厳格に再実行する。
            const nothingProduced = diff.created.length === 0 && diff.modified.length === 0;
            if (nothingProduced && !options.abortSignal?.aborted) {
                console.warn('[ClaudeCodeAdapter] No artifacts were produced. Retrying once with a strict directive.');
                retried = true;
                attempt = await runOnce({ ...options, retryDirective: RETRY_DIRECTIVE });
                diff = detectArtifactsDiff(beforeSnapshot, artifactsDir);
            }

            console.log(`[ClaudeCodeAdapter] Artifacts diff - Created: ${diff.created.join(', ') || 'none'}, Modified: ${diff.modified.join(', ') || 'none'}${retried ? ' (after retry)' : ''}`);

            return {
                text: attempt.spawnResult.stdout,
                artifactsCreated: diff.created,
                artifactsModified: diff.modified,
                debugInfo: {
                    agentId: this.id,
                    command,
                    exePath,
                    args: attempt.args,
                    cwd: notebookDir,
                    prompt: attempt.promptForDebug,
                    stdout: attempt.spawnResult.stdout,
                    stderr: attempt.spawnResult.stderr,
                    exitCode: attempt.spawnResult.exitCode,
                    durationMs: attempt.spawnResult.durationMs,
                    error: retried ? '初回実行で成果物が生成されなかったため自動再実行しました' : undefined
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
