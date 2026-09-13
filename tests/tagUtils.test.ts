import { strict as assert } from 'assert';
import {
    parseTag,
    getSystemTag,
    getTypeTag,
    extractUniqueSystems,
    extractUniqueTypes,
    extractUniqueGeneralTags,
    groupNotebooks,
    filterNotebooks,
    UNCLASSIFIED_GROUP_NAME
} from '../src/utils/tagUtils';
import { NotebookMetadata } from '../src/types';

function runTests() {
    console.log('=== tagUtils 単体テスト開始 ===');

    // 1. parseTag
    console.log('Test 1: parseTag の検証');
    const t1 = parseTag('system/apigw');
    assert.equal(t1.prefix, 'system');
    assert.equal(t1.value, 'apigw');
    assert.equal(t1.isSystem, true);
    assert.equal(t1.isType, false);

    const t2 = parseTag('#system/NDP');
    assert.equal(t2.prefix, 'system');
    assert.equal(t2.value, 'NDP');
    assert.equal(t2.isSystem, true);

    const t3 = parseTag('type/estimate');
    assert.equal(t3.prefix, 'type');
    assert.equal(t3.value, 'estimate');
    assert.equal(t3.isType, true);

    const t4 = parseTag('doc/release-plan');
    assert.equal(t4.prefix, 'type');
    assert.equal(t4.value, 'release-plan');
    assert.equal(t4.isType, true);

    const t5 = parseTag('custom/tag');
    assert.equal(t5.prefix, 'custom');
    assert.equal(t5.value, 'tag');
    assert.equal(t5.isSystem, false);
    assert.equal(t5.isType, false);

    const t6 = parseTag('sample');
    assert.equal(t6.prefix, undefined);
    assert.equal(t6.value, 'sample');
    assert.equal(t6.isSystem, false);
    assert.equal(t6.isType, false);

    console.log('  -> OK: parseTag 正常動作');

    // テスト用モックノートブック
    const mockNotebooks: NotebookMetadata[] = [
        {
            id: 'nb1',
            title: 'APIGW 見積検討',
            description: 'APIGWの2026年見積もりメモ',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            tags: ['system/apigw', 'type/estimate', 'sample'],
            icon: 'book',
            userName: 'alice'
        },
        {
            id: 'nb2',
            title: 'APIGW リリース計画',
            description: 'APIGW v2.0リリース手順書',
            createdAt: '2026-01-02T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            tags: ['system/apigw', 'type/release-plan'],
            icon: 'book',
            userName: 'bob'
        },
        {
            id: 'nb3',
            title: 'NDP 方式設計書',
            description: 'NDP基盤の全体アーキテクチャ',
            createdAt: '2026-01-03T00:00:00Z',
            updatedAt: '2026-01-03T00:00:00Z',
            tags: ['system/ndp', 'type/architecture', 'important'],
            icon: 'book',
            userName: 'alice'
        },
        {
            id: 'nb4',
            title: '一般雑記・アイデア出し',
            description: '分類前のメモ',
            createdAt: '2026-01-04T00:00:00Z',
            updatedAt: '2026-01-04T00:00:00Z',
            tags: ['memo'],
            icon: 'book',
            userName: 'alice'
        }
    ];

    // 2. getSystemTag / getTypeTag
    console.log('Test 2: getSystemTag / getTypeTag の検証');
    assert.equal(getSystemTag(mockNotebooks[0].tags), 'apigw');
    assert.equal(getTypeTag(mockNotebooks[0].tags), 'estimate');
    assert.equal(getSystemTag(mockNotebooks[3].tags), undefined);
    assert.equal(getTypeTag(mockNotebooks[3].tags), undefined);
    console.log('  -> OK: getSystemTag / getTypeTag 正常動作');

    // 3. extractUniqueSystems / extractUniqueTypes / extractUniqueGeneralTags
    console.log('Test 3: タグ抽出ヘルパーの検証');
    const systems = extractUniqueSystems(mockNotebooks);
    assert.deepEqual(systems, ['apigw', 'ndp']);

    const types = extractUniqueTypes(mockNotebooks);
    assert.deepEqual(types, ['architecture', 'estimate', 'release-plan']);

    const generals = extractUniqueGeneralTags(mockNotebooks);
    assert.deepEqual(generals, ['important', 'memo', 'sample']);
    console.log('  -> OK: 各種タグの抽出・重複排除・ソート正常');

    // 4. groupNotebooks
    console.log('Test 4: groupNotebooks の検証');
    // none モード
    const groupedNone = groupNotebooks(mockNotebooks, 'none');
    assert.equal(groupedNone.get('all')?.length, 4);

    // system モード
    const groupedSys = groupNotebooks(mockNotebooks, 'system');
    assert.equal(groupedSys.get('apigw')?.length, 2);
    assert.equal(groupedSys.get('ndp')?.length, 1);
    assert.equal(groupedSys.get(UNCLASSIFIED_GROUP_NAME)?.length, 1);
    assert.equal(groupedSys.get(UNCLASSIFIED_GROUP_NAME)![0].id, 'nb4');

    // type モード
    const groupedType = groupNotebooks(mockNotebooks, 'type');
    assert.equal(groupedType.get('estimate')?.length, 1);
    assert.equal(groupedType.get('release-plan')?.length, 1);
    assert.equal(groupedType.get('architecture')?.length, 1);
    assert.equal(groupedType.get(UNCLASSIFIED_GROUP_NAME)?.length, 1);
    console.log('  -> OK: グルーピング正常 (未分類含む)');

    // 5. filterNotebooks
    console.log('Test 5: filterNotebooks の複合条件検証');
    // システム指定
    const resSys = filterNotebooks(mockNotebooks, { system: 'apigw' });
    assert.equal(resSys.length, 2);

    // 種別指定
    const resType = filterNotebooks(mockNotebooks, { type: 'estimate' });
    assert.equal(resType.length, 1);
    assert.equal(resType[0].id, 'nb1');

    // システム × 種別のAND条件
    const resBoth = filterNotebooks(mockNotebooks, { system: 'apigw', type: 'estimate' });
    assert.equal(resBoth.length, 1);
    assert.equal(resBoth[0].id, 'nb1');

    const resNone = filterNotebooks(mockNotebooks, { system: 'ndp', type: 'estimate' });
    assert.equal(resNone.length, 0);

    // 縄張り指定 (alice)
    const resAlice = filterNotebooks(mockNotebooks, { territory: 'mine', currentUser: 'alice' });
    assert.equal(resAlice.length, 3);

    // 特定タグ指定
    const resSample = filterNotebooks(mockNotebooks, { tags: ['sample'] });
    assert.equal(resSample.length, 1);
    assert.equal(resSample[0].id, 'nb1');

    // 検索クエリ
    const resSearch = filterNotebooks(mockNotebooks, { searchQuery: 'リリース手順' });
    assert.equal(resSearch.length, 1);
    assert.equal(resSearch[0].id, 'nb2');

    console.log('  -> OK: filterNotebooks 複合条件合格');

    console.log('=== 全 tagUtils 単体テストに合格しました (All tests passed) ===');
}

runTests();
