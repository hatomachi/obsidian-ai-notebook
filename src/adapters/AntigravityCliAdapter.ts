import { AIAgentAdapter, AgentOptions, AgentResult, getExtendedEnv, resolveCommandPath, escapePrompt, execAsync } from './AgentAdapter';
import * as fs from 'fs';
import * as path from 'path';

export class AntigravityCliAdapter implements AIAgentAdapter {
    id = 'antigravity';
    name = 'Antigravity CLI';

    async executePrompt(userPrompt: string, options: AgentOptions): Promise<AgentResult> {
        const command = options.commandPath || 'agy';
        const exePath = resolveCommandPath(command);
        const env = getExtendedEnv();

        console.log(`[AntigravityCliAdapter] Executing agent with command: "${command}", resolved path: "${exePath}"`);

        // システムプロンプトの組み立て
        let systemContext = `あなたは高品質な技術・業務ドキュメントの作成およびレビューを支援するエキスパートAIアシスタントです。\n`;
        systemContext += `作業コンテキストフォルダ: "${options.contextDir}"\n\n`;

        // 1. ドメイン・システム知識
        if (options.systemKnowledgeContent) {
            systemContext += `【ドメイン・システム知識 (${options.systemKnowledgeName || 'システム仕様'})】\n`;
            systemContext += `以下はこのシステムに関する恒久的な仕様、アーキテクチャ、過去のトラブル教訓、運用上の注意点です。ドキュメント作成時はこれらを必ず踏まえてください。\n`;
            systemContext += `--- 開始: システム知識 ---\n${options.systemKnowledgeContent}\n--- 終了: システム知識 ---\n\n`;
        }

        // 2. ドキュメントフォーマット・テンプレート
        if (options.templateContent) {
            systemContext += `【ドキュメントフォーマット・作成基準 (${options.templateTitle || '指定テンプレート'})】\n`;
            systemContext += `以下のフォーマット・章立て・記述基準に厳格に準拠してドキュメントを作成・更新してください。\n`;
            systemContext += `--- 開始: テンプレート ---\n${options.templateContent}\n--- 終了: テンプレート ---\n\n`;
        }

        // 3. contextDir 内のソースファイルを走査
        if (fs.existsSync(options.contextDir)) {
            const files = fs.readdirSync(options.contextDir);
            if (files.length > 0) {
                systemContext += `【インプットソースファイル（今回の個別情報・変更点・議事録など）】\n`;
                for (const file of files) {
                    const filePath = path.join(options.contextDir, file);
                    try {
                        const stat = fs.statSync(filePath);
                        if (stat.isFile()) {
                            const ext = path.extname(file).toLowerCase();
                            // テキスト形式のファイルを読み込んで直接埋め込む
                            if (['.txt', '.md', '.json', '.csv', '.js', '.ts', '.html', '.css', '.py', '.yaml', '.yml'].includes(ext)) {
                                const content = fs.readFileSync(filePath, 'utf-8');
                                systemContext += `--- ファイル: ${file} ---\n${content.slice(0, 20000)}\n\n`;
                            } else {
                                systemContext += `--- ファイル: ${file} (バイナリ/メディアファイル: ${ext}) ---\n\n`;
                            }
                        }
                    } catch (e) {
                        console.warn(`[AntigravityCliAdapter] Failed to read source file ${file}:`, e);
                    }
                }
            } else {
                systemContext += `【インプットソース】: ソースファイルはありません。\n\n`;
            }
        }

        systemContext += `【ユーザーの質問・指示】\n${userPrompt}\n\n`;
        systemContext += `丁寧かつ明瞭に回答してください。成果物（リリース計画書・レポート・要約・設計メモ等）を作成または修正する場合は、以下のように \`\`\`markdown:成果物タイトル.md の形式でファイル内容をコードブロックとして出力してください。\n`;
        systemContext += `※テンプレートが指定されている場合は、テンプレートの全セクション・章立てを網羅し、ドメイン知識の注意事項やインプットソースの情報を反映した完成度の高いMarkdownを出力してください。`;

        const escapedPrompt = escapePrompt(systemContext);
        const cmd = `"${exePath}" -p "${escapedPrompt}"`;

        console.log(`[AntigravityCliAdapter] Invoking CLI command...`);

        try {
            const { stdout, stderr } = await execAsync(cmd, {
                env,
                cwd: options.contextDir,
                maxBuffer: 10 * 1024 * 1024
            });

            if (stderr) {
                console.log(`[AntigravityCliAdapter] CLI stderr:`, stderr);
            }
            console.log(`[AntigravityCliAdapter] CLI stdout received (${stdout.length} chars)`);

            return {
                text: stdout.trim()
            };
        } catch (err: any) {
            console.error('[AntigravityCliAdapter] CLI execution error:', err);
            if (err.stdout && err.stdout.trim().length > 0) {
                console.log('[AntigravityCliAdapter] Falling back to err.stdout');
                return {
                    text: err.stdout.trim()
                };
            }
            throw new Error(`Antigravity CLI (${exePath}) 実行エラー: ${err.message || err}`);
        }
    }
}
