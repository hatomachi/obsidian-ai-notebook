import * as assert from 'assert';
import { buildDirectEditSystemPrompt, AgentOptions } from '../src/adapters/AgentAdapter';
import { LinkedContext } from '../src/types';

async function runTests() {
    console.log('=== AgentPromptContext 単体テスト開始 ===');

    // 1. LinkedContext の絶対パス提示とプロンプトサイズ検証
    console.log('Test 1: LinkedContext のファイルパス参照化プロンプト生成');
    
    const mockLinkedContexts: LinkedContext[] = [
        {
            notebookId: 'nb_sys_apigw',
            notebookTitle: 'APIGW システム仕様・クセ',
            description: 'APIGW のアーキテクチャおよび運用上の注意事項',
            artifacts: [
                {
                    name: 'アーキテクチャ概要.md',
                    title: 'アーキテクチャ概要',
                    path: '_ainotebook/notebooks/nb_sys_apigw/artifacts/アーキテクチャ概要.md',
                    absolutePath: '/Users/test/vault/_ainotebook/notebooks/nb_sys_apigw/artifacts/アーキテクチャ概要.md',
                    size: 15420
                },
                {
                    name: '過去トラブル事例集.md',
                    title: '過去トラブル事例集',
                    path: '_ainotebook/notebooks/nb_sys_apigw/artifacts/過去トラブル事例集.md',
                    absolutePath: '/Users/test/vault/_ainotebook/notebooks/nb_sys_apigw/artifacts/過去トラブル事例集.md',
                    size: 28900
                }
            ]
        },
        {
            notebookId: 'nb_tpl_release',
            notebookTitle: 'リリース計画書 デザイン仕様',
            description: 'リリース計画書の作成基準とfew-shotサンプル',
            artifacts: [
                {
                    name: 'リリース計画書_作成ルール.md',
                    title: 'リリース計画書 作成ルール',
                    path: '_ainotebook/notebooks/nb_tpl_release/artifacts/リリース計画書_作成ルール.md',
                    absolutePath: '/Users/test/vault/_ainotebook/notebooks/nb_tpl_release/artifacts/リリース計画書_作成ルール.md',
                    size: 12300
                }
            ]
        }
    ];

    const options: AgentOptions = {
        notebookDir: '/Users/test/vault/_ainotebook/notebooks/20260902_task',
        sourcesDir: '/Users/test/vault/_ainotebook/notebooks/20260902_task/sources',
        artifactsDir: '/Users/test/vault/_ainotebook/notebooks/20260902_task/artifacts',
        commandPath: 'claude',
        linkedContexts: mockLinkedContexts
    };

    const userPrompt = 'APIGWのRTC時刻適正化のため、停止起動をする。テストフレームの仕様は参照コンテキストで調べて';
    const generatedPrompt = buildDirectEditSystemPrompt(userPrompt, options);

    // プロンプトに絶対パスが含まれていることの検証
    assert.ok(generatedPrompt.includes('/Users/test/vault/_ainotebook/notebooks/nb_sys_apigw/artifacts/アーキテクチャ概要.md'), '成果物の絶対パスが含まれること');
    assert.ok(generatedPrompt.includes('/Users/test/vault/_ainotebook/notebooks/nb_sys_apigw/artifacts/過去トラブル事例集.md'), '成果物の絶対パスが含まれること');
    assert.ok(generatedPrompt.includes('/Users/test/vault/_ainotebook/notebooks/nb_tpl_release/artifacts/リリース計画書_作成ルール.md'), '成果物の絶対パスが含まれること');

    // ツール読み込み指示が含まれていることの検証
    assert.ok(generatedPrompt.includes('ツール（view_file / Read File / cat 等）を使って以下の絶対パスのファイルを直接読み込み'), 'ツール読み込み指示が含まれること');

    // プロンプト全体の長さがコンパクト（32KB制限の10分の1以下）であることの検証
    console.log(`  -> 生成されたプロンプト長: ${generatedPrompt.length} 文字 (バイト数: ${Buffer.byteLength(generatedPrompt, 'utf-8')} bytes)`);
    assert.ok(generatedPrompt.length < 5000, `プロンプト長が 5000 文字未満であること (実際: ${generatedPrompt.length})`);

    console.log('  -> OK: LinkedContext のファイルパス参照化検証に合格');
    console.log('=== 全テストケースに合格しました (All tests passed) ===');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
