import * as assert from 'assert';
import { buildCopilotArgs, CopilotCliAdapter } from '../src/adapters/CopilotCliAdapter';
import { CopilotStreamJsonAccumulator, describeCopilotToolUse } from '../src/adapters/CopilotStreamJsonParser';
import { AgentFactory } from '../src/adapters/AgentFactory';
import { DEFAULT_SETTINGS } from '../src/types';

/** 実機の `copilot --help` から採取した対応フラグの集合 */
const MODERN_COPILOT_FLAGS = new Set([
    '--allow-all', '--allow-all-tools', '--allow-all-paths', '--allow-all-urls',
    '--output-format', '--stream', '--add-dir', '--resume', '--session-id',
    '-p', '--prompt', '--model'
]);
const modern = (f: string) => MODERN_COPILOT_FLAGS.has(f);
const ancient = (_f: string) => false;

function pairAfter(args: string[], flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
}

async function runTests() {
    console.log('=== Copilot CLI アダプタ 単体テスト開始 ===');

    // ---------------------------------------------------------------
    console.log('Test 1: buildCopilotArgs - 権限自動バイパス (--allow-all) と -p <prompt>');
    const b1 = buildCopilotArgs({
        supports: modern,
        additionalReadDirs: [],
        userPrompt: 'Hello Copilot'
    });
    assert.ok(b1.args.includes('--allow-all'), '--allow-all が付与されること');
    assert.strictEqual(b1.outputJson, true, 'outputJson が true になること');
    assert.strictEqual(pairAfter(b1.args, '--output-format'), 'json', '--output-format json が付与されること');
    assert.strictEqual(pairAfter(b1.args, '-p'), 'Hello Copilot', '-p の直後にプロンプト文字列が付くこと');
    console.log('  -> OK: 権限バイパスと引数プロンプト合格');

    // ---------------------------------------------------------------
    console.log('Test 2: buildCopilotArgs - --allow-all 未対応時の個別フラグフォールバック');
    const b2 = buildCopilotArgs({
        supports: (f) => f !== '--allow-all' && modern(f),
        additionalReadDirs: [],
        userPrompt: 'Fallback prompt'
    });
    assert.ok(!b2.args.includes('--allow-all'), '--allow-all を付与しないこと');
    assert.ok(b2.args.includes('--allow-all-tools'), '--allow-all-tools が付与されること');
    assert.ok(b2.args.includes('--allow-all-paths'), '--allow-all-paths が付与されること');
    assert.ok(b2.args.includes('--allow-all-urls'), '--allow-all-urls が付与されること');
    console.log('  -> OK: 個別フラグフォールバック合格');

    // ---------------------------------------------------------------
    console.log('Test 3: buildCopilotArgs - セッション継続 (--session-id / --resume) と --add-dir');
    const fresh = buildCopilotArgs({
        supports: modern,
        additionalReadDirs: ['/vault/nb_a/artifacts', '/vault/nb_b/artifacts'],
        userPrompt: 'Fresh session',
        agentSessionId: 'sess-uuid-1',
        resumeSession: false
    });
    assert.strictEqual(pairAfter(fresh.args, '--session-id'), 'sess-uuid-1', '初回は --session-id が付くこと');
    assert.ok(!fresh.args.includes('--resume'), '初回は --resume を使わないこと');
    assert.strictEqual(fresh.args.filter(a => a === '--add-dir').length, 2, '参照先の数だけ --add-dir が付くこと');

    const resumed = buildCopilotArgs({
        supports: modern,
        additionalReadDirs: [],
        userPrompt: 'Resumed session',
        agentSessionId: 'sess-uuid-1',
        resumeSession: true
    });
    assert.strictEqual(pairAfter(resumed.args, '--resume'), 'sess-uuid-1', '継続時は --resume が付くこと');
    assert.ok(!resumed.args.includes('--session-id'), '継続時は --session-id を使わないこと');
    console.log('  -> OK: セッション継続と追加ディレクトリ合格');

    // ---------------------------------------------------------------
    console.log('Test 4: describeCopilotToolUse - ツール説明の整形');
    assert.strictEqual(
        describeCopilotToolUse('apply_patch', '*** Begin Patch\n*** Add File: artifacts/summary.md\n+test\n*** End Patch'),
        'apply_patch artifacts/summary.md',
        'apply_patch のパッチ文字列からファイル名を抽出できること'
    );
    assert.strictEqual(
        describeCopilotToolUse('view', { path: 'sources/memo.md' }),
        'view sources/memo.md',
        'オブジェクト引数からパスを抽出できること'
    );
    assert.strictEqual(
        describeCopilotToolUse('bash', { command: 'npm test' }),
        'bash npm test',
        'コマンドを抽出できること'
    );
    console.log('  -> OK: ツール引数整形合格');

    // ---------------------------------------------------------------
    console.log('Test 5: CopilotStreamJsonAccumulator - JSONL パース（ストリーミング・ツール痕跡・セッションID）');
    const progress: string[] = [];
    const acc = new CopilotStreamJsonAccumulator(chunk => progress.push(chunk));

    const events = [
        { type: 'session.tools_updated', data: { model: 'mai-code-1.1-flash' } },
        { type: 'tool.execution_start', data: { toolName: 'apply_patch', arguments: '*** Begin Patch\n*** Add File: artifacts/report.md\n+test' } },
        { type: 'tool.execution_complete', data: { success: true, result: { content: 'Added 1 file' } } },
        { type: 'assistant.message_delta', data: { deltaContent: 'レポー' } },
        { type: 'assistant.message_delta', data: { deltaContent: 'トを作成しました' } },
        { type: 'assistant.message', data: { content: 'レポートを作成しました', phase: 'final_answer' } },
        { type: 'result', sessionId: 'sess-copilot-99', exitCode: 0, usage: { filesModified: ['artifacts/report.md'] } }
    ];
    const ndjson = events.map(e => JSON.stringify(e)).join('\n') + '\n';

    // チャンク境界が行の途中で切れても壊れないことの検証
    for (let i = 0; i < ndjson.length; i += 9) {
        acc.push(ndjson.slice(i, i + 9));
    }
    const summary = acc.finish();

    assert.strictEqual(summary.sessionId, 'sess-copilot-99', 'セッションIDを取得できること');
    assert.strictEqual(summary.resultText, 'レポートを作成しました', '最終テキストを取得できること');
    assert.strictEqual(summary.isError, false, 'isError が false であること');
    assert.strictEqual(summary.exitCode, 0, 'exitCode が 0 であること');
    assert.ok(summary.toolUses.some(t => t.includes('apply_patch artifacts/report.md')), 'ツール利用痕跡が記録されること');
    assert.ok(progress.some(p => p.includes('レポー')), 'ストリーミング進捗コールバックが呼ばれること');
    console.log('  -> OK: JSONL パース合格');

    // ---------------------------------------------------------------
    console.log('Test 6: CopilotStreamJsonAccumulator - ツール失敗・非JSON行の処理');
    const acc2 = new CopilotStreamJsonAccumulator();
    acc2.push(JSON.stringify({
        type: 'tool.execution_complete',
        data: { success: false, error: { message: 'Command failed with exit code 1' } }
    }) + '\n');
    acc2.push(JSON.stringify({
        type: 'result',
        sessionId: 'sess-err',
        exitCode: 1
    }) + '\n');
    const s2 = acc2.finish();
    assert.strictEqual(s2.isError, true, '非0終了コードで isError が true になること');
    assert.strictEqual(s2.toolErrors.length, 1, 'ツールエラーが記録されること');
    assert.ok(s2.toolErrors[0].includes('Command failed'));

    // 非JSON行のフォールバック
    const acc3 = new CopilotStreamJsonAccumulator();
    acc3.push('Plain text response from copilot\n');
    const s3 = acc3.finish();
    assert.strictEqual(s3.resultText, 'Plain text response from copilot', '非JSON行が応答テキストになること');
    console.log('  -> OK: 失敗検知・非JSONフォールバック合格');

    // ---------------------------------------------------------------
    console.log('Test 7: AgentFactory - copilot へのルーティング検証');
    const settings = { ...DEFAULT_SETTINGS, activeAgent: 'copilot' as const, copilotPath: '/custom/bin/copilot' };
    const adapter = AgentFactory.getAdapter(settings);
    assert.ok(adapter instanceof CopilotCliAdapter, 'CopilotCliAdapter が返されること');
    assert.strictEqual(adapter.id, 'copilot');
    assert.strictEqual(AgentFactory.getCommandPath(settings), '/custom/bin/copilot', 'カスタムパスが返されること');

    const defaultPathSettings = { ...DEFAULT_SETTINGS, activeAgent: 'copilot' as const, copilotPath: '' };
    assert.strictEqual(AgentFactory.getCommandPath(defaultPathSettings), 'copilot', 'デフォルト copilot が返されること');
    console.log('  -> OK: AgentFactory ルーティング合格');

    console.log('=== 全 Copilot CLI テストケースに合格しました (All tests passed) ===');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
