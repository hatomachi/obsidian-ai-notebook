import { loadPdfJs } from 'obsidian';

export class PdfParser {
    /**
     * PDFバイナリデータを解析し、ページ番号ごとの構造化 Markdown テキストを生成
     */
    public static async parse(data: Buffer | ArrayBuffer, originalFilename: string): Promise<string> {
        const byteLen = Buffer.isBuffer(data) ? data.length : data.byteLength;
        if (!data || byteLen === 0) {
            throw new Error(`PDFデータが空（0バイト）です: ${originalFilename}`);
        }

        const uint8Array = Buffer.isBuffer(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data);

        let pdfjs: any;
        try {
            pdfjs = await loadPdfJs();
        } catch (e: any) {
            console.error('[PdfParser] loadPdfJs() の呼び出しに失敗しました:', e);
            throw new Error(`PDFエンジンの読み込みに失敗しました: ${e?.message || e}`);
        }

        let pdf: any;
        try {
            const loadingTask = pdfjs.getDocument({
                data: uint8Array,
                // Node.js テストや特定環境での cMap / フォント警告を抑制
                isEvalSupported: false,
                useSystemFonts: true
            });
            pdf = await loadingTask.promise;
        } catch (pdfErr: any) {
            console.error(`[PdfParser] PDFドキュメントの展開に失敗しました (${originalFilename}):`, pdfErr);
            throw new Error(`PDFの解析に失敗しました: ${pdfErr?.message || pdfErr}`);
        }

        const numPages: number = pdf.numPages || 0;
        const pageSections: string[] = [];

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            try {
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                
                const lines: string[] = [];
                let currentLine = '';
                let lastY: number | null = null;

                for (const item of textContent.items) {
                    if (!item || typeof item.str !== 'string') continue;
                    const text = item.str;
                    
                    // transform[5] は PDF 座標系における Y 座標
                    const y = Array.isArray(item.transform) ? item.transform[5] : null;

                    if (lastY !== null && y !== null && Math.abs(y - lastY) > 5) {
                        if (currentLine.trim()) {
                            lines.push(currentLine.trim());
                        }
                        currentLine = text;
                    } else {
                        currentLine += (currentLine ? ' ' : '') + text;
                    }
                    lastY = y;
                }

                if (currentLine.trim()) {
                    lines.push(currentLine.trim());
                }

                const pageText = lines.join('\n').trim();
                const contentText = pageText.length > 0
                    ? pageText
                    : '*(テキストなし / スキャン画像または図)*';

                pageSections.push(`## 📄 Page ${pageNum}\n\n${contentText}`);
            } catch (pageErr: any) {
                console.warn(`[PdfParser] ページ ${pageNum} の抽出でエラーが発生しました:`, pageErr);
                pageSections.push(`## 📄 Page ${pageNum}\n\n*(⚠️ ページ読み込みエラー: ${pageErr?.message || pageErr})*`);
            }
        }

        return [
            `# 📕 PDF 解析データ: ${originalFilename}`,
            `- **総ページ数**: ${numPages}`,
            '',
            '---',
            '',
            pageSections.join('\n\n---\n\n')
        ].join('\n');
    }
}
