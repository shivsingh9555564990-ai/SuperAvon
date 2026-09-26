import http from 'http';

const PROMPTS = [
  "Say just 1 word: apple",
  "What is 5 + 7?",
  "Reply with only: OK",
  "Name a color in one word",
  "What is the capital of India? 1 word.",
  "Say hello in Hindi in 1 word",
  "What is 10 * 10?",
  "What day comes after Monday? 1 word."
];

const ENDPOINT = "http://127.0.0.1:3000/v1/chat/completions";
const DURATION_SECONDS = 120; // 2 minutes

const startTime = Date.now();
const endTime = startTime + DURATION_SECONDS * 1000;

const stats = {
  total: 0,
  success: 0,
  failed: 0,
  statusCodes: {},
  errors: [],
  latencies: []
};

async function sendRequest(workerId) {
  while (Date.now() < endTime) {
    const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    const payload = JSON.stringify({
      model: "gemini-3.7-flash",
      messages: [{ role: "user", content: prompt }],
      stream: false
    });

    const t0 = Date.now();
    try {
      const resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
      });

      const latency = ((Date.now() - t0) / 1000).toFixed(2);
      const code = resp.status;
      stats.statusCodes[code] = (stats.statusCodes[code] || 0) + 1;
      stats.total++;

      if (code === 200) {
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content || "";
        stats.success++;
        stats.latencies.push(parseFloat(latency));
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        console.log(`[${elapsedSec}s] Req #${stats.total} (W${workerId}): SUCCESS (200) - Latency: ${latency}s - Resp: ${content.slice(0, 35).replace(/\n/g, ' ').trim()}`);
      } else {
        stats.failed++;
        const text = await resp.text();
        stats.errors.push(`HTTP ${code}: ${text.slice(0, 100)}`);
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        console.log(`[${elapsedSec}s] Req #${stats.total} (W${workerId}): FAILED (${code}) - Body: ${text.slice(0, 60)}`);
      }
    } catch (err) {
      stats.total++;
      stats.failed++;
      stats.errors.push(err.message);
      console.log(`Req #${stats.total} (W${workerId}): ERROR - ${err.message}`);
    }

    // Small delay between requests per worker thread to maintain smooth flow
    await new Promise(r => setTimeout(r, 200));
  }
}

console.log("=== STARTING 2-MINUTE PEAK STRESS TEST (Node.js) ===");
console.log(`Target: ${ENDPOINT}`);
console.log(`Duration: ${DURATION_SECONDS} seconds`);
console.log("Concurrency: 2 concurrent workers sending rapid continuous requests\n");

// Run 2 concurrent worker loops
await Promise.all([sendRequest(1), sendRequest(2)]);

const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
const avgLatency = stats.latencies.length > 0 
  ? (stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length).toFixed(2)
  : "0";

console.log("\n=============================================");
console.log("=== 2-MINUTE PEAK TEST SUMMARY RESULTS ===");
console.log("=============================================");
console.log(`Total Duration       : ${totalTime}s`);
console.log(`Total Requests Sent  : ${stats.total}`);
console.log(`Successful (200 OK)  : ${stats.success} (${((stats.success / Math.max(1, stats.total)) * 100).toFixed(1)}%)`);
console.log(`Failed Requests      : ${stats.failed}`);
console.log(`Average Latency      : ${avgLatency}s`);
console.log(`Status Codes Breakdown: ${JSON.stringify(stats.statusCodes)}`);
if (stats.errors.length > 0) {
  console.log(`Sample Errors        : ${JSON.stringify(stats.errors.slice(0, 3))}`);
} else {
  console.log("Verdict              : 100% PASS! No IP block, No rate limits, Zero 429/403!");
}
console.log("=============================================");
