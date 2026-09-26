import time
import json
import concurrent.futures
import random
import urllib.request
import urllib.error

PROMPTS = [
    "Say just 1 word: apple",
    "What is 5 + 7? 1 word.",
    "Reply with only: OK",
    "Name a color in one word",
    "What is the capital of India? 1 word.",
    "Say hello in Hindi in 1 word",
    "What is 10 * 10? 1 word.",
    "What day comes after Monday? 1 word."
]

ENDPOINT = "http://127.0.0.1:3000/v1/chat/completions"
DURATION_SECONDS = 120  # 2 minutes

start_time = time.time()
end_time = start_time + DURATION_SECONDS

stats = {
    "total": 0,
    "success": 0,
    "failed": 0,
    "status_codes": {},
    "errors": [],
    "latencies": []
}

def send_request(req_id):
    prompt = random.choice(PROMPTS)
    payload = json.dumps({
        "model": "gemini-3.7-flash",
        "messages": [{"role": "user", "content": prompt}],
        "stream": False
    }).encode("utf-8")

    req = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json"}
    )

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            latency = round(time.time() - t0, 2)
            code = resp.status
            stats["status_codes"][code] = stats["status_codes"].get(code, 0) + 1
            stats["total"] += 1
            
            body = resp.read().decode("utf-8")
            data = json.loads(body)
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            stats["success"] += 1
            stats["latencies"].append(latency)
            elapsed_sec = int(time.time() - start_time)
            print(f"[{elapsed_sec}s] Req #{stats['total']}: SUCCESS (200) - Latency: {latency}s - Resp: {content[:35].strip()}", flush=True)

    except urllib.error.HTTPError as e:
        latency = round(time.time() - t0, 2)
        code = e.code
        stats["status_codes"][code] = stats["status_codes"].get(code, 0) + 1
        stats["total"] += 1
        stats["failed"] += 1
        err_body = e.read().decode("utf-8", errors="ignore")[:100]
        stats["errors"].append(f"HTTP {code}: {err_body}")
        elapsed_sec = int(time.time() - start_time)
        print(f"[{elapsed_sec}s] Req #{stats['total']}: FAILED ({code}) - Latency: {latency}s - Body: {err_body}", flush=True)

    except Exception as e:
        stats["total"] += 1
        stats["failed"] += 1
        stats["errors"].append(str(e))
        elapsed_sec = int(time.time() - start_time)
        print(f"[{elapsed_sec}s] Req #{stats['total']}: EXCEPTION - {str(e)}", flush=True)

print("=== STARTING 2-MINUTE PEAK STRESS TEST ===", flush=True)
print(f"Target: {ENDPOINT}", flush=True)
print(f"Duration: {DURATION_SECONDS} seconds", flush=True)
print("Concurrency: 2 concurrent workers sending rapid continuous requests\n", flush=True)

with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    req_counter = 0
    futures = set()
    while time.time() < end_time:
        while len(futures) < 2 and time.time() < end_time:
            req_counter += 1
            f = executor.submit(send_request, req_counter)
            futures.add(f)
            time.sleep(0.1)
        
        done, futures = concurrent.futures.wait(futures, timeout=0.5, return_when=concurrent.futures.FIRST_COMPLETED)

# Wait for remaining
for f in futures:
    try:
        f.result()
    except Exception:
        pass

elapsed = round(time.time() - start_time, 2)
avg_lat = round(sum(stats["latencies"]) / len(stats["latencies"]), 2) if stats["latencies"] else 0

print("\n" + "="*50, flush=True)
print("=== 2-MINUTE PEAK TEST SUMMARY RESULTS ===", flush=True)
print("="*50, flush=True)
print(f"Total Duration        : {elapsed} seconds", flush=True)
print(f"Total Requests Sent   : {stats['total']}", flush=True)
print(f"Successful (200 OK)   : {stats['success']} ({round(stats['success']/max(1, stats['total'])*100, 1)}%)", flush=True)
print(f"Failed Requests       : {stats['failed']}", flush=True)
print(f"Average Response Time : {avg_lat} seconds", flush=True)
print(f"Status Codes Breakdown: {stats['status_codes']}", flush=True)
if stats['errors']:
    print(f"Sample Errors         : {stats['errors'][:3]}", flush=True)
else:
    print("Verdict               : 100% SUCCESS! ZERO IP BLOCKS! NO THROTTLING!", flush=True)
print("="*50, flush=True)
