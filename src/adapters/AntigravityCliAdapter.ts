import { AIAgentAdapter, AgentOptions, AgentResult, getExtendedEnv, resolveCommandPath, snapshotArtifacts, detectArtifactsDiff, runSpawnAgentDetailed, prepareNotebookProject, buildDirectEditSystemPrompt } from './AgentAdapter';
import { RETRY_DIRECTIVE } from './AgentCharter';
import * as path from 'path';

export class AntigravityCliAdapter implements AIAgentAdapter {
    id = 'antigravity';
    name = 'Antigravity CLI';

    async executePrompt(userPrompt: string, options: AgentOptions): Promise<AgentResult> {
        const command = options.commandPath || 'agy';
        const exePath = resolveCommandPath(command);
        const env = getExtendedEnv();

        const notebookDir = options.notebookDir || options.contextDir || process.cwd();
        const artifactsDir = options.artifactsDir || path.join(notebookDir, 'artifacts');

        console.log(`[AntigravityCliAdapter] Executing agent with command: "${command}", resolved path: "${exePath}", cwd: "${notebookDir}"`);

        // L1: ノートブックフォルダをプロジェクト化 (AGENTS.md / CLAUDE.md / NOTEBOOK.md)
        prepareNotebookProject(options);

        // 実行前スナップショット
        const beforeSnapshot = snapshotArtifacts(artifactsDir);

        // CLI 引数の構築 (--mode accept-edits, --dangerously-skip-permissions)
        // プロンプト本体は argv ではなく stdin へ渡し、ARG_MAX 制限を回避する。
        const args = [
            '-p',
            '--mode', 'accept-edits',
            '--dangerously-skip-permissions'
        ];

        const runOnce = async (opts: AgentOptions) => {
            const prompt = buildDirectEditSystemPrompt(userPrompt, opts);
            const spawnResult = await runSpawnAgentDetailed(exePath, args, {
                cwd: notebookDir,
                env,
                onStdoutChunk: opts.onStdoutChunk,
                abortSignal: opts.abortSignal,
                stdinInput: prompt
            });
            return { spawnResult, prompt };
        };

        try {
            let attempt = await runOnce(options);
            let diff = detectArtifactsDiff(beforeSnapshot, artifactsDir);
            let retried = false;

            // 成果物が1件も動いていなければ「質問だけ返して終了」とみなし、1回だけ厳格に再実行
            if (diff.created.length === 0 && diff.modified.length === 0 && !options.abortSignal?.aborted) {
                console.warn('[AntigravityCliAdapter] No artifacts were produced. Retrying once with a strict directive.');
                retried = true;
                attempt = await runOnce({ ...options, retryDirective: RETRY_DIRECTIVE });
                diff = detectArtifactsDiff(beforeSnapshot, artifactsDir);
            }

            console.log(`[AntigravityCliAdapter] Artifacts diff - Created: ${diff.created.join(', ') || 'none'}, Modified: ${diff.modified.join(', ') || 'none'}${retried ? ' (after retry)' : ''}`);

            return {
                text: attempt.spawnResult.stdout,
                artifactsCreated: diff.created,
                artifactsModified: diff.modified,
                debugInfo: {
                    agentId: this.id,
                    command,
                    exePath,
                    args,
                    cwd: notebookDir,
                    prompt: attempt.prompt,
                    stdout: attempt.spawnResult.stdout,
                    stderr: attempt.spawnResult.stderr,
                    exitCode: attempt.spawnResult.exitCode,
                    durationMs: attempt.spawnResult.durationMs,
                    error: retried ? '初回実行で成果物が生成されなかったため自動再実行しました' : undefined
                }
            };
        } catch (err: any) {
            console.error('[AntigravityCliAdapter] CLI execution error:', err);
            if (err.message && err.message.includes('ユーザーにより処理が中止されました')) {
                throw err;
            }
            throw new Error(`Antigravity CLI (${exePath}) 実行エラー: ${err.message || err}`);
        }
    }
}
