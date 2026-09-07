import {
    AIAgentAdapter,
    AgentOptions,
    AgentResult,
    getExtendedEnv,
    resolveCommandPath,
    snapshotArtifacts,
    detectArtifactsDiff,
    runSpawnAgentDetailed,
    prepareNotebookProject,
    buildFallbackPrompt
} from './AgentAdapter';
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

        // AGENTS.md / CLAUDE.md を生成しておく
        prepareNotebookProject(options);

        const beforeSnapshot = snapshotArtifacts(artifactsDir);

        // Claude Code と違い CLAUDE.md 自動読み込みが保証できないため、
        // 環境の説明だけをプロンプトに同梱する（振る舞いの指示は入れない）。
        const prompt = buildFallbackPrompt(userPrompt, options);

        // プロンプト本体は argv ではなく stdin へ渡し、ARG_MAX 制限を回避する
        const args = ['-p', '--mode', 'accept-edits', '--dangerously-skip-permissions'];

        try {
            const spawnResult = await runSpawnAgentDetailed(exePath, args, {
                cwd: notebookDir,
                env,
                onStdoutChunk: options.onStdoutChunk,
                abortSignal: options.abortSignal,
                stdinInput: prompt
            });

            const { created, modified } = detectArtifactsDiff(beforeSnapshot, artifactsDir);

            return {
                text: spawnResult.stdout,
                artifactsCreated: created,
                artifactsModified: modified,
                debugInfo: {
                    agentId: this.id,
                    command,
                    exePath,
                    args,
                    cwd: notebookDir,
                    prompt,
                    stdout: spawnResult.stdout,
                    stderr: spawnResult.stderr,
                    exitCode: spawnResult.exitCode,
                    durationMs: spawnResult.durationMs
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
