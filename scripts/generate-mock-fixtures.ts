import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, WidthType, TextRun } from 'docx';

const outputDir = path.resolve(__dirname, '../tests/fixtures/sample_estimates');

function ensureDirectory(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * 1. 01_2024_A社_基幹刷新_工数見積書_v2.0.xlsx の生成
 */
function generateExcelA() {
    const wb = XLSX.utils.book_new();

    // Sheet 1: 表紙
    const coverData = [
        ['【御見積書】'],
        ['案件名', '2024年度 A社 基幹システム刷新開発プロジェクト'],
        ['御中', 'A社 デジタル推進本部 御中'],
        ['作成日', '2024年5月10日 (第2版)'],
        ['作成者', 'システムソリューション事業部 見積作成チーム'],
        ['見積総額 (税抜)', '¥ 42,500,000'],
        ['', ''],
        ['【前提条件および特記事項】'],
        ['1. 本見積は要件定義書 v1.2 に基づく概算積算です。'],
        ['2. 夜間・休日デプロイ作業は深夜割増（25%）を工数に加味しています。'],
        ['3. 外部SaaS連携のAPI利用料は顧客直接契約前提です。']
    ];
    const wsCover = XLSX.utils.aoa_to_sheet(coverData);
    XLSX.utils.book_append_sheet(wb, wsCover, '表紙');

    // Sheet 2: 工数内訳・計算根拠
    const breakdownData = [
        ['WBSコード', '作業フェーズ / タスク名', '担当ロール', '予定工数(人月)', '単価(万円/月)', '小計(万円)', '備考・算定根拠'],
        ['1.0', '要件定義・アーキテクチャ設計', 'PM/Architect', '2.5', '180', '450', '業務フロー策定、PoC検証'],
        ['2.1', 'バックエンドAPI開発', 'Senior SE', '8.0', '120', '960', 'Go / REST API 15エンドポイント'],
        ['2.2', 'フロントエンド画面開発', 'SE', '6.0', '90', '540', 'React 管理画面 12画面'],
        ['2.3', 'DB移行スクリプト開発', 'Senior SE', '3.0', '120', '360', 'Oracle → PostgreSQL マイグレーション'],
        ['3.0', 'インフラ構築 (AWS / EKS)', 'Senior SE', '4.0', '120', '480', 'IaC Terraform, CI/CDパイプライン'],
        ['4.0', '総合テスト・シナリオ試験', 'SE', '4.5', '90', '405', '結合試験、負荷試験 (5,000 rps)'],
        ['5.0', '移行リハーサル & 本番切替', 'PM/PL', '2.0', '150', '300', '夜間Blue-Green切替、切り戻し訓練'],
        ['6.0', 'プロジェクト管理・品質推進', 'PM', '3.0', '180', '540', '進捗管理、課題管理、ステコミ運営'],
        ['9.0', 'リスクバッファ (予備費)', 'ALL', '1.5', '120', '180', '仕様変更・外部調整用（約5%）'],
        ['合計', '全フェーズ総合計', '', '34.5', '', '4,215', '税抜合計金額']
    ];
    const wsBreakdown = XLSX.utils.aoa_to_sheet(breakdownData);
    XLSX.utils.book_append_sheet(wb, wsBreakdown, '工数内訳・計算根拠');

    // Sheet 3: 単価マスター
    const rateData = [
        ['ロール名', '標準単価(万円/人月)', '役割定義・適用基準'],
        ['PM (Project Manager)', '180', '全体統括、ステコミ報告、クリティカルリスクマネジメント'],
        ['PL / Lead Architect', '150', '設計リード、技術意思決定、チームリード'],
        ['Senior SE', '120', 'コア機能実装、インフラ構築、性能チューニング'],
        ['SE', '90', '機能実装、単体/結合テスト作成、仕様調査'],
        ['PG / Tester', '70', '定型実装、テスト実行、データ作成']
    ];
    const wsRate = XLSX.utils.aoa_to_sheet(rateData);
    XLSX.utils.book_append_sheet(wb, wsRate, '単価マスター');

    // Sheet 4: 改訂履歴
    const historyData = [
        ['バージョン', '改訂日', '改訂者', '改訂内容サマリー'],
        ['v1.0', '2024/04/15', '田中 (PM)', '初回ドラフト版作成 (概算 38人月)'],
        ['v2.0', '2024/05/10', '田中 (PM)', '要件見直しに伴いフロント画面数を削減 (-3.5人月)']
    ];
    const wsHistory = XLSX.utils.aoa_to_sheet(historyData);
    XLSX.utils.book_append_sheet(wb, wsHistory, '改訂履歴');

    const filePath = path.join(outputDir, '01_2024_A社_基幹刷新_工数見積書_v2.0.xlsx');
    XLSX.writeFile(wb, filePath);
    console.log(`[Generated] ${filePath}`);
}

/**
 * 2. 02_2025_B社_APIGW移行_見積算出シート_fix.xlsx の生成
 */
function generateExcelB() {
    const wb = XLSX.utils.book_new();

    const summaryData = [
        ['【B社 APIGWクラウド移行 見積サマリー】'],
        ['総工数', '14.5 人月'],
        ['概算提示額', '¥ 18,500,000 (税抜)'],
        ['', ''],
        ['カテゴリ', '工数(人月)', '概算費用(万円)', '備考'],
        ['APIGW 認証プラグイン開発', '4.0', '480', 'OAuth 2.1 / mTLS対応'],
        ['レートリミット Redis連携', '2.5', '300', 'Redis Cluster 負荷分散'],
        ['カナリアリリースコントローラー', '3.0', '360', 'Istio / Envoy 設定自動化'],
        ['移行リハーサル・スモークテスト', '3.0', '360', 'ステージングでの48hソーク試験'],
        ['PM / プロジェクト管理', '2.0', '350', '隔週定例報告、課題管理']
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, '見積サマリー');

    const filePath = path.join(outputDir, '02_2025_B社_APIGW移行_見積算出シート_fix.xlsx');
    XLSX.writeFile(wb, filePath);
    console.log(`[Generated] ${filePath}`);
}

/**
 * 3. 03_2025_C社_クラウド移行_費用算出.xlsx の生成
 */
function generateExcelC() {
    const wb = XLSX.utils.book_new();

    const data = [
        ['項目', '工数(人月)', '単価(万円)', '費用(万円)', '値引き・調整', '最終請求額'],
        ['AWS インフラ環境構築 (Terraform)', '3.0', '120', '360', '0', '360'],
        ['コンテナ化 (ECS Fargate)', '2.5', '120', '300', '-30', '270'],
        ['監視・ロギング (Datadog)', '1.5', '100', '150', '0', '150'],
        ['初期移行サポート', '1.0', '100', '100', '0', '100'],
        ['合計', '8.0', '', '910', '-30', '880']
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, '費用明細');

    const filePath = path.join(outputDir, '03_2025_C社_クラウド移行_費用算出.xlsx');
    XLSX.writeFile(wb, filePath);
    console.log(`[Generated] ${filePath}`);
}

/**
 * 4. 04_提案書_システム方式設計_抜粋.pptx の生成
 */
async function generatePptx() {
    const zip = new JSZip();

    // 基本構造
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/notesSlides/notesSlide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>
</Types>`);

    // slide1.xml
    zip.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp><p:txBody><a:p><a:r><a:t>2024-2025 基幹系システム刷新 方式設計概要</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:txBody>
        <a:p><a:r><a:t>・マイクロサービス化による柔軟な機能拡張性の実現</a:t></a:r></a:p>
        <a:p><a:r><a:t>・AWS / EKS基盤への全面移行とゼロダウンタイムBlue-Greenデプロイ</a:t></a:r></a:p>
      </p:txBody></p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`);

    // slide2.xml
    zip.file('ppt/slides/slide2.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp><p:txBody><a:p><a:r><a:t>段階的Stranglerパターンによる移行戦略</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:txBody>
        <a:p><a:r><a:t>・Phase 1: API Gatewayによるトラフィックルーティングの先行確立</a:t></a:r></a:p>
        <a:p><a:r><a:t>・Phase 2: 参照系APIから順次新マイクロサービスへ切り替え</a:t></a:r></a:p>
        <a:p><a:r><a:t>・Phase 3: 更新系トランザクションのデュアルライト・整合性同期</a:t></a:r></a:p>
      </p:txBody></p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`);

    // notesSlide2.xml (発表者ノート・重要暗黙知)
    zip.file('ppt/notesSlides/notesSlide2.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp><p:txBody>
        <a:p><a:r><a:t>【口頭補足メモ・注意点】現行Oracle DBとPostgreSQL間のレプリケーション遅延がピーク時に最大3秒発生する懸念あり。見積もり段階でデュアルライト時の整合性リトライ機構の工数（約1.5人月）を必ず含めておくこと。</a:t></a:r></a:p>
      </p:txBody></p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`);

    const content = await zip.generateAsync({ type: 'nodebuffer' });
    const filePath = path.join(outputDir, '04_提案書_システム方式設計_抜粋.pptx');
    fs.writeFileSync(filePath, content);
    console.log(`[Generated] ${filePath}`);
}

