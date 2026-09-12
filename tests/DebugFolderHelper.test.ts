import * as assert from 'assert';
import { TranscriptionService } from '../src/services/transcription/TranscriptionService';
import { DebugFolderHelper } from '../src/utils/debugFolderHelper';

async function runTests() {
    console.log('=== DebugFolderHelper & TranscriptionService 拡張テスト開始 ===');

    // Test 1: isTranscribable の対応形式検証 (xlsm 追加確認)
    console.log('Test 1: isTranscribable の検証');
    assert.strictEqual(TranscriptionService.isTranscribable('sample.xlsx'), true, 'xlsx は true');
    assert.strictEqual(TranscriptionService.isTranscribable('sample.XLSX'), true, '大文字 XLSX は true');
    assert.strictEqual(TranscriptionService.isTranscribable('macro.xlsm'), true, 'xlsm は true');
    assert.strictEqual(TranscriptionService.isTranscribable('doc.docx'), true, 'docx は true');
    assert.strictEqual(TranscriptionService.isTranscribable('slide.pptx'), true, 'pptx は true');
    assert.strictEqual(TranscriptionService.isTranscribable('paper.pdf'), true, 'pdf は true');
    assert.strictEqual(TranscriptionService.isTranscribable('paper.PDF'), true, '大文字 PDF は true');
    assert.strictEqual(TranscriptionService.isTranscribable('memo.md'), false, 'md は false');
    assert.strictEqual(TranscriptionService.isTranscribable('image.png'), false, 'png は false');
    console.log('  -> OK: 対応形式判定が正常です (xlsm/pdf対応含む)');

    // Test 2: transcribe 実行時の metrics 取得検証
    console.log('Test 2: transcribe 実行時の metrics 取得検証');
    // ExcelParser 用のダミーバイナリ（XLSX.utils でワークブックを作成してバッファ化）
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['列1', '列2'], ['A', 'B'], ['100', '200']]);
    XLSX.utils.book_append_sheet(wb, ws, 'テストシート');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const result = await TranscriptionService.transcribe(buf, 'test_sheet.xlsx');
    assert.strictEqual(result.convertedFilename, 'test_sheet.xlsx.md');
    assert.ok(result.markdown.includes('テストシート'), 'Markdownにシート名が含まれる');
    assert.ok(result.metrics, 'metrics が返される');
    assert.ok(typeof result.metrics?.durationMs === 'number', 'durationMs が数値');
    assert.ok(result.metrics?.lineCount! > 0, 'lineCount が正の数');
    assert.ok(result.metrics?.charCount! > 0, 'charCount が正の数');
    console.log(`  -> OK: パース所要時間 ${result.metrics?.durationMs}ms, 行数: ${result.metrics?.lineCount}, 文字数: ${result.metrics?.charCount}`);

    // Test 3: DebugFolderHelper ログ関数の例外安全性検証
    console.log('Test 3: DebugFolderHelper ログ関数の例外安全性検証');
    DebugFolderHelper.logPipelineStep('test.xlsx', 1, 'Event', 'D&D検知', { size: 1234 });
    DebugFolderHelper.logPipelineError('test.xlsx', 2, 'Read', new Error('テストエラー'), { retry: 1 });
    console.log('  -> OK: パイプラインログ関数が例外なく安全に動作');

    // Test 4: 不明拡張子での例外ハンドリング検証
    console.log('Test 4: 不明拡張子での例外ハンドリング検証');
    try {
        await TranscriptionService.transcribe(Buffer.from('test'), 'test.unknown');
        assert.fail('不明な拡張子で例外がスローされるべきです');
    } catch (err: any) {
        assert.ok(err.message.includes('サポートされていないファイル形式'), '適切なエラーメッセージ');
    }
    console.log('  -> OK: 不明拡張子ガード合格');

    console.log('=== 全デバッグ＆拡張テストに合格しました (All tests passed) ===');
}

runTests().catch(err => {
    console.error('Test Failed:', err);
    process.exit(1);
});
