import { AIAgentAdapter, AgentOptions, AgentResult, getExtendedEnv, resolveCommandPath, snapshotArtifacts, detectArtifactsDiff, runSpawnAgent, buildDirectEditSystemPrompt } from './AgentAdapter';
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

        console.log(`[ClaudeCodeAdapter] Executing agent with command: "${command}", resolved path: "${exePath}", cwd: "${notebookDir}"`);

        // 実行前スナップショット
        const beforeSnapshot = snapshotArtifacts(artifactsDir);

        // プロンプト構築
        const prompt = buildDirectEditSystemPrompt(userPrompt, options);

        // CLI 引数の構築 (--permission-mode acceptEdits, --max-turns)
        const args = [
            '-p', prompt,
            '--permission-mode', 'acceptEdits',
            '--max-turns', String(options.maxTurns || 15)
        ];

        try {
            const stdout = await runSpawnAgent(exePath, args, {
                cwd: notebookDir,
                env,
                onStdoutChunk: options.onStdoutChunk,
                abortSignal: options.abortSignal
            });

            // 実行後成果物差分検知
            const { created, modified } = detectArtifactsDiff(beforeSnapshot, artifactsDir);
            console.log(`[ClaudeCodeAdapter] Artifacts diff - Created: ${created.join(', ') || 'none'}, Modified: ${modified.join(', ') || 'none'}`);

            return {
                text: stdout,
                artifactsCreated: created,
                artifactsModified: modified
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
