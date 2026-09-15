import * as path from 'path';
import * as fs from 'fs';
import * as assert from 'assert';
import { PptxParser } from '../src/services/transcription/PptxParser';
import { DocxParser } from '../src/services/transcription/DocxParser';
import { ExcelParser } from '../src/services/transcription/ExcelParser';
import { TranscriptionService } from '../src/services/transcription/TranscriptionService';

async function runRobustnessTest() {
    console.log('=== TASK-027 堅牢性 & 異常系テスト開始 ===\n');
    const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures/sample_estimates');

    // 1. 0バイト空ファイルのガード検証
    console.log('Step 1: 0バイト空ファイル投入時のガード検証');
    const emptyBuf = Buffer.alloc(0);

    await assert.rejects(
        async () => await PptxParser.parse(emptyBuf, 'empty.pptx'),
        /0バイト/,
        'PptxParser が 0バイトファイルに対して分かりやすいエラーをスローすること'
    );
    console.log('  -> PptxParser: 0バイトガード合格');

    await assert.rejects(
        async () => await DocxParser.parse(emptyBuf, 'empty.docx'),
        /0バイト/,
        'DocxParser が 0バイトファイルに対して分かりやすいエラーをスローすること'
    );
    console.log('  -> DocxParser: 0バイトガード合格');

    assert.throws(
        () => ExcelParser.parse(emptyBuf, 'empty.xlsx'),
        /0バイト/,
        'ExcelParser が 0バイトファイルに対して分かりやすいエラーをスローすること'
    );
    console.log('  -> ExcelParser: 0バイトガード合格');

    // 2. 破損ZIPファイルの検証
    console.log('\nStep 2: 破損ZIPファイル投入時の例外ハンドリング検証');
    const corruptedPptxPath = path.join(fixturesDir, '07_異常系_破損ZIP切断.pptx');
    if (fs.existsSync(corruptedPptxPath)) {
        const corruptedBuf = fs.readFileSync(corruptedPptxPath);
        await assert.rejects(
            async () => await PptxParser.parse(corruptedBuf, '07_異常系_破損ZIP切断.pptx'),
            '破損ZIPに対して例外がスローされること'
        );
        console.log('  -> 破損ZIP: 正常に例外検出合格');
    }

    // 3. 複雑構造PPTX（表・図形・複数スライド）のパース検証
    console.log('\nStep 3: 複雑構造PPTX（表・図形・スライド）のパース検証');
    const complexPptxPath = path.join(fixturesDir, '08_複雑構造_表と図形スライド.pptx');
    if (fs.existsSync(complexPptxPath)) {
        const complexBuf = fs.readFileSync(complexPptxPath);
        const md = await PptxParser.parse(complexBuf, '08_複雑構造_表と図形スライド.pptx');
        console.log('--- 生成Markdown抜粋 ---');
        console.log(md);
        console.log('--- 抜粋ここまで ---');

        assert.ok(md.includes('複雑構造スライド'), 'スライドタイトルが含まれること');
        assert.ok(md.includes('項目名') || md.includes('仕様・パラメータ') || md.includes('最大同時接続数'), '表内のテキストが抽出されていること');
        console.log('  -> 複雑PPTX抽出: 合格');
    }

    // 4. 正常系PPTX（スライドノート・暗黙知付き）の検証
    console.log('\nStep 4: 正常系PPTX（スライドノート付き）の検証');
    const normalPptxPath = path.join(fixturesDir, '04_提案書_システム方式設計_抜粋.pptx');
    if (fs.existsSync(normalPptxPath)) {
        const normalBuf = fs.readFileSync(normalPptxPath);
        const { markdown, convertedFilename } = await TranscriptionService.transcribe(normalBuf, '04_提案書_システム方式設計_抜粋.pptx');
        assert.strictEqual(convertedFilename, '04_提案書_システム方式設計_抜粋.pptx.md');
        assert.ok(markdown.includes('Stranglerパターン'), 'スライドテキストが含まれること');
        assert.ok(markdown.includes('発表者ノート'), '発表者ノートが含まれること');
        console.log('  -> 正常系PPTX & ノート抽出: 合格');
    }

    // 5. 正常系DOCX（Word文書）のパース検証
    console.log('\nStep 5: 正常系DOCX（Word文書）のパース検証');
    const normalDocxPath = path.join(fixturesDir, '05_要件定義書_非機能要件_サンプル.docx');
    if (fs.existsSync(normalDocxPath)) {
        const docxBuf = fs.readFileSync(normalDocxPath);
        const { markdown, convertedFilename } = await TranscriptionService.transcribe(docxBuf, '05_要件定義書_非機能要件_サンプル.docx');
        assert.strictEqual(convertedFilename, '05_要件定義書_非機能要件_サンプル.docx.md');
        assert.ok(markdown.includes('# 📄 Word 解析データ: 05_要件定義書_非機能要件_サンプル.docx'), 'Word解析見出しが含まれること');
        assert.ok(markdown.length > 50, 'Markdown本文が抽出されていること');
        console.log('  -> 正常系DOCX抽出: 合格');
    }

    // 6. esbuild/ブラウザ環境（browser/unzip.js）互換性検証: mammothにarrayBufferが渡されていることの検証
    console.log('\nStep 6: DocxParser の browser/unzip.js 互換性（arrayBuffer オプション）検証');
    const mammoth = require('mammoth');
    let capturedDocxOptions: any = null;
    const origConvertToMarkdown = mammoth.convertToMarkdown;
    mammoth.convertToMarkdown = async (opts: any) => {
        capturedDocxOptions = opts;
        return await origConvertToMarkdown.call(mammoth, opts);
    };

    try {
        if (fs.existsSync(normalDocxPath)) {
            const docxBuf = fs.readFileSync(normalDocxPath);
            await DocxParser.parse(docxBuf, 'test_mammoth_opts.docx');
            assert.ok(capturedDocxOptions, 'mammoth にオプションが渡されていること');
            assert.ok(capturedDocxOptions.arrayBuffer instanceof ArrayBuffer, 'options.arrayBuffer が ArrayBuffer インスタンスであること（esbuild browser/unzip.js 互換）');
            assert.ok(Buffer.isBuffer(capturedDocxOptions.buffer), 'options.buffer が Buffer インスタンスであること（Node lib/unzip.js 互換）');
            console.log('  -> browser/unzip.js (arrayBuffer) & lib/unzip.js (buffer) 両対応オプション検証: 合格');
        }
    } finally {
        mammoth.convertToMarkdown = origConvertToMarkdown;
    }

    console.log('\n=== 全堅牢性・異常系テストに合格しました ===');
}

runRobustnessTest().catch(err => {
    console.error('Robustness test failed:', err);
    process.exit(1);
});
