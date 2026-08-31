import * as fs from 'fs';
import * as path from 'path';
import { TranscriptionService } from '../src/services/transcription/TranscriptionService';

const fixturesDir = path.resolve(__dirname, '../tests/fixtures/sample_estimates');

async function test() {
    const files = fs.readdirSync(fixturesDir).filter(f => !f.startsWith('.'));
    console.log(`=== Transcription 変換テスト開始 (${files.length} ファイル) ===\n`);

    for (const file of files) {
        const filePath = path.join(fixturesDir, file);
        const buffer = fs.readFileSync(filePath);

        console.log(`----------------------------------------`);
        console.log(`Testing file: ${file} (${buffer.length} bytes)`);
        console.log(`isTranscribable: ${TranscriptionService.isTranscribable(file)}`);

        if (TranscriptionService.isTranscribable(file)) {
            const { markdown, convertedFilename } = await TranscriptionService.transcribe(buffer, file);
            console.log(`Converted filename: ${convertedFilename}`);
            console.log(`Output Markdown preview (first 40 lines):\n`);
            const preview = markdown.split('\n').slice(0, 40).join('\n');
            console.log(preview);
            console.log(`\n(Total Markdown lines: ${markdown.split('\n').length})\n`);
        }
    }

    console.log(`=== 全ファイル変換テスト完了 ===`);
}

test().catch(err => {
    console.error('Transcription test failed:', err);
    process.exit(1);
});
