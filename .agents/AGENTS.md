# AGENTS.md - Obsidian AI Notebook Workspace Rules

## 核心設計思想 & ドキュメント参照 (Core Concepts)

本プロジェクトの開発・機能拡張を行う際は、必ず以下の設計書およびコンセプト定義を参照・遵守してください。

1. **[設計コンセプト & アーキテクチャ思想 (concept.md)](file:///Users/s-ikari/work/obsidian-ai-notebook/concept.md)**:
   - **ナレッジ再帰育成型エコシステム (Recursive Knowledge Ecosystem)** の定義
   - Antigravity 2.0 / プロジェクトフォルダ型ナレッジ管理思想（すべての Notebook が対等なワークスペースであり、成果物が次のタスクのコンテキストになる）
   - Linked Context モデル（物理コピーではなく参照リンクによる動的コンテキスト結合）
2. **[設計仕様書 (design-doc.md)](file:///Users/s-ikari/work/obsidian-ai-notebook/design-doc.md)**:
   - データ構造・ID命名規則・3カラムUI/UX・Agent Adapterの抽象化設計
3. **[タスク管理チケット (TASK-021.md)](file:///Users/s-ikari/work/project/task-management/tickets/TASK-021.md)**:
   - 全体タスク・進捗状況

---

## ビルドおよび動作検証ルール

1. **動作検証用 Vault パス**:
   - `/Users/s-ikari/work/playground/ainotebook-test-vault`

2. **プラグイン自動配置・同期設定**:
   - ビルド成果物の配備先: `/Users/s-ikari/work/playground/ainotebook-test-vault/.obsidian/plugins/obsidian-ai-notebook/`
   - `esbuild.config.mjs` にビルド終了フック (`copyPlugin`) が組み込まれています。
   - `npm run build` または `npm run dev` を実行すると、`main.js`, `manifest.json`, `styles.css` が上記検証用 Vault へ自動的に移送・同期されます。

3. **開発作業ガイドライン**:
   - コードの変更・修正を行った際は、常に `npm run build` を実行して検証用 Vault へ最新コードが反映されていることを確認・維持してください。

---

## リリース & バージョン更新ルール (Release Workflow)

ユーザーが実機（Obsidian BRAT プラグイン等）で動作確認・アップデートを行うため、修正や機能追加を push して動作確認を依頼する際は、**必ずバージョンを更新し、Git タグを作成してプッシュすること**。

1. **バージョン番号の更新**:
   - `manifest.json` の `"version"`
   - `package.json` の `"version"`
   - （例: `0.2.0` -> `0.2.1`）
2. **ビルド & 同期**:
   - `npm run build` でビルド成果物を最新化。
3. **コミット & タグ作成 & プッシュ**:
   - `git add manifest.json package.json ...`
   - `git commit -m "chore(release): bump version to X.X.X"`
   - `git tag X.X.X`
   - `git push && git push --tags`
4. **GitHub Actions 自動リリース**:
   - プッシュされたタグにより `.github/workflows/release.yml` が自動実行され、GitHub Release が発行・配信されます。

