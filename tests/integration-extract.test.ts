import * as path from 'path';
import * as assert from 'assert';
import { BoundFolderReader } from '../src/services/BoundFolderReader';
import { TranscriptionService } from '../src/services/transcription/TranscriptionService';

async function runIntegrationTest() {
    console.log('=== Phase 4c 探索 & 一括Extract 結合テスト開始 ===');
    const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures/sample_estimates');

    // 1. 階層ツリーの走査
    console.log('Step 1: 階層ツリー走査 (listTree)');
    const tree = await BoundFolderReader.listTree(fixturesDir);
    assert.ok(tree.children && tree.children.length > 0, 'ツリーの子要素が存在すること');

    const flatFiles = BoundFolderReader.flattenTreeFiles(tree);
    console.log(`  -> 発見されたファイル数: ${flatFiles.length} 件`);
    for (const f of flatFiles) {
        console.log(`     - [${f.folder || 'root'}] ${f.name} (${(f.size / 1024).toFixed(1)} KB)`);
    }

    // 2. 特定フォルダ (2024/A社_基幹刷新) のファイル群を一括読み込み & 決定的変換
    console.log('\nStep 2: 2024/A社_基幹刷新 配下の一括読み込み & 決定的変換');
    const targetFolderFiles = flatFiles.filter(f => f.folder.includes('2024/A社_基幹刷新') || f.relativePath.startsWith('2024/A社_基幹刷新'));
    assert.ok(targetFolderFiles.length >= 2, '2024/A社_基幹刷新 配下に2件以上のファイルが存在すること');

    for (const target of targetFolderFiles) {
        const { buffer, fileName, mtime } = await BoundFolderReader.readFile(fixturesDir, target.relativePath);
        assert.ok(buffer.length > 0, `${fileName} のバッファが読み込めること`);

        if (TranscriptionService.isTranscribable(fileName)) {
            const { markdown, convertedFilename } = await TranscriptionService.transcribe(buffer, fileName);
            assert.ok(markdown.length > 0, `${convertedFilename} のMarkdownが生成されること`);
            console.log(`  -> 変換成功: ${fileName} -> ${convertedFilename} (Markdown: ${markdown.length} 文字)`);
        }
    }

    // 3. AI用ツリーテキストの整合性検証
    console.log('\nStep 3: AIプロンプト用ツリーテキストの検証');
    const agentPromptText = BoundFolderReader.formatTreeForAgent(tree);
    console.log('--- 生成されたツリーテキスト抜粋 ---');
    console.log(agentPromptText.split('\n').slice(0, 8).join('\n'));
    console.log('--- 抜粋ここまで ---');

    assert.ok(agentPromptText.includes('📁 2024/'), '2024フォルダが含まれること');
    assert.ok(agentPromptText.includes('📁 A社_基幹刷新/'), 'A社_基幹刷新フォルダが含まれること');
    assert.ok(!agentPromptText.includes(fixturesDir), '実OS絶対パスが含まれないこと');

    console.log('\n=== 結合テスト完了: 全検証項目に合格しました ===');
}

runIntegrationTest().catch(err => {
    console.error('Integration test failed:', err);
    process.exit(1);
});
