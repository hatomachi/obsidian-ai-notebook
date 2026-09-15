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

    // Test 5: pdfjs に渡される Uint8Array が独立したコピーであり、元の ArrayBuffer が detach されないことの検証
    console.log('Test 5: pdfjs Worker 転送時の ArrayBuffer detach 防止（メモリクローン）検証');
    let capturedData: any = null;
    __setMockPdfJs({
        getDocument: (params: any) => {
            capturedData = params.data;
            // 仮想的に渡された ArrayBuffer を変更またはシミュレート
            return {
                promise: Promise.resolve({
                    numPages: 1,
                    getPage: async () => ({
                        getTextContent: async () => ({ items: [{ str: 'Detached-Proof Content' }] })
                    })
                })
            };
        }
    });

    const testOriginalBuffer = Buffer.from('%PDF-1.4 test detach prevention buffer');
    const originalArrayBuffer = testOriginalBuffer.buffer;
    const originalByteLength = testOriginalBuffer.length;

    const detachProofMd = await PdfParser.parse(testOriginalBuffer, 'safe_buffer.pdf');
    assert.ok(detachProofMd.includes('Detached-Proof Content'), 'コンテンツが抽出される');
    assert.ok(capturedData instanceof Uint8Array, 'pdfjs に Uint8Array が渡されている');
    assert.notStrictEqual(capturedData.buffer, originalArrayBuffer, 'pdfjs に渡された buffer は元の ArrayBuffer と別インスタンスであること（クローン保護）');
    assert.strictEqual(testOriginalBuffer.length, originalByteLength, '元の Buffer の長さが保持されていること');
    // 元の ArrayBuffer を使って新しく Uint8Array が構築可能であること（detach されていないことの証明）
    assert.doesNotThrow(() => {
        new Uint8Array(originalArrayBuffer);
    }, '元の ArrayBuffer が detached になっていないこと');
    console.log('  -> OK: メモリクローンにより元の ArrayBuffer が完全保護されていることを確認');

    // モックのリセット
    __setMockPdfJs(null);

    // Test 6: unwrapLines のスマート結合（日本語折り返し・箇条書き・句点・ハイフネーション）検証
    console.log('Test 6: unwrapLines によるスマート結合・アンラップ検証');
    // (a) ユーザー課題ケース: 「⑥ 事」+「後申請・承認理由」の結合
    const caseA = PdfParser.unwrapLines(['⑥ 事', '後申請・承認理由']);
    assert.strictEqual(caseA.length, 1);
    assert.strictEqual(caseA[0], '⑥ 事後申請・承認理由');
    assert.ok(caseA[0].includes('事後申請'), '「事後申請」で検索ヒットすること');

    // (b) 通常の日本語文章の折り返し
    const caseB = PdfParser.unwrapLines([
        '本システムは社内業務の効率化を目的として',
        '開発されたワークスペースツールです。'
    ]);
    assert.strictEqual(caseB.length, 1);
    assert.strictEqual(caseB[0], '本システムは社内業務の効率化を目的として開発されたワークスペースツールです。');

    // (c) 句点（。）で終わる場合は改行を維持
    const caseC = PdfParser.unwrapLines([
        '第1フェーズの検証は完了しました。',
        '続いて第2フェーズの開発に着手します。'
    ]);
    assert.strictEqual(caseC.length, 2);
    assert.strictEqual(caseC[0], '第1フェーズの検証は完了しました。');
    assert.strictEqual(caseC[1], '続いて第2フェーズの開発に着手します。');

    // (d) 箇条書き・リスト（-, 1., ①, ・, 【】）の改行維持
    const caseD = PdfParser.unwrapLines([
        '- 項目Aの概要',
        '- 項目Bの概要',
        '① 事前準備',
        '② 承認手続き',
        '【重要】注意事項の確認'
    ]);
    assert.strictEqual(caseD.length, 5);

    // (e) 箇条書き項目の途中で折り返された場合は正しく結合
    const caseE = PdfParser.unwrapLines([
        '- 申請理由：全社共通プロキシ環境下での',
        'ネットワーク通信トラブルを解消するため。',
        '- 完了条件：全テストのパス'
    ]);
    assert.strictEqual(caseE.length, 2);
    assert.strictEqual(caseE[0], '- 申請理由：全社共通プロキシ環境下でのネットワーク通信トラブルを解消するため。');
    assert.strictEqual(caseE[1], '- 完了条件：全テストのパス');

    // (f) 英語ハイフネーション結合と英単語間スペース
    const caseF = PdfParser.unwrapLines([
        'This is an impor-',
        'tant update for',
        'the system.'
    ]);
    assert.strictEqual(caseF.length, 1);
    assert.strictEqual(caseF[0], 'This is an important update for the system.');
    console.log('  -> OK: unwrapLines の各パターン判定合格');

    // Test 7: joinTextFragments のフラグメント結合検証
    console.log('Test 7: joinTextFragments による同一行フラグメント結合検証');
    assert.strictEqual(PdfParser.joinTextFragments('事', '後申請'), '事後申請', '日本語文字同士はスペースなし');
    assert.strictEqual(PdfParser.joinTextFragments('承認', '理由'), '承認理由', '日本語文字同士はスペースなし');
    assert.strictEqual(PdfParser.joinTextFragments('Hello', 'World'), 'Hello World', '英単語同士はスペース挿入');
    assert.strictEqual(PdfParser.joinTextFragments('Version', '2.0'), 'Version 2.0', '英数字同士はスペース挿入');
    assert.strictEqual(PdfParser.joinTextFragments('No.', '1'), 'No. 1', '記号と数字はスペース挿入');
    console.log('  -> OK: joinTextFragments 合格');

    // Test 8: 段組みPDFのパースにおける「事後申請」抽出と行単位検索（grep）検証
    console.log('Test 8: 段組みPDFテキスト抽出パイプラインでの grep 検索性検証');
    __setMockPdfJs({
        getDocument: () => ({
            promise: Promise.resolve({
                numPages: 1,
                getPage: async () => ({
                    getTextContent: async () => ({
                        items: [
                            // 1行目: 「⑥ 事」
                            { str: '⑥', transform: [1, 0, 0, 1, 50, 700] },
                            { str: ' 事', transform: [1, 0, 0, 1, 60, 700] },
                            // 2行目（Y座標が変化: 700 -> 680）: 「後申請・承認理由」
                            { str: '後申請', transform: [1, 0, 0, 1, 50, 680] },
                            { str: '・承認理由', transform: [1, 0, 0, 1, 90, 680] },
                            // 3行目: 「業務効率化のため」
                            { str: '：業務効率化のため。', transform: [1, 0, 0, 1, 150, 680] }
                        ]
                    })
                })
            })
        })
    });

    const parsedMd = await PdfParser.parse(dummyPdfData, 'application_form.pdf');
    // 各行ごとに grep 相当の検索を行う
    const parsedLines = parsedMd.split('\n');
    const matchedLine = parsedLines.find(line => line.includes('事後申請'));

    assert.ok(matchedLine, '「事後申請」を含む行が必ず見つかること (grep ヒット)');
    assert.strictEqual(
        matchedLine,
        '⑥ 事後申請・承認理由：業務効率化のため。',
        '行単位で単語が結合され完全な文として復元されていること'
    );
    console.log('  -> OK: 段組みで分割された「事後申請」が単一の行脈で grep 検索ヒットすることを確認');

    __setMockPdfJs(null);

    console.log('=== 全 PdfParser テストに合格しました (All tests passed) ===');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
