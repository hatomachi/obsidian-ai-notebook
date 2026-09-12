import { ExcelParser } from './ExcelParser';
import { DocxParser } from './DocxParser';
import { PptxParser } from './PptxParser';
import { PdfParser } from './PdfParser';

export class TranscriptionService {
    private static readonly SUPPORTED_EXTENSIONS = new Set(['xlsx', 'xls', 'xlsm', 'docx', 'pptx', 'pdf']);

    /**
     * 指定されたファイルが決定的変換（Transcription）対象かを判定
     */
    public static isTranscribable(filename: string): boolean {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        return this.SUPPORTED_EXTENSIONS.has(ext);
    }

    /**
     * バイナリデータを解析し、構造化 Markdown と変換後ファイル名を返却
     */
    public static async transcribe(
        data: Buffer | ArrayBuffer,
        originalFilename: string
    ): Promise<{ markdown: string; convertedFilename: string; metrics?: { durationMs: number; lineCount: number; charCount: number } }> {
        const ext = originalFilename.split('.').pop()?.toLowerCase() || '';
        const startTime = Date.now();
        let markdown = '';

        try {
            switch (ext) {
                case 'xlsx':
                case 'xls':
                case 'xlsm':
                    markdown = ExcelParser.parse(data, originalFilename);
                    break;
                case 'docx':
                    markdown = await DocxParser.parse(data, originalFilename);
                    break;
                case 'pptx':
                    markdown = await PptxParser.parse(data, originalFilename);
                    break;
                case 'pdf':
                    markdown = await PdfParser.parse(data, originalFilename);
                    break;
                default:
                    throw new Error(`サポートされていないファイル形式です: .${ext}`);
            }
        } catch (parseError: any) {
            const bufferLen = Buffer.isBuffer(data) ? data.length : data.byteLength;
            console.error(`[TranscriptionService] Failed to parse ${originalFilename} (.${ext}, ${bufferLen} bytes):`, parseError);
            throw new Error(`[${ext.toUpperCase()}パース失敗] ${parseError?.message || parseError}`);
        }

        const durationMs = Date.now() - startTime;
        const lineCount = markdown.split('\n').length;
        const charCount = markdown.length;
        const convertedFilename = `${originalFilename}.md`;

        return { 
            markdown, 
            convertedFilename,
            metrics: { durationMs, lineCount, charCount }
        };
    }
}
