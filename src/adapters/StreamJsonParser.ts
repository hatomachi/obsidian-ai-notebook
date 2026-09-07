/**
 * Claude Code の `--output-format stream-json` (NDJSON) を読むためのアキュムレータ。
 *
 * 素の stdout ではエージェントが「何をしたか」が分からず、
 * ツールを呼んだのか / 呼んで拒否されたのか / そもそも呼んでいないのかを
 * 切り分けられなかった。イベントを読むことで、進捗表示・成果物検知・
 * セッションID取得・失敗時の原因特定がすべて事実ベースになる。
 */
export interface StreamJsonSummary {
    /** CLI 側の会話セッションID */
    sessionId?: string;
    /** 最終応答テキスト (result イベント。無ければ assistant のテキストを連結) */
    resultText: string;
    /** 実行されたツールの痕跡 (例: "Write artifacts/見積.md") */
    toolUses: string[];
    /** エラーを返したツール実行 (権限拒否もここに出る) */
    toolErrors: string[];
    isError: boolean;
    numTurns?: number;
    totalCostUsd?: number;
    /** JSON として解釈できなかった行 (プレーンテキスト出力へのフォールバック用) */
    rawLines: string[];
}

function describeToolUse(name: string, input: any): string {
    const target =
        input?.file_path || input?.path || input?.pattern || input?.command || input?.notebook_path;
    if (typeof target === 'string' && target.length > 0) {
        const short = target.length > 80 ? `${target.slice(0, 77)}...` : target;
        return `${name} ${short}`;
    }
    return name;
}

export class StreamJsonAccumulator {
    private buffer = '';
    private assistantText: string[] = [];
    private summary: StreamJsonSummary = {
        resultText: '',
        toolUses: [],
        toolErrors: [],
        isError: false,
        rawLines: []
    };

    constructor(private onProgress?: (line: string) => void) {}

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
    finish(): StreamJsonSummary {
        const rest = this.buffer.trim();
        this.buffer = '';
        if (rest) this.handleLine(rest);

        if (!this.summary.resultText) {
            this.summary.resultText = this.assistantText.join('\n').trim()
                || this.summary.rawLines.join('\n').trim();
        }
        return this.summary;
    }

    private handleLine(line: string): void {
        let event: any;
        try {
            event = JSON.parse(line);
        } catch (e) {
            // stream-json 未対応や想定外出力に備え、素のテキストとして保持する
            this.summary.rawLines.push(line);
            this.onProgress?.(line);
            return;
        }
        if (!event || typeof event !== 'object') return;

        if (typeof event.session_id === 'string') {
            this.summary.sessionId = event.session_id;
        }

        switch (event.type) {
            case 'assistant': {
                for (const block of event.message?.content || []) {
                    if (block.type === 'text' && block.text) {
                        this.assistantText.push(block.text);
                    } else if (block.type === 'tool_use') {
                        const desc = describeToolUse(block.name, block.input);
                        this.summary.toolUses.push(desc);
                        this.onProgress?.(`🔧 ${desc}`);
                    }
                }
                break;
            }
            case 'user': {
                for (const block of event.message?.content || []) {
                    if (block.type === 'tool_result' && block.is_error) {
                        const text = typeof block.content === 'string'
                            ? block.content
                            : JSON.stringify(block.content);
                        this.summary.toolErrors.push((text || '').slice(0, 300));
                    }
                }
                break;
            }
            case 'result': {
                if (typeof event.result === 'string') this.summary.resultText = event.result;
                if (event.is_error) this.summary.isError = true;
                if (typeof event.subtype === 'string' && event.subtype !== 'success') {
                    this.summary.isError = true;
                }
                if (typeof event.num_turns === 'number') this.summary.numTurns = event.num_turns;
                if (typeof event.total_cost_usd === 'number') this.summary.totalCostUsd = event.total_cost_usd;
                break;
            }
            default:
                break;
        }
    }
}
