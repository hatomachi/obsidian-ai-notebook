import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    formatDateForFileName,
    sanitizeFileName,
    getUniqueFileName,
    generatePastedImageName,
    generatePastedTextName,
    isInputElement,
    getPasteShortcutLabel
} from '../src/utils/clipboardUtils';
import { NotebookManager } from '../src/services/NotebookManager';
import { DEFAULT_SETTINGS } from '../src/types';
import { FileSystemAdapter, TFile, TFolder } from 'obsidian';

// Simple mock vault implementation backed by a temporary filesystem directory
function createMockVault(tmpDir: string) {
    const normalize = (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '');

    const vault: any = {
        adapter: Object.assign(Object.create(FileSystemAdapter.prototype), {
            getBasePath: () => tmpDir
        }),
        getAbstractFileByPath: (p: string) => {
            const norm = normalize(p);
            const abs = path.join(tmpDir, norm);
            if (!fs.existsSync(abs)) return null;
            const stat = fs.statSync(abs);
            if (stat.isDirectory()) {
                const makeFolder = (normPath: string, absPath: string): TFolder => {
                    const folder = new TFolder();
                    folder.path = normPath;
                    folder.name = path.basename(normPath);
                    const childrenNames = fs.readdirSync(absPath);
                    folder.children = childrenNames.map(childName => {
                        const childRel = `${normPath}/${childName}`;
                        const childAbs = path.join(absPath, childName);
                        const childStat = fs.statSync(childAbs);
                        if (childStat.isDirectory()) {
                            return makeFolder(childRel, childAbs);
                        } else {
                            const file = new TFile();
                            file.path = childRel;
                            file.name = childName;
                            file.basename = childName.replace(/\.[^/.]+$/, '');
                            file.extension = path.extname(childName).replace(/^\./, '');
                            file.stat = { size: childStat.size, mtime: childStat.mtimeMs, ctime: childStat.ctimeMs };
                            return file;
                        }
                    });
                    return folder;
                };
                return makeFolder(norm, abs);
            } else {
                const file = new TFile();
                file.path = norm;
                file.name = path.basename(norm);
                file.basename = file.name.replace(/\.[^/.]+$/, '');
                file.extension = path.extname(norm).replace(/^\./, '');
                file.stat = { size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs };
                return file;
            }
        },
        createFolder: async (p: string) => {
            const norm = normalize(p);
            const abs = path.join(tmpDir, norm);
            fs.mkdirSync(abs, { recursive: true });
        },
        create: async (p: string, data: string) => {
            const norm = normalize(p);
            const abs = path.join(tmpDir, norm);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, data, 'utf-8');
            const file = new TFile();
            file.path = norm;
            file.name = path.basename(norm);
            return file;
        },
        createBinary: async (p: string, data: ArrayBuffer) => {
            const norm = normalize(p);
            const abs = path.join(tmpDir, norm);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, Buffer.from(data));
            const file = new TFile();
            file.path = norm;
            file.name = path.basename(norm);
            return file;
        },
        modify: async (file: TFile, data: string) => {
            const norm = normalize(file.path);
            const abs = path.join(tmpDir, norm);
            fs.writeFileSync(abs, data, 'utf-8');
        },
        modifyBinary: async (file: TFile, data: ArrayBuffer) => {
            const norm = normalize(file.path);
            const abs = path.join(tmpDir, norm);
            fs.writeFileSync(abs, Buffer.from(data));
        },
        read: async (file: TFile) => {
            const norm = normalize(file.path);
            const abs = path.join(tmpDir, norm);
            return fs.readFileSync(abs, 'utf-8');
        },
        readBinary: async (file: TFile) => {
            const norm = normalize(file.path);
            const abs = path.join(tmpDir, norm);
            const buf = fs.readFileSync(abs);
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        },
        delete: async (file: TFile) => {
            const norm = normalize(file.path);
            const abs = path.join(tmpDir, norm);
            if (fs.existsSync(abs)) {
                fs.rmSync(abs, { recursive: true, force: true });
            }
        }
    };

    return vault;
}

