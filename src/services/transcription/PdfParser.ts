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

        // Worker への Transferable 転送でメインスレッド側の元 ArrayBuffer が detach (切断) されるのを防ぐため、
        // 独立したメモリ領域にコピーを作成して pdfjs に渡す
        const sourceView = Buffer.isBuffer(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data);

        const copiedBytes = new Uint8Array(sourceView.byteLength);
        copiedBytes.set(sourceView);

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
                data: copiedBytes,
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
                        currentLine = PdfParser.joinTextFragments(currentLine, text);
                    }
                    lastY = y;
                }

                if (currentLine.trim()) {
                    lines.push(currentLine.trim());
                }

                const unwrappedLines = PdfParser.unwrapLines(lines);
                const pageText = unwrappedLines.join('\n').trim();
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

    /**
     * CJK（日本語・中国語・韓国語の文字・句読点・記号）判定
     */
    public static isCjkChar(ch: string): boolean {
        if (!ch) return false;
        return /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf]/.test(ch);
    }

    /**
     * 同一行内におけるテキストフラグメントの結合
     * CJK文字が隣接する場合はスペースなし、英数字同士等の場合はスペースを挿入
     */
    public static joinTextFragments(current: string, next: string): string {
        if (!current) return next;
        if (!next) return current;

        const lastChar = current.slice(-1);
        const firstChar = next.charAt(0);

        // 既にスペースが含まれている場合はそのまま結合
        if (/\s$/.test(current) || /^\s/.test(next)) {
            return current + next;
        }

        // CJK文字が関わる場合はスペースなしで直結
        if (PdfParser.isCjkChar(lastChar) || PdfParser.isCjkChar(firstChar)) {
            return current + next;
        }

        // 英数字同士などは半角スペースを挟む
        return current + ' ' + next;
    }

    /**
     * PDFの折り返し等で発生した不自然な改行をスマートに結合（アンラップ）する
     */
    public static unwrapLines(lines: string[]): string[] {
        if (!lines || lines.length === 0) return [];

        const result: string[] = [];

        // 新規箇条書き・リスト項目の判定
        const isListItemStart = (str: string): boolean => {
            const trimmed = str.trimStart();
            return (
                // Markdown リスト (- item, * item, + item, 1. item)
                /^([-*+]|\d+\.)\s+/.test(trimmed) ||
                // 丸数字 (①, ㉑, 等)
                /^[①-⑳㉑-㉟\u2460-\u2473\u24B6-\u24EA]/.test(trimmed) ||
                // 箇条書き記号 (・, ■, ◆, ●, ▲, ▼, ★, ☆, ※)
                /^[・■◆●▲▼★☆※]/.test(trimmed) ||
                // 括弧付き見出し・連番 ((1), （一）, 【重要】, [1])
                /^(\([0-9a-zA-Z一二三四五六七八九十]+\)|（[0-9a-zA-Z一二三四五六七八九十]+）|【[^】]+】|［[^］]+］|\[[^\]]+\])/.test(trimmed) ||
                // 条文・規程見出し (第1条, 第一章)
                /^第[0-9一二三四五六七八九十百千万]+[条章項節]/.test(trimmed)
            );
        };

        // 見出し判定
        const isHeading = (str: string): boolean => /^\s*#{1,6}\s/.test(str);

        // テーブル行判定
        const isTableLine = (str: string): boolean => /^\s*\|/.test(str);

        // コードブロック判定
        const isCodeBlock = (str: string): boolean => /^\s*```/.test(str);

        // 水平線判定
        const isHorizontalRule = (str: string): boolean => /^\s*[-*_]{3,}\s*$/.test(str);

        // 文末記号判定
        const endsWithTerminalPunctuation = (str: string): boolean => {
            const trimmed = str.trimEnd();
            // 句点、感嘆符、疑問符、コロン
            return /[。！？!?：:]$/.test(trimmed) ||
                // 英語文末ピリオド（数字のピリオド 3.14 等を除外するため直前が英字）
                /[a-zA-Z]\.$/.test(trimmed);
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            if (result.length === 0) {
                result.push(line);
                continue;
            }

            const prevIndex = result.length - 1;
            const prevLine = result[prevIndex];
            const trimmedPrev = prevLine.trim();

            // 直前が空行、または現在行が空行の場合は段落区切りとしてそのまま
            if (!trimmedPrev || !trimmedLine) {
                result.push(line);
                continue;
            }

            // 見出し、水平線、テーブル、コードブロックは結合対象外
            if (
                isHeading(prevLine) || isHeading(line) ||
                isHorizontalRule(prevLine) || isHorizontalRule(line) ||
                isTableLine(prevLine) || isTableLine(line) ||
                isCodeBlock(prevLine) || isCodeBlock(line)
            ) {
                result.push(line);
                continue;
            }

            // 直前行が句点・コロン・文末記号で終わっている場合は文の区切りなので結合しない
            if (endsWithTerminalPunctuation(trimmedPrev)) {
                result.push(line);
                continue;
            }

            // 現在行が明確な新規箇条書きや項目で始まっている場合は結合しない
            if (isListItemStart(line)) {
                result.push(line);
                continue;
            }

            // --- 結合処理（アンラップ） ---
            const lastChar = trimmedPrev.slice(-1);
            const firstChar = trimmedLine.charAt(0);

            // 英語ハイフネーション (例: "inter-" + "esting")
            if (/[a-zA-Z]-$/.test(trimmedPrev) && /^[a-zA-Z]/.test(trimmedLine)) {
                result[prevIndex] = prevLine.slice(0, prevLine.lastIndexOf('-')) + trimmedLine;
                continue;
            }

            // CJK文字が関わる場合（日本語同士、または日本語と英数字）はスペースなしで結合
            if (PdfParser.isCjkChar(lastChar) || PdfParser.isCjkChar(firstChar)) {
                result[prevIndex] = prevLine + trimmedLine;
                continue;
            }

            // 英数字同士などの場合は半角スペース1つで結合
            result[prevIndex] = prevLine + ' ' + trimmedLine;
        }

        return result;
    }
}