/**
 * 5. 05_要件定義書_非機能要件_サンプル.docx の生成
 */
async function generateDocx() {
    const doc = new Document({
        sections: [{
            children: [
                new Paragraph({
                    text: '非機能要件定義書（抜粋サンプル）',
                    heading: HeadingLevel.HEADING_1
                }),
                new Paragraph({
                    text: '1. 可用性および性能目標',
                    heading: HeadingLevel.HEADING_2
                }),
                new Paragraph({
                    children: [
                        new TextRun('本システムは月間稼働率 99.99% 以上を目標とする。ALB配下の各Podは最低2AZに分散配置し、1AZ障害時でも縮退なしで継続稼働すること。'),
                    ]
                }),
                new Paragraph({
                    text: '2. 認証・セキュリティ要件',
                    heading: HeadingLevel.HEADING_2
                }),
                new Paragraph({
                    children: [
                        new TextRun('全外部通信は mTLS / OAuth 2.1 トークンによる署名検証を必須とし、トークンの有効期限は最大15分とする。'),
                    ]
                }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        new TableRow({
                            children: [
                                new TableCell({ children: [new Paragraph('要件項目')] }),
                                new TableCell({ children: [new Paragraph('目標値 / 規準')] }),
                                new TableCell({ children: [new Paragraph('備考・検証方法')] }),
                            ]
                        }),
                        new TableRow({
                            children: [
                                new TableCell({ children: [new Paragraph('目標レイテンシ (p99)')] }),
                                new TableCell({ children: [new Paragraph('50ms 以内')] }),
                                new TableCell({ children: [new Paragraph('Datadog APM にて常時測定')] }),
                            ]
                        }),
                        new TableRow({
                            children: [
                                new TableCell({ children: [new Paragraph('最大目標スループット')] }),
                                new TableCell({ children: [new Paragraph('5,000 req/sec')] }),
                                new TableCell({ children: [new Paragraph('Locust による負荷試験実施')] }),
                            ]
                        })
                    ]
                })
            ]
        }]
    });

    const buffer = await Packer.toBuffer(doc);
    const filePath = path.join(outputDir, '05_要件定義書_非機能要件_サンプル.docx');
    fs.writeFileSync(filePath, buffer);
    console.log(`[Generated] ${filePath}`);
}

async function main() {
    ensureDirectory(outputDir);
    console.log(`=== 実務再現テストデータの生成を開始 ===`);
    generateExcelA();
    generateExcelB();
    generateExcelC();
    await generatePptx();
    await generateDocx();
    console.log(`=== 全テストデータの生成完了: ${outputDir} ===`);
}

main().catch(err => {
    console.error('Error generating mock fixtures:', err);
    process.exit(1);
});
