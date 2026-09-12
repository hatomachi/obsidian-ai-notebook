import * as assert from 'assert';
import { PdfParser } from '../src/services/transcription/PdfParser';
import { TranscriptionService } from '../src/services/transcription/TranscriptionService';
import { __setMockPdfJs } from './mocks/obsidian';

async function runTests() {
    console.log('=== PdfParser & PDF Transcription テスト開始 ===');

    // Test 1: PdfParser 正常系テキスト抽出
    console.log('Test 1: PdfParser 正常系 Markdown 生成');
    const dummyPdfData = Buffer.from('%PDF-1.4 dummy pdf header and content');
    const markdown = await PdfParser.parse(dummyPdfData, 'architecture_overview.pdf');

    assert.ok(markdown.includes('# 📕 PDF 解析データ: architecture_overview.pdf'), 'タイトルが含まれる');
    assert.ok(markdown.includes('- **総ページ数**: 2'), '総ページ数が含まれる');
    assert.ok(markdown.includes('## 📄 Page 1'), 'Page 1 見出しが含まれる');
    assert.ok(markdown.includes('Page 1 Title'), 'Page 1 本文が含まれる');
    assert.ok(markdown.includes('## 📄 Page 2'), 'Page 2 見出しが含まれる');
    assert.ok(markdown.includes('Page 2 Title'), 'Page 2 本文が含まれる');
    console.log('  -> OK: 正常系テキスト抽出正常');

    // Test 2: TranscriptionService 経由での PDF 透過的実行
    console.log('Test 2: TranscriptionService.transcribe 経由での PDF 実行');
    const transResult = await TranscriptionService.transcribe(dummyPdfData, 'specification.pdf');
    assert.strictEqual(transResult.convertedFilename, 'specification.pdf.md');
    assert.ok(transResult.markdown.includes('# 📕 PDF 解析データ: specification.pdf'));
    assert.ok(transResult.metrics, 'metrics が返却される');
    assert.ok(transResult.metrics.lineCount > 0, 'lineCount が正の数');
    assert.ok(transResult.metrics.charCount > 0, 'charCount が正の数');
    console.log(`  -> OK: 変換成功 (所要時間: ${transResult.metrics.durationMs}ms, 行数: ${transResult.metrics.lineCount})`);

    // Test 3: 0バイト空ファイルの例外ガード
    console.log('Test 3: 0バイト空ファイルの例外ガード');
    let zeroByteErrorCaught = false;
    try {
        await PdfParser.parse(Buffer.alloc(0), 'empty.pdf');
    } catch (err: any) {
        zeroByteErrorCaught = true;
        assert.ok(err.message.includes('0バイト'), '0バイトエラーメッセージ');
    }
    assert.strictEqual(zeroByteErrorCaught, true, '0バイト例外が検知されること');
    console.log('  -> OK: 0バイトガード正常');

    // Test 4: テキストなし（スキャン画像PDF）のプレースホルダー検証
    console.log('Test 4: 空白ページ / スキャン画像PDF のプレースホルダー検証');
    __setMockPdfJs({
        getDocument: () => ({
            promise: Promise.resolve({
                numPages: 1,
                getPage: async () => ({
                    getTextContent: async () => ({ items: [] })
                })
            })
        })
    });

    const emptyPageMarkdown = await PdfParser.parse(dummyPdfData, 'scanned_drawing.pdf');
    assert.ok(emptyPageMarkdown.includes('*(テキストなし / スキャン画像または図)*'), 'プレースホルダーが含まれる');
    console.log('  -> OK: スキャン画像プレースホルダー正常');

    // モックのリセット
    __setMockPdfJs(null);

    console.log('=== 全 PdfParser テストに合格しました (All tests passed) ===');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
