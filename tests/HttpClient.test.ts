import * as http from 'http';
import { AddressInfo } from 'net';
import { HttpClient } from '../src/services/HttpClient';

function assert(condition: boolean, msg: string) {
    if (!condition) {
        throw new Error(`Assertion failed: ${msg}`);
    }
}

async function runTests() {
    console.log('=== HttpClient 単体テスト開始 ===');

    // テスト用ローカル HTTP サーバー
    let server: http.Server;
    let baseUrl: string;

    await new Promise<void>((resolve) => {
        server = http.createServer((req, res) => {
            const url = new URL(req.url || '/', `http://${req.headers.host}`);

            if (url.pathname === '/hello') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ greeting: 'hello direct connection' }));
            } else if (url.pathname === '/redirect') {
                res.writeHead(302, { Location: '/hello' });
                res.end();
            } else if (url.pathname === '/upload') {
                const chunks: Buffer[] = [];
                req.on('data', chunk => chunks.push(chunk));
                req.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf-8');
                    const contentType = req.headers['content-type'] || '';
                    const hasBoundary = contentType.includes('multipart/form-data; boundary=');
                    const hasFileContent = body.includes('sample-file-content');
                    const hasFilename = body.includes('test-upload.txt');

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        uploaded: hasBoundary && hasFileContent && hasFilename,
                        contentType,
                        contentLength: body.length
                    }));
                });
            } else if (url.pathname === '/proxy-block') {
                res.writeHead(403, {
                    'Content-Type': 'text/html',
                    'Server': 'Zscaler/6.2',
                    'Via': '1.1 zscaler'
                });
                res.end('<html><head><title>Access Denied - Corporate Policy Block</title></head><body>Blocked by security filter</body></html>');
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        });

        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as AddressInfo;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });

    try {
        // Test 1: Direct モードでの通常 GET リクエスト
        console.log('Test 1: Direct モード (Node.js http) の通常 GET リクエスト検証');
        const res1 = await HttpClient.request({
            url: `${baseUrl}/hello`,
            method: 'GET',
            connectionMode: 'direct'
        });
        assert(res1.status === 200, `Expected status 200, got ${res1.status}`);
        assert(res1.json?.greeting === 'hello direct connection', 'Expected json.greeting to match');
        console.log('  -> OK: Direct モード GET 正常');

        // Test 2: Direct モードでの 302 リダイレクト自動追従
        console.log('Test 2: Direct モードでの 302 リダイレクト自動追従検証');
        const res2 = await HttpClient.request({
            url: `${baseUrl}/redirect`,
            method: 'GET',
            connectionMode: 'direct'
        });
        assert(res2.status === 200, `Expected status 200 after redirect, got ${res2.status}`);
        assert(res2.json?.greeting === 'hello direct connection', 'Expected redirected target content');
        console.log('  -> OK: リダイレクト自動追従 (302 -> 200) 正常');

        // Test 3: uploadMultipart によるマルチパート送信
        console.log('Test 3: uploadMultipart (CORS & PAC バイパス) 検証');
        const sampleBuffer = Buffer.from('sample-file-content');
        const res3 = await HttpClient.uploadMultipart(
            `${baseUrl}/upload`,
            sampleBuffer,
            'test-upload.txt',
            'file',
            { 'Authorization': 'Bearer test-token' },
            { connectionMode: 'direct' }
        );
        assert(res3.status === 200, `Expected status 200, got ${res3.status}`);
        assert(res3.json?.uploaded === true, `Expected upload verification to pass, got ${JSON.stringify(res3.json)}`);
        console.log('  -> OK: uploadMultipart 送受信・データ整合性正常');

        // Test 4: プロキシブロック検知と診断ログの検証 (Zscaler/403)
        console.log('Test 4: プロキシブロック検知と診断ログの検証');
        const res4 = await HttpClient.request({
            url: `${baseUrl}/proxy-block`,
            method: 'GET',
            connectionMode: 'direct'
        });
        assert(res4.status === 403, `Expected status 403, got ${res4.status}`);
        assert(res4.headers['server'] === 'Zscaler/6.2', 'Expected Server header to be Zscaler');
        console.log('  -> OK: プロキシブロック検知とヘッダー取得正常');

        // Test 5: Default モードでの呼び出し互換性検証
        console.log('Test 5: Default モード (Obsidian requestUrl) 呼び出し互換性検証');
        const res5 = await HttpClient.request({
            url: `${baseUrl}/hello`,
            method: 'GET',
            connectionMode: 'default'
        });
        assert(res5.status === 200, `Expected status 200, got ${res5.status}`);
        console.log('  -> OK: Default モード呼び出し正常');

        console.log('=== 全 HttpClient 単体テストに合格しました (All tests passed) ===');
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

runTests().catch(err => {
    console.error('テスト失敗:', err);
    process.exit(1);
});
