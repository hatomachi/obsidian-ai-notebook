import { ConfluenceChaosSimulator } from './confluence-mock-server';

const port = parseInt(process.env.PORT || '3333', 10);
const simulator = new ConfluenceChaosSimulator();

simulator.start(port).then((actualPort) => {
    console.log(`\n======================================================`);
    console.log(`🌪️ Confluence Chaos Simulator is running on port ${actualPort}`);
    console.log(`- Base URL: http://localhost:${actualPort}`);
    console.log(`- Search API: http://localhost:${actualPort}/rest/api/content/search?cql=text~"認証"`);
    console.log(`- Total pages: ${simulator.getAllPages().length} pages generated`);
    console.log(`Press Ctrl+C to stop.`);
    console.log(`======================================================\n`);
}).catch((err) => {
    console.error('Failed to start Confluence Chaos Simulator:', err);
    process.exit(1);
});
