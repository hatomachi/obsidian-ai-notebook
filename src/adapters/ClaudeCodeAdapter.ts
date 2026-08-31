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

        let systemContext = `あなたは高品質な技術・業務ドキュメントの作成およびレビューを支援するエキスパートAIアシスタントです。\n`;
        systemContext += `作業コンテキストフォルダ: "${options.contextDir}"\n\n`;

        // 1. リンクされた参照コンテキスト (Linked Notebooks)
        if (options.linkedContexts && options.linkedContexts.length > 0) {
            systemContext += `【参照コンテキスト（Linked Notebooks / 知識・ルール・過去サンプル）】\n`;
            systemContext += `以下はこのタスクに関連付けられた別のノートブックから読み込まれた成果物（システム仕様、ドキュメントルール、高品質サンプル等）です。これらを深く理解し、用語・章立て・注意点・過去トラブル教訓をドキュメント生成に完全に反映してください。\n\n`;

            for (const ctx of options.linkedContexts) {
                systemContext += `### 📘 参照ノートブック: "${ctx.notebookTitle}"\n`;
                if (ctx.description) {
                    systemContext += `説明: ${ctx.description}\n`;
                }
                if (ctx.artifacts.length > 0) {
                    for (const art of ctx.artifacts) {
                        systemContext += `\n--- 成果物: ${art.title} (${art.name}) ---\n`;
                        systemContext += `${art.content}\n`;
                        systemContext += `--- 終了: ${art.title} ---\n`;
                    }
                } else {
                    systemContext += `(この参照ノートブックにはまだ成果物がありません)\n`;
                }
                systemContext += `\n`;
            }
        }

        // 2. ドメイン・システム知識 (後方互換)
        if (options.systemKnowledgeContent) {
            systemContext += `【ドメイン・システム知識 (${options.systemKnowledgeName || 'システム仕様'})】\n`;
            systemContext += `以下はこのシステムに関する恒久的な仕様、アーキテクチャ、過去のトラブル教訓、運用上の注意点です。ドキュメント作成時はこれらを必ず踏まえてください。\n`;
            systemContext += `--- 開始: システム知識 ---\n${options.systemKnowledgeContent}\n--- 終了: システム知識 ---\n\n`;
        }

        // 3. ドキュメントフォーマット・テンプレート (後方互換)
        if (options.templateContent) {
            systemContext += `【ドキュメントフォーマット・作成基準 (${options.templateTitle || '指定テンプレート'})】\n`;
            systemContext += `以下のフォーマット・章立て・記述基準に厳格に準拠してドキュメントを作成・更新してください。\n`;
            systemContext += `--- 開始: テンプレート ---\n${options.templateContent}\n--- 終了: テンプレート ---\n\n`;
        }

        // 4. contextDir 内のソースファイル (直接投入ファイル) を走査
        if (fs.existsSync(options.contextDir)) {
            const files = fs.readdirSync(options.contextDir);
            if (files.length > 0) {
                systemContext += `【インプットソースファイル（今回のタスク固有の個別情報・PR差分・議事録など）】\n`;
                for (const file of files) {
                    const filePath = path.join(options.contextDir, file);
                    try {
                        const stat = fs.statSync(filePath);
                        if (stat.isFile()) {
                            const ext = path.extname(file).toLowerCase();
                            // テキスト形式のファイルを読み込んで直接埋め込む
                            if (['.txt', '.md', '.json', '.csv', '.js', '.ts', '.html', '.css', '.py', '.yaml', '.yml', '.patch', '.diff'].includes(ext)) {
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
                systemContext += `【インプットソース】: 直接投入されたソースファイルはありません。\n\n`;
            }
        }

        // 5. 会話履歴 (Chat History) の展開
        if (options.chatHistory && options.chatHistory.length > 0) {
            const validHistory = options.chatHistory.filter(m => m.text && !m.text.startsWith('思考中...'));
            if (validHistory.length > 0) {
                systemContext += `【これまでの対話履歴（セッションの文脈）】\n`;
                const recentHistory = validHistory.slice(-15);
                for (const msg of recentHistory) {
                    const senderLabel = msg.sender === 'user' ? 'ユーザー' : 'AI';
                    systemContext += `${senderLabel}: ${msg.text}\n\n`;
                }
                systemContext += `--- 対話履歴ここまで ---\n\n`;
            }
        }

        systemContext += `【今回のユーザー質問・指示】\n${userPrompt}\n\n`;
        systemContext += `丁寧かつ明瞭に回答してください。成果物（リリース計画書・レポート・要約・設計メモ等）を作成または修正する場合は、以下のように \`\`\`markdown:成果物タイトル.md の形式でファイル内容をコードブロックとして出力してください。\n`;
        systemContext += `※参照コンテキスト（Linked Notebooks）に仕様やルール・サンプルが含まれている場合は、それらの章立て・注意事項・フォーマットに厳格に準拠した完成度の高いMarkdownを出力してください。`;

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
