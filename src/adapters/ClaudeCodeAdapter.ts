import { AIAgentAdapter, AgentOptions, AgentResult, getExtendedEnv, resolveCommandPath, escapePrompt, execAsync } from './AgentAdapter';
import * as fs from 'fs';
import * as path from 'path';

export class ClaudeCodeAdapter implements AIAgentAdapter {
    id = 'claude';
    name = 'Claude Code CLI';

    async executePrompt(userPrompt: string, options: AgentOptions): Promise<AgentResult> {
        const command = options.commandPath || 'claude';
        const exePath = resolveCommandPath(command);
        const env = getExtendedEnv();

        console.log(`[ClaudeCodeAdapter] Executing agent with command: "${command}", resolved path: "${exePath}"`);

        let systemContext = `あなたはNotebookLMのようなコンテキスト駆動AIアシスタントです。\n`;
        systemContext += `作業コンテキストフォルダ: "${options.contextDir}"\n\n`;

        if (fs.existsSync(options.contextDir)) {
            const files = fs.readdirSync(options.contextDir);
            if (files.length > 0) {
                systemContext += `【インプットソースファイルの内容】\n`;
                for (const file of files) {
                    const filePath = path.join(options.contextDir, file);
                    try {
                        const stat = fs.statSync(filePath);
                        if (stat.isFile()) {
                            const ext = path.extname(file).toLowerCase();
                            if (['.txt', '.md', '.json', '.csv', '.js', '.ts', '.html', '.css', '.py', '.yaml', '.yml'].includes(ext)) {
                                const content = fs.readFileSync(filePath, 'utf-8');
                                systemContext += `--- ファイル: ${file} ---\n${content.slice(0, 20000)}\n\n`;
                            } else {
                                systemContext += `--- ファイル: ${file} (バイナリ/メディアファイル: ${ext}) ---\n\n`;
                            }
                        }
                    } catch (e) {
                        console.warn(`[ClaudeCodeAdapter] Failed to read source file ${file}:`, e);
                    }
                }
            } else {
                systemContext += `【インプットソース】: ソースファイルはありません。\n\n`;
            }
        }

        systemContext += `【ユーザーの質問・指示】\n${userPrompt}\n\n`;
        systemContext += `丁寧かつ明瞭に回答してください。成果物を作成する場合は \`\`\`markdown:成果物タイトル.md の形式でファイル内容を出力してください。`;

        const escapedPrompt = escapePrompt(systemContext);
        const cmd = `"${exePath}" -p "${escapedPrompt}"`;

        console.log(`[ClaudeCodeAdapter] Invoking CLI command...`);

        try {
            const { stdout, stderr } = await execAsync(cmd, {
                env,
                cwd: options.contextDir,
                maxBuffer: 10 * 1024 * 1024
            });

            if (stderr) {
                console.log(`[ClaudeCodeAdapter] CLI stderr:`, stderr);
            }
            console.log(`[ClaudeCodeAdapter] CLI stdout received (${stdout.length} chars)`);

            return {
                text: stdout.trim()
            };
        } catch (err: any) {
            console.error('[ClaudeCodeAdapter] CLI execution error:', err);
            if (err.stdout && err.stdout.trim().length > 0) {
                return {
                    text: err.stdout.trim()
                };
            }
            throw new Error(`Claude Code CLI (${exePath}) 実行エラー: ${err.message || err}`);
        }
    }
}
