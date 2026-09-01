import * as XLSX from 'xlsx';

export class ExcelParser {
    /**
     * Excel バイナリ（Buffer/ArrayBuffer）またはファイルパスから構造化 Markdown を生成
     */
    public static parse(data: Buffer | ArrayBuffer, originalFilename: string): string {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buffer.length === 0) {
            throw new Error('ファイルデータが空（0バイト）です。ファイルが正しく保存・同期されているか確認してください。');
        }
        const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellFormula: true });

        const lines: string[] = [];
        lines.push(`# 📊 Excel 解析データ: ${originalFilename}`);
        lines.push(`- **シート総数**: ${workbook.SheetNames.length}`);
        lines.push(`- **シート一覧**: ${workbook.SheetNames.map(s => `\`${s}\``).join(', ')}`);
        lines.push('');

        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            lines.push(`## 📄 シート: ${sheetName}`);
            lines.push('');

            if (!sheet || !sheet['!ref']) {
                lines.push('*（空のシート）*');
                lines.push('');
                continue;
            }

            // 2次元配列として取得
            const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
                header: 1,
                raw: false,
                defval: ''
            });

            if (rows.length === 0) {
                lines.push('*（データ行なし）*');
                lines.push('');
                continue;
            }

            // 空行を除去しつつ、有効な列の最大数を算出
            const cleanedRows = rows.map(r => r.map(c => String(c ?? '').trim()));
            const maxCols = Math.max(...cleanedRows.map(r => r.length), 1);

            // 表ヘッダーとデータ行を構成
            const headerRow = cleanedRows[0] || [];
            while (headerRow.length < maxCols) headerRow.push('');

            // ヘッダー行
            const headerCells = headerRow.map((c, i) => c || `列${i + 1}`);
            lines.push(`| ${headerCells.join(' | ')} |`);
            lines.push(`| ${headerCells.map(() => '---').join(' | ')} |`);

            // データ行
            for (let i = 1; i < cleanedRows.length; i++) {
                const row = cleanedRows[i];
                // 全セルが空の行はスキップ
                if (row.every(c => !c)) continue;

                while (row.length < maxCols) row.push('');
                // 改行やパイプ文字のエスケープ
                const escapedRow = row.map(c => c.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>'));
                lines.push(`| ${escapedRow.join(' | ')} |`);
            }

            lines.push('');
        }

        return lines.join('\n');
    }
}
