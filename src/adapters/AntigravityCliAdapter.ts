import { AIAgentAdapter, AgentOptions, AgentResult, getExtendedEnv, resolveCommandPath, snapshotArtifacts, detectArtifactsDiff, runSpawnAgent, buildDirectEditSystemPrompt } from './AgentAdapter';
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

        // 実行前スナップショット
        const beforeSnapshot = snapshotArtifacts(artifactsDir);

        // プロンプト構築
        const prompt = buildDirectEditSystemPrompt(userPrompt, options);

        // CLI 引数の構築 (--mode accept-edits, --dangerously-skip-permissions)
        const args = [
            '-p', prompt,
            '--mode', 'accept-edits',
            '--dangerously-skip-permissions'
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
            console.log(`[AntigravityCliAdapter] Artifacts diff - Created: ${created.join(', ') || 'none'}, Modified: ${modified.join(', ') || 'none'}`);

            return {
                text: stdout,
                artifactsCreated: created,
                artifactsModified: modified
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
