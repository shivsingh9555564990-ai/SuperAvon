import time
import urllib.request
import json
import sys

TARGET_URL = "http://127.0.0.1:3000/v1/chat/completions"
DURATION_SECONDS = 120  # 2 minutes continuous load test

results = {
    "total": 0,
    "success": 0,
    "failed": 0,
    "errors": [],
    "latencies": []
}

prompts = [
    "Tell me a 1-sentence joke.",
    "What is 15 * 4?",
    "Give me one motivating word.",
    "Name a color of the sky.",
    "Say hi in Spanish.",
    "What is the capital of France?",
    "Translate 'Good morning' to Hindi.",
    "Name a fast animal.",
    "Give me a 3-word quote.",
    "What is 9 + 10?"
]

start_time = time.time()
print("[*] Starting 2-minute continuous stress test against Cloudflare Relay...", flush=True)
print(f"[*] Target: {TARGET_URL}", flush=True)

idx = 0
while time.time() - start_time < DURATION_SECONDS:
    prompt = prompts[idx % len(prompts)]
    idx += 1
    req_start = time.time()
    results["total"] += 1

    payload = json.dumps({
        "model": "gemini-3.7-flash",
        "messages": [{"role": "user", "content": prompt}],
        "stream": False
    }).encode("utf-8")

    req = urllib.request.Request(
        TARGET_URL,
        data=payload,
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            latency = round(time.time() - req_start, 2)
            results["latencies"].append(latency)
            body = resp.read().decode("utf-8")
            data = json.loads(body)
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            if content:
                results["success"] += 1
                elapsed = int(time.time() - start_time)
                clean_preview = content.replace('\n', ' ')[:35]
                print(f"[{elapsed}s] Req #{results['total']} PASSED ({latency}s) -> {clean_preview}...", flush=True)
            else:
                results["failed"] += 1
                results["errors"].append(f"Empty content: {body[:100]}")
                print(f"[{int(time.time() - start_time)}s] Req #{results['total']} FAILED (Empty content)", flush=True)

    except urllib.error.HTTPError as e:
        latency = round(time.time() - req_start, 2)
        results["latencies"].append(latency)
        results["failed"] += 1
        err_msg = f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:100]}"
        results["errors"].append(err_msg)
        print(f"[{int(time.time() - start_time)}s] Req #{results['total']} FAILED ({err_msg})", flush=True)

    except Exception as e:
        latency = round(time.time() - req_start, 2)
        results["latencies"].append(latency)
        results["failed"] += 1
        results["errors"].append(str(e))
        print(f"[{int(time.time() - start_time)}s] Req #{results['total']} EXCEPTION: {e}", flush=True)

    time.sleep(0.15)

total_time = round(time.time() - start_time, 2)
avg_latency = round(sum(results["latencies"]) / len(results["latencies"]), 2) if results["latencies"] else 0
min_latency = min(results["latencies"]) if results["latencies"] else 0
max_latency = max(results["latencies"]) if results["latencies"] else 0

summary = f"""
===================================================
PEAK LOAD TEST SUMMARY (2 MINUTES CONTINUOUS)
===================================================
Total Test Duration: {total_time}s
Total Requests Sent: {results['total']}
Successful Requests: {results['success']} ({(results['success']/results['total'])*100:.1f}%)
Failed Requests:     {results['failed']}

Latencies:
- Average: {avg_latency}s
- Min:     {min_latency}s
- Max:     {max_latency}s

IP Block / Error Details:
{json.dumps(results['errors'][:10], indent=2) if results['errors'] else 'NONE! ZERO IP BLOCKS OR RATE LIMITS! (100% HEALTHY)'}
===================================================
"""

print(summary, flush=True)
with open("/tmp/peak_test_summary.txt", "w") as f:
    f.write(summary)
