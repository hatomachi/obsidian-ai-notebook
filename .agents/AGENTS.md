# AGENTS.md - Obsidian AI Notebook Workspace Rules

## ビルドおよび動作検証ルール

1. **動作検証用 Vault パス**:
   - `/Users/s-ikari/work/playground/ainotebook-test-vault`

2. **プラグイン自動配置・同期設定**:
   - ビルド成果物の配備先: `/Users/s-ikari/work/playground/ainotebook-test-vault/.obsidian/plugins/obsidian-ai-notebook/`
   - `esbuild.config.mjs` にビルド終了フック (`copyPlugin`) が組み込まれています。
   - `npm run build` または `npm run dev` を実行すると、`main.js`, `manifest.json`, `styles.css` が上記検証用 Vault へ自動的に移送・同期されます。

3. **開発作業ガイドライン**:
   - コードの変更・修正を行った際は、常に `npm run build` を実行して検証用 Vault へ最新コードが反映されていることを確認・維持してください。
