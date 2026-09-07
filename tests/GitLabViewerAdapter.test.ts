import * as assert from 'assert';
import {
    normalizeGitLabBaseUrl,
    encodeProjectId,
    encodeFilePath,
} from '../src/web/adapters/GitLabViewerAdapter';
import { parseFrontmatter } from '../src/web/utils/frontmatter';

console.log('=== GitLabViewerAdapter & Utilities 単体テスト開始 ===');

// 1. URL 正規化の検証
console.log('Test 1: normalizeGitLabBaseUrl の検証');
assert.strictEqual(
    normalizeGitLabBaseUrl('https://gitlab.example.com'),
    'https://gitlab.example.com/api/v4',
    'ルートURLに /api/v4 が自動補完されること'
);
assert.strictEqual(
    normalizeGitLabBaseUrl('https://gitlab.example.com/'),
    'https://gitlab.example.com/api/v4',
    '末尾スラッシュ付きURLでも正常に補完されること'
);
assert.strictEqual(
    normalizeGitLabBaseUrl('https://gitlab.example.com/api/v4'),
    'https://gitlab.example.com/api/v4',
    'すでに /api/v4 がある場合はそのまま維持されること'
);
assert.strictEqual(
    normalizeGitLabBaseUrl('/ainotebook/api'),
    '/ainotebook/api',
    '相対リバースプロキシパスがそのまま維持されること'
);
console.log('  -> OK: URL正規化正常');

// 2. Project ID エンコードの検証
console.log('Test 2: encodeProjectId の検証');
assert.strictEqual(encodeProjectId('12345'), '12345', '数値IDはそのまま');
assert.strictEqual(encodeProjectId('mygroup/myproject'), 'mygroup%2Fmyproject', 'namespace/repo はエンコードされること');
console.log('  -> OK: プロジェクトIDエンコード正常');

// 3. File Path エンコードの検証
console.log('Test 3: encodeFilePath の検証');
assert.strictEqual(
    encodeFilePath('_ainotebook/index/20260831_test.md'),
    '_ainotebook%2Findex%2F20260831_test.md',
    'スラッシュが URL エンコードされること'
);
assert.strictEqual(
    encodeFilePath('/_ainotebook/notebooks/test/artifacts/doc.md'),
    '_ainotebook%2Fnotebooks%2Ftest%2Fartifacts%2Fdoc.md',
    '先頭スラッシュが除去されてエンコードされること'
);
console.log('  -> OK: ファイルパスエンコード正常');

// 4. Frontmatter パースの検証
console.log('Test 4: parseFrontmatter の検証');
const sampleMd = `---
notebook_id: "20260831_task_rel09"
title: "2026-09 APIGW リリース計画書作成"
created_at: "2026-08-31T17:00:00+09:00"
tags: [release, apigw, task]
icon: "rocket"
description: "テスト説明文"
linked_notebook_ids:
  - "20260831_sys_apigw"
  - "20260831_tpl_release"
---
# ノートブックメモ本文
ここに自由なメモが書かれます。`;

const parsed = parseFrontmatter<any>(sampleMd);
assert.strictEqual(parsed.data.notebook_id, '20260831_task_rel09');
assert.strictEqual(parsed.data.title, '2026-09 APIGW リリース計画書作成');
assert.deepStrictEqual(parsed.data.tags, ['release', 'apigw', 'task']);
assert.strictEqual(parsed.data.icon, 'rocket');
assert.deepStrictEqual(parsed.data.linked_notebook_ids, ['20260831_sys_apigw', '20260831_tpl_release']);
assert.strictEqual(parsed.content, '# ノートブックメモ本文\nここに自由なメモが書かれます。');
console.log('  -> OK: Frontmatter パース正常');

console.log('=== 全 GitLabViewerAdapter 単体テストに合格しました (All tests passed) ===');
