/**
 * GitHub Copilot CLI の `--output-format json` (NDJSON) を読むためのアキュムレータ。
 *
 * Copilot CLI は 1 行 1 JSON オブジェクトのストリームを出力する。
 * 各イベントから以下を抽出する:
 * - `assistant.message_delta`: リアルタイム回答テキスト片 (data.deltaContent)
 * - `tool.execution_start` / `tool.execution_complete`: 実行ツール痕跡・エラー
 * - `assistant.message`: 回答本文
 * - `result`: 最終セッションID (sessionId), exitCode, usage
 */
export interface CopilotStreamSummary {
    /** CLI 側の会話セッションID */
    sessionId?: string;
    /** 最終応答テキスト */
    resultText: string;
    /** 実行されたツールの痕跡 (例: "apply_patch hello.txt") */
    toolUses: string[];
    /** エラーを返したツール実行 */
    toolErrors: string[];
    isError: boolean;
    exitCode?: number;
    /** JSON として解釈できなかった行 (プレーンテキスト出力へのフォールバック用) */
    rawLines: string[];
}

export function describeCopilotToolUse(name: string, args: any): string {
    if (typeof args === 'string') {
        if (name === 'apply_patch') {
            const m = args.match(/\*\*\*\s*(?:Add|Update|Delete)\s*File:\s*([^\r\n]+)/i);
            if (m) return `${name} ${m[1].trim()}`;
        }
        const short = args.trim().replace(/\s+/g, ' ');
        if (short.length > 0) {
            return `${name} ${short.length > 80 ? short.slice(0, 77) + '...' : short}`;
        }
        return name;
    } else if (args && typeof args === 'object') {
        const target = args.path || args.file_path || args.command || args.pattern || args.query;
        if (typeof target === 'string' && target.length > 0) {
            const short = target.length > 80 ? `${target.slice(0, 77)}...` : target;
            return `${name} ${short}`;
        }
    }
    return name;
}

export class CopilotStreamJsonAccumulator {
    private buffer = '';
    private assistantDeltas: string[] = [];
    private lastAssistantMessage = '';
    private summary: CopilotStreamSummary = {
        resultText: '',
        toolUses: [],
        toolErrors: [],
        isError: false,
        rawLines: []
    };

    constructor(private onProgress?: (chunk: string) => void) {}

    push(chunk: string): void {
        this.buffer += chunk;
        let idx: number;
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, idx).trim();
            this.buffer = this.buffer.slice(idx + 1);
            if (line) this.handleLine(line);
        }
    }

    /** ストリーム終了時に、改行で終わっていない残りを処理する */
    finish(): CopilotStreamSummary {
        const rest = this.buffer.trim();
        this.buffer = '';
        if (rest) this.handleLine(rest);

        if (!this.summary.resultText) {
            this.summary.resultText = this.lastAssistantMessage
                || this.assistantDeltas.join('').trim()
                || this.summary.rawLines.join('\n').trim();
        }
        return this.summary;
    }

    private handleLine(line: string): void {
        let event: any;
        try {
            event = JSON.parse(line);
        } catch (e) {
            this.summary.rawLines.push(line);
            this.onProgress?.(line);
            return;
        }
        if (!event || typeof event !== 'object') return;

        // セッションIDの捕捉 (event.sessionId または data.sessionId)
        if (typeof event.sessionId === 'string' && event.sessionId) {
            this.summary.sessionId = event.sessionId;
        } else if (typeof event.data?.sessionId === 'string' && event.data.sessionId) {
            this.summary.sessionId = event.data.sessionId;
        }

        switch (event.type) {
            case 'assistant.message_delta': {
                const delta = event.data?.deltaContent;
                if (typeof delta === 'string') {
                    this.assistantDeltas.push(delta);
                    this.onProgress?.(delta);
                }
                break;
            }
            case 'assistant.message': {
                const content = event.data?.content;
                if (typeof content === 'string' && content.trim().length > 0) {
                    this.lastAssistantMessage = content;
                }
                break;
            }
            case 'tool.execution_start': {
                const toolName = event.data?.toolName || 'tool';
                const toolArgs = event.data?.arguments;
                const desc = describeCopilotToolUse(toolName, toolArgs);
                this.summary.toolUses.push(desc);
                this.onProgress?.(`\n🔧 ${desc}\n`);
                break;
            }
            case 'tool.execution_complete': {
                if (event.data?.success === false || event.data?.error) {
                    const err = event.data?.error;
                    const msg = typeof err === 'string'
                        ? err
                        : err?.message || JSON.stringify(err || 'Tool execution failed');
                    this.summary.toolErrors.push(msg.slice(0, 300));
                }
                break;
            }
            case 'result': {
                if (typeof event.exitCode === 'number') {
                    this.summary.exitCode = event.exitCode;
                    if (event.exitCode !== 0) {
                        this.summary.isError = true;
                    }
                }
                if (typeof event.sessionId === 'string') {
                    this.summary.sessionId = event.sessionId;
                }
                break;
            }
            default:
                break;
        }
    }
}