async function runTests() {
    console.log('=== クリップボード貼付 (Ctrl+V) ＆ ユーティリティ単体テスト開始 ===');

    // Test 1: formatDateForFileName
    console.log('Test 1: formatDateForFileName タイムスタンプ生成');
    const fixedDate = new Date(2026, 8, 15, 12, 34, 56); // 2026-09-15 12:34:56
    const dateStr = formatDateForFileName(fixedDate);
    assert.strictEqual(dateStr, '20260915-123456');
    console.log('  -> OK: タイムスタンプ形式正常 (20260915-123456)');

    // Test 2: sanitizeFileName
    console.log('Test 2: sanitizeFileName 禁止文字・制御文字サニタイズ');
    assert.strictEqual(sanitizeFileName('通常タイトル'), '通常タイトル');
    assert.strictEqual(sanitizeFileName('重要: API仕様 <v2.0> *ドラフト*'), '重要 API仕様 v2.0 ドラフト');
    assert.strictEqual(sanitizeFileName('パス\\区切り/と:コロン*疑問?引用"小なり<大なり>パイプ|シャープ#ブラケット[ ]キャレット^'), 'パス区切りとコロン疑問引用小なり大なりパイプシャープブラケット キャレット');
    assert.strictEqual(sanitizeFileName("改行1\n改行2\r\nタブ\tタイトル"), '改行1 改行2 タブ タイトル');
    assert.strictEqual(sanitizeFileName('   前後スペース   '), '前後スペース');
    console.log('  -> OK: 禁止文字サニタイズ合格');

    // Test 3: getUniqueFileName 重複回避
    console.log('Test 3: getUniqueFileName 重複回避連番生成');
    const existing = ['note.md', 'note_1.md', 'Image.png'];
    assert.strictEqual(getUniqueFileName('note', 'md', existing), 'note_2.md');
    assert.strictEqual(getUniqueFileName('NOTE', 'md', existing), 'NOTE_2.md'); // 大文字小文字同一視
    assert.strictEqual(getUniqueFileName('other', 'md', existing), 'other.md');
    assert.strictEqual(getUniqueFileName('image', 'png', existing), 'image_1.png');
    console.log('  -> OK: 重複回避連番正常');

    // Test 4: generatePastedImageName
    console.log('Test 4: generatePastedImageName クリップボード画像命名');
    const imgName1 = generatePastedImageName([], fixedDate, 'png');
    assert.strictEqual(imgName1, 'Pasted image 20260915-123456.png');

    const imgName2 = generatePastedImageName(['Pasted image 20260915-123456.png'], fixedDate, 'png');
    assert.strictEqual(imgName2, 'Pasted image 20260915-123456_1.png');
    console.log('  -> OK: 画像ファイル名生成合格');

    // Test 5: generatePastedTextName
    console.log('Test 5: generatePastedTextName テキストからのスマート命名');
    // 5a. Markdown見出し
    const textWithHeading = '# 2026年度 システム改修要件\n\nここに詳細が続きます...';
    assert.strictEqual(generatePastedTextName(textWithHeading, []), '2026年度 システム改修要件.md');

    // 5b. 箇条書き
    const textWithList = '- 次期アーキテクチャ検討項目\n- 項目2';
    assert.strictEqual(generatePastedTextName(textWithList, []), '次期アーキテクチャ検討項目.md');

    // 5c. 禁止文字入り見出し
    const textWithForbidden = '### 【重要】API: 認証仕様 <v1.0> *ドラフト*';
    assert.strictEqual(generatePastedTextName(textWithForbidden, []), '【重要】API 認証仕様 v1.0 ドラフト.md');

    // 5d. 空テキストまたは短すぎる文字列 -> タイムスタンプ名
    assert.strictEqual(generatePastedTextName('', [], fixedDate), 'Pasted note 20260915-123456.md');
    assert.strictEqual(generatePastedTextName('a', [], fixedDate), 'Pasted note 20260915-123456.md');
    assert.strictEqual(generatePastedTextName('### \n\n', [], fixedDate), 'Pasted note 20260915-123456.md');

    // 5e. 長文タイトル（40文字でトリム）
    const longLine = 'これは非常に長いタイトルのテキストであり40文字を超えてファイル名に設定されるのを防ぐためのテストケースです';
    const longTitle = generatePastedTextName(longLine, []);
    assert.ok(longTitle.length <= 44); // 40文字 + ".md" (4文字)
    assert.ok(longTitle.endsWith('.md'));

    // 5f. 重複時
    const duplicateTest = generatePastedTextName(textWithHeading, ['2026年度 システム改修要件.md']);
    assert.strictEqual(duplicateTest, '2026年度 システム改修要件_1.md');
    console.log('  -> OK: テキストスマート命名合格');

    // Test 6: isInputElement 入力要素判定
    console.log('Test 6: isInputElement 入力要素判定');
    const inputEl = { tagName: 'INPUT', isContentEditable: false } as any;
    const textareaEl = { tagName: 'TEXTAREA', isContentEditable: false } as any;
    const editableDiv = { tagName: 'DIV', isContentEditable: true } as any;
    const regularDiv = { tagName: 'DIV', isContentEditable: false } as any;
    const nullEl = null;

    assert.strictEqual(isInputElement(inputEl), true);
    assert.strictEqual(isInputElement(textareaEl), true);
    assert.strictEqual(isInputElement(editableDiv), true);
    assert.strictEqual(isInputElement(regularDiv), false);
    assert.strictEqual(isInputElement(nullEl), false);
    console.log('  -> OK: 入力要素判定合格');

    // Test 7: NotebookManager との結合（テキスト・画像の直接投入＆サブフォルダ対応）
    console.log('Test 7: NotebookManager との結合テスト (テキスト & 画像投入)');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipboard-test-vault-'));
    try {
        const mockVault = createMockVault(tmpDir);
        const mockApp: any = { vault: mockVault };
        const mockSettings = { ...DEFAULT_SETTINGS, compressImages: false }; // 圧縮処理のブラウザCanvas依存を回避
        const manager = new NotebookManager(mockApp, mockSettings);

        // ノートブック作成
        const nb = await manager.createNotebook('クリップボードテスト');
        const nbId = nb.id;

        // 7a. クリップボードから貼り付けたテキストをソースに追加
        const pastedText = '# インフラ設計方針\nAWS ECS上でエージェントを実行する。';
        const textFileName = generatePastedTextName(pastedText, []);
        assert.strictEqual(textFileName, 'インフラ設計方針.md');

        const addTextResult = await manager.addSourceFile(nbId, textFileName, pastedText);
        assert.strictEqual(addTextResult.file.name, 'インフラ設計方針.md');

        const savedContent = await mockVault.read(addTextResult.file);
        assert.strictEqual(savedContent, pastedText);
        console.log('  -> OK: テキストのソース直接追加正常');

        // 7b. サブフォルダへのテキスト追加
        await manager.createSourceFolder(nbId, '01_要件');
        // サブフォルダ内のファイル一覧を既存リストとして渡す（サブフォルダ内にはまだ存在しないので同名が使える）
        const subExisting: string[] = [];
        const subTextFileName = generatePastedTextName(pastedText, subExisting);
        const addSubTextResult = await manager.addSourceFile(nbId, subTextFileName, pastedText, undefined, '01_要件');
        assert.strictEqual(addSubTextResult.file.name, 'インフラ設計方針.md');
        assert.ok(addSubTextResult.file.path.includes('01_要件/インフラ設計方針.md'));
        console.log('  -> OK: サブフォルダへのテキスト追加正常');

        // 7c. クリップボードからの画像バイナリ投入
        const dummyPngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const imgFileName = generatePastedImageName([], fixedDate, 'png');
        const addImgResult = await manager.addSourceFile(nbId, imgFileName, dummyPngBuffer);
        assert.strictEqual(addImgResult.file.name, 'Pasted image 20260915-123456.png');
        console.log('  -> OK: 画像バイナリのソース直接追加正常');

        // 7d. ソース一覧取得で確認
        const sources = await manager.getSources(nbId);
        assert.strictEqual(sources.length, 3);
        const fileNames = sources.map(s => s.name);
        assert.ok(fileNames.includes('インフラ設計方針.md'));
        assert.ok(fileNames.includes('Pasted image 20260915-123456.png'));
        console.log('  -> OK: ソース一覧への正常反映確認');

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log('=== 全 クリップボード貼付 単体・結合テストに合格しました (All tests passed) ===');
}

runTests().catch(err => {
    console.error('テスト失敗:', err);
    process.exit(1);
});
