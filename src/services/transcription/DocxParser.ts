import * as mammoth from 'mammoth';

export class DocxParser {
    /**
     * Word ドキュメント (.docx) から構造化 Markdown を生成
     */
    public static async parse(data: Buffer | ArrayBuffer, originalFilename: string): Promise<string> {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buffer.length === 0) {
            throw new Error('ファイルデータが空（0バイト）です。ファイルが正しく保存・同期されているか確認してください。');
        }
        
        try {
            // Mammoth で Markdown への変換を試行 (mammoth.convertToMarkdown または convertToHtml)
            const result = await (mammoth as any).convertToMarkdown({ buffer });
            const markdownBody = result.value || '';
            const messages = result.messages || [];

            const lines: string[] = [];
            lines.push(`# 📄 Word 解析データ: ${originalFilename}`);
            if (messages.length > 0) {
                const warnings = messages.filter((m: any) => m.type === 'warning').map((m: any) => m.message);
                if (warnings.length > 0) {
                    lines.push(`> [!NOTE]\n> 変換時の注記: ${warnings.join('; ')}`);
                }
            }
            lines.push('');
            lines.push(markdownBody);

            return lines.join('\n');
        } catch (error: any) {
            // フォールバック: raw text 抽出
            try {
                const rawResult = await (mammoth as any).extractRawText({ buffer });
                return `# 📄 Word 解析データ: ${originalFilename}\n\n${rawResult.value || ''}`;
            } catch (fallbackError: any) {
                throw new Error(`Word ファイルのパースに失敗しました: ${error.message}`);
            }
        }
    }
}
