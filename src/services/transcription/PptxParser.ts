import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

export class PptxParser {
    /**
     * PowerPoint (.pptx) から構造化 Markdown を生成（スライド階層・箇条書き・発表者ノート）
     */
    public static async parse(data: Buffer | ArrayBuffer, originalFilename: string): Promise<string> {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buffer.length === 0) {
            throw new Error('ファイルデータが空（0バイト）です。ファイルが正しく保存・同期されているか確認してください。');
        }

        const zip = await JSZip.loadAsync(buffer);
        const xmlParser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_'
        });

        // スライドファイルの特定 (ppt/slides/slide1.xml, slide2.xml, ...)
        const slideFiles = Object.keys(zip.files)
            .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
            .sort((a, b) => {
                const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
                const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
                return numA - numB;
            });

        const lines: string[] = [];
        lines.push(`# 📑 PowerPoint 解析データ: ${originalFilename}`);
        lines.push(`- **総スライド数**: ${slideFiles.length}`);
        lines.push('');

        for (let i = 0; i < slideFiles.length; i++) {
            const slideFile = slideFiles[i];
            const slideIndex = i + 1;

            try {
                const slideXml = await zip.files[slideFile].async('string');
                const slideData = xmlParser.parse(slideXml);

                const slideTexts = PptxParser.extractTextsFromXml(slideData);

                // スライドタイトル（最初の非空テキスト）と本文の分離
                const title = slideTexts[0] || `スライド ${slideIndex}`;
                const bodyTexts = slideTexts.slice(1);

                lines.push(`## 🖼️ Slide ${slideIndex}: ${title}`);
                lines.push('');

                if (bodyTexts.length > 0) {
                    for (const text of bodyTexts) {
                        lines.push(`- ${text}`);
                    }
                    lines.push('');
                }

                // 対応するスライドノートの探索 (slideIndex または notesSlideN.xml)
                const noteFileCandidate = `ppt/notesSlides/notesSlide${slideIndex}.xml`;
                if (zip.files[noteFileCandidate]) {
                    try {
                        const noteXml = await zip.files[noteFileCandidate].async('string');
                        const noteData = xmlParser.parse(noteXml);
                        const noteTexts = PptxParser.extractTextsFromXml(noteData);
                        // ヘッダーやスライド番号を除く
                        const actualNotes = noteTexts.filter(t => t !== String(slideIndex) && t !== title && !t.includes('Slide '));
                        if (actualNotes.length > 0) {
                            lines.push('> [!NOTE]');
                            lines.push('> **発表者ノート (Notes / 口頭説明・暗黙知):**');
                            for (const note of actualNotes) {
                                lines.push(`> ${note}`);
                            }
                            lines.push('');
                        }
                    } catch (noteErr) {
                        console.warn(`Slide ${slideIndex} ノート解析スキップ:`, noteErr);
                    }
                }
            } catch (slideErr: any) {
                console.warn(`Slide ${slideIndex} 解析失敗 (部分救済):`, slideErr);
                lines.push(`## 🖼️ Slide ${slideIndex}: (スライド ${slideIndex})`);
                lines.push(`> [!WARNING] このスライドのテキスト抽出中にエラーが発生しました: ${slideErr?.message || slideErr}`);
                lines.push('');
            }
        }

        return lines.join('\n');
    }

    /**
     * XML オブジェクトを再帰的に走査し、テキスト要素 (<a:t>) を収集
     */
    private static extractTextsFromXml(obj: any): string[] {
        const results: string[] = [];

        function traverse(node: any) {
            if (!node) return;
            if (typeof node === 'string') return;

            // <a:p> (段落) 内のテキストを抽出
            if (node['a:p']) {
                const paragraphs = Array.isArray(node['a:p']) ? node['a:p'] : [node['a:p']];
                for (const p of paragraphs) {
                    const pText = PptxParser.extractParagraphText(p);
                    if (pText.trim()) {
                        results.push(pText.trim());
                    }
                }
            }

            for (const key of Object.keys(node)) {
                if (key === 'a:p') continue; // 既に処理済み
                const val = node[key];
                if (Array.isArray(val)) {
                    for (const item of val) {
                        traverse(item);
                    }
                } else if (typeof val === 'object') {
                    traverse(val);
                }
            }
        }

        traverse(obj);
        return results;
    }

    private static extractParagraphText(pNode: any): string {
        const pieces: string[] = [];

        function findRuns(node: any) {
            if (!node) return;
            if (node['a:t'] !== undefined) {
                const text = typeof node['a:t'] === 'object' ? node['a:t']['#text'] || '' : String(node['a:t']);
                pieces.push(text);
                return;
            }
            if (node['a:fld'] && node['a:fld']['a:t']) {
                pieces.push(String(node['a:fld']['a:t']));
                return;
            }

            for (const key of Object.keys(node)) {
                const val = node[key];
                if (Array.isArray(val)) {
                    for (const item of val) findRuns(item);
                } else if (typeof val === 'object') {
                    findRuns(val);
                }
            }
        }

        findRuns(pNode);
        return pieces.join('');
    }
}
