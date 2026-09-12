import * as assert from 'assert';
import { ImageCompressor } from '../src/services/ImageCompressor';

async function runTests() {
    console.log('=== ImageCompressor 単体テスト開始 ===');

    // Test 1: isCompressible の判定検証
    console.log('Test 1: isCompressible の形式判定');
    assert.strictEqual(ImageCompressor.isCompressible('test.png'), true, 'png は true');
    assert.strictEqual(ImageCompressor.isCompressible('test.PNG'), true, '大文字 PNG は true');
    assert.strictEqual(ImageCompressor.isCompressible('photo.jpg'), true, 'jpg は true');
    assert.strictEqual(ImageCompressor.isCompressible('photo.jpeg'), true, 'jpeg は true');
    assert.strictEqual(ImageCompressor.isCompressible('image.webp'), true, 'webp は true');
    assert.strictEqual(ImageCompressor.isCompressible('bitmap.bmp'), true, 'bmp は true');
    assert.strictEqual(ImageCompressor.isCompressible('anim.gif'), false, 'gif は false (アニメーション保護)');
    assert.strictEqual(ImageCompressor.isCompressible('vector.svg'), false, 'svg は false (ベクター保護)');
    assert.strictEqual(ImageCompressor.isCompressible('doc.pdf'), false, 'pdf は false');
    assert.strictEqual(ImageCompressor.isCompressible('table.xlsx'), false, 'xlsx は false');
    assert.strictEqual(ImageCompressor.isCompressible('notes.md'), false, 'md は false');
    console.log('  -> OK: 画像形式判定正常');

    // Test 2: getWebpFilename の拡張子変換検証
    console.log('Test 2: getWebpFilename の拡張子変換');
    assert.strictEqual(ImageCompressor.getWebpFilename('screenshot.png'), 'screenshot.webp');
    assert.strictEqual(ImageCompressor.getWebpFilename('PHOTO.JPG'), 'PHOTO.webp');
    assert.strictEqual(ImageCompressor.getWebpFilename('already.webp'), 'already.webp');
    assert.strictEqual(ImageCompressor.getWebpFilename('complex.name.with.dots.jpeg'), 'complex.name.with.dots.webp');
    assert.strictEqual(ImageCompressor.getWebpFilename('noext'), 'noext.webp');
    console.log('  -> OK: WebPファイル名変換正常');

    // Test 3: calculateDimensions のリサイズ計算検証
    console.log('Test 3: calculateDimensions のアスペクト比計算');
    // 横長画像: 2400x1200 -> 1200x600
    const landscape = ImageCompressor.calculateDimensions(2400, 1200, 1200);
    assert.strictEqual(landscape.width, 1200);
    assert.strictEqual(landscape.height, 600);

    // 縦長画像: 800x1600 -> 600x1200
    const portrait = ImageCompressor.calculateDimensions(800, 1600, 1200);
    assert.strictEqual(portrait.width, 600);
    assert.strictEqual(portrait.height, 1200);

    // 範囲内の画像: 800x600 -> 800x600 (そのまま拡大しない)
    const small = ImageCompressor.calculateDimensions(800, 600, 1200);
    assert.strictEqual(small.width, 800);
    assert.strictEqual(small.height, 600);

    // 正方形画像: 3000x3000 -> 1200x1200
    const square = ImageCompressor.calculateDimensions(3000, 3000, 1200);
    assert.strictEqual(square.width, 1200);
    assert.strictEqual(square.height, 1200);

    // 異常値: 0以下のサイズガード
    const zero = ImageCompressor.calculateDimensions(0, 0, 1200);
    assert.strictEqual(zero.width, 1);
    assert.strictEqual(zero.height, 1);
    console.log('  -> OK: 寸法計算正常');

    // Test 4: Node.js 環境での compress フォールバック検証
    console.log('Test 4: Node.js 環境での compress フォールバック');
    const dummyData = Buffer.from('dummy image binary content');
    const result = await ImageCompressor.compress(dummyData, 'sample.png', { maxDimension: 1200, quality: 0.8 });
    assert.strictEqual(result.originalFilename, 'sample.png');
    assert.strictEqual(result.convertedFilename, 'sample.webp');
    assert.strictEqual(result.originalSize, dummyData.length);
    assert.strictEqual(result.compressedSize, dummyData.length);
    assert.ok(typeof result.durationMs === 'number');
    console.log('  -> OK: 非ブラウザ環境フォールバック正常');

    console.log('=== 全 ImageCompressor 単体テストに合格しました (All tests passed) ===');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
