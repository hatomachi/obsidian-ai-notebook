import * as path from 'path';
import * as assert from 'assert';
import { BoundFolderReader, BoundFolderNode } from '../src/services/BoundFolderReader';

async function runTests() {
    console.log('=== BoundFolderReader 単体テスト開始 ===');
    const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures/sample_estimates');

    // 1. セキュリティ防御: 書き込み・削除系APIが一切exportされていないことの検証
    console.log('Test 1: 読み取り専用防御の検証 (書き込み系メソッド不在確認)');
    const forbiddenMethods = [
        'write', 'writeFile', 'writeFileSync',
        'create', 'createFile', 'createDirectory', 'mkdir', 'mkdirSync',
        'delete', 'deleteFile', 'unlink', 'unlinkSync',
        'rmdir', 'rmdirSync', 'remove', 'modify'
    ];
    for (const method of forbiddenMethods) {
        assert.strictEqual(
            (BoundFolderReader as any)[method],
            undefined,
            `セキュリティ違反: BoundFolderReader に危険なメソッド '${method}' が定義されています`
        );
        assert.strictEqual(
            (BoundFolderReader.prototype as any)?.[method],
            undefined,
            `セキュリティ違反: BoundFolderReader.prototype に危険なメソッド '${method}' が定義されています`
        );
    }
    console.log('  -> OK: 書き込み系APIは一切存在しません');

    // 2. ディレクトリ検証
    console.log('Test 2: isValidDirectory の検証');
    assert.strictEqual(BoundFolderReader.isValidDirectory(fixturesDir), true);
    assert.strictEqual(BoundFolderReader.isValidDirectory('/path/to/non_existent_folder_xyz'), false);
    console.log('  -> OK: 有効/無効ディレクトリの判定正常');

    // 3. 階層ツリー再帰走査 (不揃い深さ対応)
    console.log('Test 3: listTree による階層ツリー走査の検証');
    const tree = await BoundFolderReader.listTree(fixturesDir);
    assert.strictEqual(tree.type, 'folder');
    assert.ok((tree.fileCount || 0) >= 5, `総ファイル数が期待値以上であること: ${tree.fileCount}`);
    
    // 子フォルダの存在確認
    const subFolderNames = tree.children?.filter(c => c.type === 'folder').map(c => c.name) || [];
    assert.ok(subFolderNames.includes('2024'), '2024 フォルダが存在すること');
    assert.ok(subFolderNames.includes('2025'), '2025 フォルダが存在すること');
    assert.ok(subFolderNames.includes('共通提案・要件定義'), '共通提案・要件定義 フォルダが存在すること');

    // 深い階層 (2024/A社_基幹刷新) の確認
    const folder2024 = tree.children?.find(c => c.name === '2024');
    assert.ok(folder2024, '2024 ノードが存在すること');
    const folder2024A = folder2024?.children?.find(c => c.name === 'A社_基幹刷新');
    assert.ok(folder2024A, '2024/A社_基幹刷新 ノードが存在すること');
    assert.ok((folder2024A?.children?.length || 0) >= 2, 'A社_基幹刷新 に2件以上のファイルが存在すること');
    console.log('  -> OK: 階層ツリーの再帰的走査正常');

    // 4. フラットファイル一覧化
    console.log('Test 4: flattenTreeFiles の検証');
    const flatFiles = BoundFolderReader.flattenTreeFiles(tree);
    assert.ok(flatFiles.length >= 5, `フラットファイル数が期待値以上: ${flatFiles.length}`);
    const found2024Excel = flatFiles.find(f => f.relativePath.includes('2024/A社_基幹刷新/A社_基幹刷新_工数見積書_v2.0.xlsx'));
    assert.ok(found2024Excel, '相対パス 2024/A社_基幹刷新/A社_基幹刷新_工数見積書_v2.0.xlsx が正しく取得できること');
    console.log('  -> OK: フラットファイル一覧抽出正常');

    // 5. 安全なファイル読み込み (readFile)
    console.log('Test 5: readFile の検証');
    const readResult = await BoundFolderReader.readFile(fixturesDir, '2024/A社_基幹刷新/A社_基幹刷新_工数見積書_v2.0.xlsx');
    assert.ok(readResult.buffer.length > 0, 'バッファが取得できること');
    assert.strictEqual(readResult.fileName, 'A社_基幹刷新_工数見積書_v2.0.xlsx');
    console.log('  -> OK: 安全なファイル読み込み正常');

    // 6. セキュリティ防御: パストラバーサル防止
    console.log('Test 6: パストラバーサル (../) 防御の検証');
    let traversalBlocked = false;
    try {
        await BoundFolderReader.readFile(fixturesDir, '../../../../etc/passwd');
    } catch (e: any) {
        traversalBlocked = true;
        assert.ok(e.message.includes('パストラバーサル'), `エラーメッセージにパストラバーサルが含まれること: ${e.message}`);
    }
    assert.strictEqual(traversalBlocked, true, 'パストラバーサルが確実にブロックされること');
    console.log('  -> OK: パストラバーサルが確実に防御されました');

    // 7. AIプロンプト用テキスト生成 (実OS絶対パスが含まれないことの検証)
    console.log('Test 7: formatTreeForAgent の検証 (実OS絶対パス秘匿確認)');
    const agentText = BoundFolderReader.formatTreeForAgent(tree);
    assert.ok(agentText.includes('📁 2024/'), '2024フォルダが表示されること');
    assert.ok(agentText.includes('A社_基幹刷新_工数見積書_v2.0.xlsx'), 'ファイル名が表示されること');
    assert.ok(!agentText.includes(fixturesDir), '実OS絶対パスがテキストに含まれないこと');
    console.log('  -> OK: AIプロンプト用ツリーテキスト生成正常 (実パス秘匿確認)');

    console.log('=== 全テストケースに合格しました (All tests passed) ===');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
