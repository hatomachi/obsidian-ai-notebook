import { ExcelParser } from './ExcelParser';
import { DocxParser } from './DocxParser';
import { PptxParser } from './PptxParser';

export class TranscriptionService {
    private static readonly SUPPORTED_EXTENSIONS = new Set(['xlsx', 'xls', 'docx', 'pptx']);

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
    ): Promise<{ markdown: string; convertedFilename: string }> {
        const ext = originalFilename.split('.').pop()?.toLowerCase() || '';
        let markdown = '';

        switch (ext) {
            case 'xlsx':
            case 'xls':
                markdown = ExcelParser.parse(data, originalFilename);
                break;
            case 'docx':
                markdown = await DocxParser.parse(data, originalFilename);
                break;
            case 'pptx':
                markdown = await PptxParser.parse(data, originalFilename);
                break;
            default:
                throw new Error(`サポートされていないファイル形式です: .${ext}`);
        }

        const convertedFilename = `${originalFilename}.md`;
        return { markdown, convertedFilename };
    }
}
