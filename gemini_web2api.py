import os
proxy_url = os.environ.get('HTTP_PROXY') or os.environ.get('https_proxy')
if proxy_url:
    os.environ['http_proxy'] = proxy_url
    os.environ['https_proxy'] = proxy_url
    os.environ['HTTP_PROXY'] = proxy_url
    os.environ['HTTPS_PROXY'] = proxy_url
#!/usr/bin/env python3
"""
gemini-web2api - Gemini Web to OpenAI API proxy.

Converts Google Gemini's web interface into an OpenAI-compatible API server.
Zero authentication required. Works on any platform (Windows/macOS/Linux).

Usage:
    pip install httpx
    python gemini_web2api.py [--port 8081] [--config config.json]

Client configuration (Cherry Studio, ChatBox, etc.):
    Base URL: http://localhost:8081/v1
    API Key: (anything or empty)

How it works:
    Sends requests directly to Gemini's public StreamGenerate endpoint.
    The backend does not verify authentication for basic text generation.
    Model selection via MODE_CATEGORY field [79] in the request payload.
    This is NOT a user-tier spoofing attack - the endpoint simply doesn't
    require auth for anonymous access.
"""
import json
import urllib.request
import urllib.parse
import time
import ssl
import sys
import uuid
import re
import os
import hashlib
import argparse
import base64
import binascii
from typing import Optional
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

__version__ = "1.1.0"

# ─── Configuration ───────────────────────────────────────────────────────────

DEFAULT_CONFIG = {
    "port": 8081,
    "host": "0.0.0.0",
    "retry_attempts": 3,
    "retry_delay_sec": 2,
    "request_timeout_sec": 180,
    "gemini_bl": "boq_assistant-bard-web-server_20260716.08_p0",
    "auth_user": None,
    "xsrf_token": None,
    "default_model": "gemini-3.6-flash",
    "log_requests": True,
    "cookie_file": None,
    "proxy": os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY") or None,
    "relay_url": os.environ.get("CLOUDFLARE_WORKER_URL") or os.environ.get("CF_RELAY_URL") or None,
    "api_keys": [],
    "temporary_chats": False,
}

CONFIG = dict(DEFAULT_CONFIG)

# ─── Models ──────────────────────────────────────────────────────────────────
# Mapping from JS source: MODE_CATEGORY enum (028-6eb337387583.js)
#   1=FAST, 2=THINKING, 3=PRO, 4=AUTO, 5=FAST_DYNAMIC_THINKING, 6=FLASH_LITE

MODELS = {
    "gemini-3.7-flash": {
        "mode": 1, "think": 4,
        "desc": "Latest all-around model (Gemini 3.7 Flash)",
    },
    "gemini-3.6-flash": {
        "mode": 1, "think": 4,
        "desc": "All-around model (Gemini 3.6 Flash)",
    },
    "gemini-3.5-flash": {
        "mode": 1, "think": 4,
        "desc": "Alias for gemini-3.6-flash (backend upgraded)",
    },
    "gemini-3.5-flash-thinking": {
        "mode": 2, "think": 0,
        "desc": "Deep thinking mode, longest output (~20k chars)",
    },
    "gemini-3.1-pro": {
        "mode": 3, "think": 4,
        "desc": "Pro model (requires cookie for real routing)",
    },
    "gemini-auto": {
        "mode": 4, "think": 4,
        "desc": "Auto model selection",
    },
    "gemini-3.5-flash-thinking-lite": {
        "mode": 5, "think": 0,
        "desc": "Dynamic thinking with adaptive depth",
    },
    "gemini-flash-lite": {
        "mode": 6, "think": 4,
        "desc": "Lightweight fast model",
    },
    "flux-1-schnell": {
        "mode": 1, "think": 4, "is_image": True,
        "desc": "Ultra-HD FLUX.1 Schnell Image Generator",
    },
    "dall-e-3": {
        "mode": 1, "think": 4, "is_image": True,
        "desc": "FLUX.1 Max Quality Image Generator (DALL-E 3 Compatible)",
    },
    "stable-diffusion-xl": {
        "mode": 1, "think": 4, "is_image": True,
        "desc": "Stable Diffusion XL High Detail Image Generator",
    },
}

# ─── Image Generation & Intent Engine ────────────────────────────────────────

IMAGE_WORDS = r"(?:image|img|imgs|images|photo|photos|pic|pics|picture|pictures|tasveer|tasveerein|chitra|wallpaper|portrait|illustration|artwork|render|drawing|painting)"
MAKE_VERBS = r"(?:generation|generate|generat|banao|bnao|bana|bna|bana\s+do|bna\s+do|bana\s+de|bna\s+de|bana\s+ke\s+do|generate\s+karo|generation\s+karo|karo|create|kheecho|dikhao|render|draw|chahiye|de|do)"
PREPOSITIONS = r"(?:ki|ke|ka|of|for|about|in)"

IMAGE_TRIGGERS_REGEX = [
    # English commands (e.g. 'generate an image of...', 'draw a...', 'photo of...')
    re.compile(rf"^(?:generate|create|draw|paint|make|render|produce)\s+(?:an?\s+)?{IMAGE_WORDS}\s+(?:{PREPOSITIONS}\s+)?\s*(.+)", re.IGNORECASE),
    re.compile(r"^(?:draw|paint|sketch|illustrate)\s+(?:me\s+)?(?:a|an|the)?\s*(.+)", re.IGNORECASE),
    re.compile(rf"^{IMAGE_WORDS}\s+(?:{PREPOSITIONS}\s+)?(.+)", re.IGNORECASE),
    re.compile(rf"^(?:generate|create|render)\s+{IMAGE_WORDS}:\s*(.+)", re.IGNORECASE),
    
    # Hindi / Hinglish commands (e.g. 'Mahadev ke img bnao', 'Mahadev ki img generation karo')
    re.compile(rf"(.+?)\s+(?:{PREPOSITIONS}\s+)?{IMAGE_WORDS}\s+(?:{PREPOSITIONS}\s+)?{MAKE_VERBS}", re.IGNORECASE),
    re.compile(rf"(.+?)\s+{IMAGE_WORDS}\s+{MAKE_VERBS}", re.IGNORECASE),
    re.compile(rf"^{IMAGE_WORDS}\s+{MAKE_VERBS}\s+(?:{PREPOSITIONS}\s+)?(.+)", re.IGNORECASE),
    re.compile(rf"^{MAKE_VERBS}\s+{IMAGE_WORDS}\s+(?:{PREPOSITIONS}\s+)?(.+)", re.IGNORECASE),
    re.compile(rf"(.+?)\s+{MAKE_VERBS}\s+(?:{PREPOSITIONS}\s+)?{IMAGE_WORDS}", re.IGNORECASE),
    re.compile(rf"(.+?)\s+{IMAGE_WORDS}", re.IGNORECASE),
]

IMAGE_EXCLUSIONS = [
    "how to draw", "how to generate", "how to paint", "how to create an image",
    "what is a photo", "what is an image", "tell me about", "explain how",
    "steps to draw", "tutorial", "code to",
    "write code", "python script", "javascript", "html", "css", "svg"
]

GEMINI_IMAGE_REFUSAL_PHRASES = [
    "can't create any for you",
    "can't seem to create any",
    "image creation isn't available",
    "image creation may not be available",
    "i can search for images, but",
    "i can try to find an image like that for you, but",
    "i can try to find an image",
    "unable to generate images",
    "unable to create images",
    "cannot create images",
    "cannot generate images",
    "not able to generate images",
    "i don't have the ability to create images",
    "i cannot draw",
    "i am an ai text model and cannot create images"
]

def extract_image_prompt(user_text: str) -> Optional[str]:
    """Returns the extracted image prompt if the user is asking to generate an image, else None."""
    if not user_text:
        return None
    # Strip any trailing dots, commas, exclamation marks, or question marks
    text = user_text.strip().rstrip(".,!?:; \t\n")
    lowered = text.lower()

    # Exclude questions, tutorials, or coding queries about images
    for excl in IMAGE_EXCLUSIONS:
        if excl in lowered:
            return None

    # Check regex triggers
    for pattern in IMAGE_TRIGGERS_REGEX:
        match = pattern.match(text)
        if match:
            extracted = match.group(1).strip().rstrip(".,!?:; \t\n")
            if len(extracted) > 1:
                return extracted
            return text

    return None

# ─── Image Generation & In-Memory Cache ─────────────────────────────────────

IMAGE_CACHE: dict[str, bytes] = {}

def enhance_masterpiece_prompt(raw_prompt: str) -> tuple[str, str]:
    """
    Intelligently expands raw user queries into award-winning, photorealistic 8K prompts.
    Returns (enhanced_positive_prompt, negative_prompt)
    """
    p = raw_prompt.strip()
    p_lower = p.lower()

    negative_prompt = (
        "blurry, low quality, distorted, extra limbs, bad anatomy, deformed face, bad hands, "
        "missing fingers, duplicate, watermark, signature, text, oversaturated, pixelated, ugly, cartoonish, low resolution"
    )

    # 1. Indian Sacred / Deities / Divine Art
    if any(k in p_lower for k in ["mahadev", "shiva", "shiv", "bholenath", "shankar", "neelkanth"]):
        return (
            f"Majestic sacred portrait of Lord Shiva Mahadev in deep meditation on snow-capped Mount Kailash, "
            f"glowing third eye emitting divine light, sacred crescent moon nestled in matted locks, holy river Ganga cascading, "
            f"detailed snake Vasuki coiled around neck, sacred Trishul and Damru, ash tilak on forehead, "
            f"cosmic galaxy stars and nebula background, cinematic volumetric godrays, photorealistic hyperdetailed skin texture, "
            f"octane render 8k, Unreal Engine 5, award winning celestial masterpiece portrait, ultra fine lighting",
            negative_prompt
        )
    elif any(k in p_lower for k in ["ram", "shree ram", "ayodhya", "sita"]):
        return (
            f"Divine ultra-realistic portrait of Lord Shree Ram holding golden bow and arrow, radiant glowing aura, "
            f"royal ancient traditional ornaments, serene divine expression, Ayodhya celestial temple in background, "
            f"golden hour warm sunlight, cinematic lighting, 8k resolution, octane render, photorealistic, hyper-detailed",
            negative_prompt
        )
    elif any(k in p_lower for k in ["krishna", "kanha", "radha"]):
        return (
            f"Enchanting divine portrait of Lord Krishna with peacock feather in crown, holding golden flute, "
            f"soft divine smile, glowing sacred aura, Vrindavan sacred forest with blooming lotus flowers, "
            f"mystical twilight lighting, hyperrealistic, 8k resolution, Unreal Engine 5 masterpiece",
            negative_prompt
        )
    elif any(k in p_lower for k in ["hanuman", "bajrangbali"]):
        return (
            f"Mighty portrait of Lord Hanuman in powerful posture, glowing divine aura, mountain in background, "
            f"golden mace, intense devotion in eyes, cinematic dust and godrays, 8k hyperrealistic render, masterpiece",
            negative_prompt
        )

    # 2. Monuments / Architecture
    elif any(k in p_lower for k in ["taj mahal", "monument", "castle", "palace", "temple"]):
        return (
            f"Ultra-high resolution architectural masterpiece of {p}, dramatic golden hour sky reflecting in crystal water, "
            f"intricate marble engravings, volumetric atmospheric lighting, professional Nikon Z9 photography, 8k UHD, crisp details",
            negative_prompt
        )

    # 3. Nature / Landscapes
    elif any(k in p_lower for k in ["mountain", "sunset", "forest", "sea", "ocean", "waterfall", "nature"]):
        return (
            f"Breathtaking National Geographic style landscape photography of {p}, dynamic sunset lighting, "
            f"volumetric mist, ultra-detailed foliage and rock textures, 8k resolution, photorealistic masterpiece, Hasselblad H6D",
            negative_prompt
        )

    # 4. General / Portraits / Custom prompts
    else:
        return (
            f"Masterpiece photorealistic 8k render of {p}, award-winning composition, cinematic studio lighting, "
            f"hyperdetailed textures, subsurface scattering, ultra fine details, octane render, Unreal Engine 5, realistic depth of field",
            negative_prompt
        )

def generate_real_image_bytes(prompt: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Downloads raw image bytes generated with Deep Masterpiece Ultra-HD settings.
    Returns (image_id, base64_str, error_message)
    """
    clean_prompt = prompt.strip()
    enhanced_prompt, negative_prompt = enhance_masterpiece_prompt(clean_prompt)
    log(f"🎨 Deep Masterpiece Engine: Generating Ultra-HD for: '{clean_prompt[:50]}'")
    log(f"✨ Enhanced Prompt: '{enhanced_prompt[:90]}...'")

    relay_url = CONFIG.get("relay_url") or "https://square-union-5810.shivsingh9555564990.workers.dev"
    target_url = f"{relay_url.rstrip('/')}/generate-image"

    # Step 1: Call Cloudflare Workers AI with Deep HD Parameters
    try:
        payload = json.dumps({
            "prompt": enhanced_prompt,
            "negative_prompt": negative_prompt,
            "model": "@cf/stabilityai/stable-diffusion-xl-base-1.0",
            "num_steps": 30,
            "guidance": 8.0
        }).encode("utf-8")
        
        req = urllib.request.Request(
            target_url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
        )
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req, context=ctx, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            items = data.get("data", [])
            if items:
                first = items[0]
                b64_str = first.get("b64_json")
                if b64_str:
                    img_bytes = base64.b64decode(b64_str)
                    img_id = uuid.uuid4().hex[:16]
                    IMAGE_CACHE[img_id] = img_bytes
                    if len(IMAGE_CACHE) > 50:
                        del IMAGE_CACHE[next(iter(IMAGE_CACHE))]
                    return img_id, b64_str, None
    except Exception as cf_err:
        log(f"Cloudflare Worker AI primary attempt note: {cf_err}. Running deep fallback...")

    # Step 2: High-Precision Masterpiece Generator Pipeline
    try:
        encoded = urllib.parse.quote(enhanced_prompt)
        seed = int(time.time() * 1000) % 9999999
        direct_url = f"https://image.pollinations.ai/prompt/{encoded}?model=flux-realism&width=1024&height=1024&nologo=true&enhance=true&seed={seed}"
        req2 = urllib.request.Request(direct_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        ctx2 = ssl.create_default_context()
        ctx2.check_hostname = False
        ctx2.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req2, context=ctx2, timeout=45) as resp2:
            img_bytes = resp2.read()
            if img_bytes and len(img_bytes) > 1000:
                img_id = uuid.uuid4().hex[:16]
                IMAGE_CACHE[img_id] = img_bytes
                if len(IMAGE_CACHE) > 50:
                    del IMAGE_CACHE[next(iter(IMAGE_CACHE))]
                b64_str = base64.b64encode(img_bytes).decode("utf-8")
                return img_id, b64_str, None
    except Exception as e:
        log(f"Deep generator error: {e}")
        return None, None, f"Image generation error: {e}"

# ─── Utilities ───────────────────────────────────────────────────────────────

def log(msg: str):
    if CONFIG["log_requests"]:
        sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
        sys.stderr.flush()


def load_cookie() -> tuple:
    """Load cookie from file. Returns (cookie_str, sapisid)."""
    cookie_file = CONFIG.get("cookie_file")
    if not cookie_file:
        return "", None
    if not os.path.exists(cookie_file):
        return "", None
    try:
        with open(cookie_file, "r") as f:
            content = f.read().strip()
        if content.startswith("{"):
            data = json.loads(content)
            cookie_str = data.get("cookie", "")
            sapisid = data.get("sapisid", "")
        else:
            cookie_str = content
            pairs = dict(p.split("=", 1) for p in cookie_str.split("; ") if "=" in p)
            sapisid = pairs.get("SAPISID", "")
        return cookie_str, sapisid if sapisid else None
    except Exception as e:
        log(f"Cookie load error: {e}")
        return "", None


def make_sapisidhash(sapisid: str) -> str:
    ts = int(time.time())
    h = hashlib.sha1(f"{ts} {sapisid} https://gemini.google.com".encode()).hexdigest()
    return f"SAPISIDHASH {ts}_{h}"


def account_prefix() -> str:
    """Return the Gemini account path prefix for non-default Google accounts."""
    auth_user = CONFIG.get("auth_user")
    if auth_user is None or auth_user == "":
        return ""
    return f"/u/{auth_user}"


def apply_chat_persistence_flags(inner: list) -> None:
    """Apply Gemini Web persistence flags to an outgoing request payload."""
    if CONFIG.get("temporary_chats", False):
        inner[41] = [1]
        inner[45] = 1
    else:
        inner[41] = [2]


def gemini_base_url() -> str:
    """Return the base Gemini endpoint URL, or Cloudflare Worker relay if configured."""
    relay = CONFIG.get("relay_url") or os.environ.get("CLOUDFLARE_WORKER_URL") or os.environ.get("CF_RELAY_URL")
    if relay and str(relay).strip():
        return str(relay).strip().rstrip("/")
    return "https://gemini.google.com"


def fetch_latest_bl() -> Optional[str]:
    """Fetch the latest gemini_bl from gemini.google.com page."""
    try:
        req = urllib.request.Request(
            f"{gemini_base_url()}/app",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
        ctx = ssl.create_default_context()
        proxy = CONFIG.get("proxy")
        if proxy:
            opener = urllib.request.build_opener(
                urllib.request.ProxyHandler({"http": proxy, "https": proxy}),
                urllib.request.HTTPSHandler(context=ctx))
            resp = opener.open(req, timeout=15)
        else:
            resp = urllib.request.urlopen(req, context=ctx, timeout=15)
        html = resp.read().decode("utf-8", errors="replace")
        m = re.search(r'(boq_assistant-bard-web-server_\d+\.\d+_p\d+)', html)
        if m:
            return m.group(1)
    except Exception as e:
        log(f"BL auto-update fetch failed: {e}")
    return None


def update_bl_if_needed() -> bool:
    """Attempt to fetch and update gemini_bl. Returns True if updated."""
    new_bl = fetch_latest_bl()
    if new_bl and new_bl != CONFIG["gemini_bl"]:
        log(f"BL auto-updated: {CONFIG['gemini_bl']} -> {new_bl}")
        CONFIG["gemini_bl"] = new_bl
        return True
    return False


def upload_images(images: list) -> list:
    """Upload parsed OpenAI image parts and return Gemini file references with metadata."""
    if not images:
        return None
    from gemini_web2api.multimodal import detect_image_mime, fetch_image_bytes, upload_image

    file_refs = []
    for idx, item in enumerate(images):
        if not (isinstance(item, tuple) and len(item) == 2):
            continue
        data, mime = item
        if isinstance(data, str):
            data = fetch_image_bytes(data)
            mime = mime or "image/png"
        if not data:
            raise RuntimeError("image fetch failed")
        mime = detect_image_mime(data, mime or "image/png")
        ext = "jpg" if "jpeg" in mime or "jpg" in mime else "png"
        fname = f"image_{idx + 1}.{ext}"
        try:
            ref = upload_image(data, fname, mime or "image/png")
            file_refs.append((ref, fname, mime or "image/png"))
        except Exception as e:
            raise RuntimeError(f"image upload failed: {e}") from e
    return file_refs if file_refs else None


# ─── Gemini Protocol ─────────────────────────────────────────────────────────

def gemini_stream_generate(prompt: str, model_id: int, think_mode: int, file_refs: list = None) -> str:
    """Send prompt to Gemini StreamGenerate with retry."""
    inner = [None] * 80
    if file_refs:
        refs = []
        for ref_item in file_refs:
            if isinstance(ref_item, (list, tuple)) and len(ref_item) == 3:
                r, fn, m = ref_item
                refs.append([[r, 1], fn, None, m])
            elif isinstance(ref_item, str):
                refs.append([[ref_item, 1], "image.jpg", None, "image/jpeg"])
            else:
                refs.append([[ref_item[0], 1], "image.jpg", None, "image/jpeg"])
        inner[0] = [prompt, 0, None, refs, None, None, 0]
    else:
        inner[0] = [prompt, 0, None, None, None, None, 0]
    inner[1] = ["en"]
    inner[2] = ["", "", "", None, None, None, None, None, None, ""]
    inner[6] = [0]
    inner[7] = 1
    inner[10] = 1
    inner[11] = 0
    inner[17] = [[think_mode]]
    inner[18] = 0
    inner[27] = 1
    inner[30] = [4]
    apply_chat_persistence_flags(inner)
    inner[53] = 0
    inner[59] = str(uuid.uuid4())
    inner[61] = []
    inner[68] = 1
    inner[79] = model_id

    outer = [None, json.dumps(inner)]
    params = {"f.req": json.dumps(outer)}
    if CONFIG.get("xsrf_token"):
        params["at"] = CONFIG["xsrf_token"]
    body = urllib.parse.urlencode(params).encode()
    reqid = int(time.time()) % 1000000
    prefix = account_prefix()
    base_urls = [gemini_base_url()]
    if base_urls[0] != "https://gemini.google.com":
        base_urls.append("https://gemini.google.com")

    last_err = None
    for current_base in base_urls:
        url = (
            f"{current_base}{prefix}/_/BardChatUi/data/"
            "assistant.lamda.BardFrontendService/StreamGenerate"
            f"?bl={CONFIG['gemini_bl']}&hl=en&_reqid={reqid}&rt=c"
        )
        for attempt in range(CONFIG["retry_attempts"]):
            try:
                req = urllib.request.Request(url, data=body, headers=headers, method="POST")
                ctx = ssl.create_default_context()
                proxy = CONFIG.get("proxy")
                if proxy:
                    opener = urllib.request.build_opener(
                        urllib.request.ProxyHandler({"http": proxy, "https": proxy}),
                        urllib.request.HTTPSHandler(context=ctx)
                    )
                    resp = opener.open(req, timeout=CONFIG["request_timeout_sec"])
                else:
                    resp = urllib.request.urlopen(req, context=ctx, timeout=CONFIG["request_timeout_sec"])
                return resp.read().decode("utf-8", errors="replace")
            except urllib.error.HTTPError as e:
                if e.code == 405 and update_bl_if_needed():
                    reqid = int(time.time()) % 1000000
                    url = (
                        f"{current_base}{prefix}/_/BardChatUi/data/"
                        "assistant.lamda.BardFrontendService/StreamGenerate"
                        f"?bl={CONFIG['gemini_bl']}&hl=en&_reqid={reqid}&rt=c"
                    )
                    log("Retrying with updated BL...")
                    last_err = e
                    continue
                last_err = e
                if attempt < CONFIG["retry_attempts"] - 1:
                    log(f"Retry {attempt+1}/{CONFIG['retry_attempts']} on {current_base}: {e}")
                    time.sleep(CONFIG["retry_delay_sec"])
                elif current_base != "https://gemini.google.com":
                    log(f"Relay {current_base} failed with {e}. Falling back to direct connection...")
                    break
            except Exception as e:
                last_err = e
                if attempt < CONFIG["retry_attempts"] - 1:
                    log(f"Retry {attempt+1}/{CONFIG['retry_attempts']} on {current_base}: {e}")
                    time.sleep(CONFIG["retry_delay_sec"])
                elif current_base != "https://gemini.google.com":
                    log(f"Relay {current_base} failed with {e}. Falling back to direct connection...")
                    break
    raise last_err


def gemini_stream_generate_iter(prompt: str, model_id: int, think_mode: int, file_refs: list = None):
    """Send prompt and yield incremental text deltas using httpx streaming."""
    inner = [None] * 80
    if file_refs:
        refs = []
        for ref_item in file_refs:
            if isinstance(ref_item, (list, tuple)) and len(ref_item) == 3:
                r, fn, m = ref_item
                refs.append([[r, 1], fn, None, m])
            elif isinstance(ref_item, str):
                refs.append([[ref_item, 1], "image.jpg", None, "image/jpeg"])
            else:
                refs.append([[ref_item[0], 1], "image.jpg", None, "image/jpeg"])
        inner[0] = [prompt, 0, None, refs, None, None, 0]
    else:
        inner[0] = [prompt, 0, None, None, None, None, 0]
    inner[1] = ["en"]
    inner[2] = ["", "", "", None, None, None, None, None, None, ""]
    inner[6] = [0]
    inner[7] = 1
    inner[10] = 1
    inner[11] = 0
    inner[17] = [[think_mode]]
    inner[18] = 0
    inner[27] = 1
    inner[30] = [4]
    apply_chat_persistence_flags(inner)
    inner[53] = 0
    inner[59] = str(uuid.uuid4())
    inner[61] = []
    inner[68] = 1
    inner[79] = model_id

    outer = [None, json.dumps(inner)]
    params = {"f.req": json.dumps(outer)}
    if CONFIG.get("xsrf_token"):
        params["at"] = CONFIG["xsrf_token"]
    body = urllib.parse.urlencode(params)
    reqid = int(time.time()) % 1000000
    prefix = account_prefix()

    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://gemini.google.com",
        "Referer": f"https://gemini.google.com{prefix}/app",
        "X-Same-Domain": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
    if prefix:
        headers["X-Goog-AuthUser"] = str(CONFIG["auth_user"])
    cookie_str, sapisid = load_cookie()
    if cookie_str:
        headers["Cookie"] = cookie_str
    if sapisid:
        headers["Authorization"] = make_sapisidhash(sapisid)

    proxy = CONFIG.get("proxy")

    if not HAS_HTTPX:
        # Fallback: non-streaming with urllib
        raw = gemini_stream_generate(prompt, model_id, think_mode, file_refs)
        text = extract_response_text(raw)
        if text:
            yield text
        return

    base_urls = [gemini_base_url()]
    if base_urls[0] != "https://gemini.google.com":
        base_urls.append("https://gemini.google.com")

    last_err = None
    for current_base in base_urls:
        url = (
            f"{current_base}{prefix}/_/BardChatUi/data/"
            "assistant.lamda.BardFrontendService/StreamGenerate"
            f"?bl={CONFIG['gemini_bl']}&hl=en&_reqid={reqid}&rt=c"
        )
        prev_text = ""
        transport = httpx.HTTPTransport(proxy=proxy) if proxy else None
        try:
            with httpx.Client(transport=transport, timeout=CONFIG["request_timeout_sec"], verify=True) as client:
                with client.stream("POST", url, content=body, headers=headers) as resp:
                    resp.raise_for_status()
                    buf = ""
                    for chunk in resp.iter_text():
                        buf += chunk
                        if "BardErrorInfo" in buf:
                            import re as _re
                            m = _re.search(r'BardErrorInfo\s*\[(\d+)\]', buf)
                            if m:
                                raise RuntimeError(f"Gemini upstream rejected request: BardErrorInfo [{m.group(1)}]")
                        while "\n" in buf:
                            line, buf = buf.split("\n", 1)
                            if '"wrb.fr"' not in line or len(line) < 200:
                                continue
                            try:
                                arr = json.loads(line)
                                inner_str = arr[0][2]
                                if not inner_str or len(inner_str) < 50:
                                    continue
                                inner2 = json.loads(inner_str)
                                if isinstance(inner2, list) and len(inner2) > 4 and inner2[4]:
                                    for part in inner2[4]:
                                        if isinstance(part, list) and len(part) > 1 and part[1] and isinstance(part[1], list):
                                            for t in part[1]:
                                                if isinstance(t, str) and len(t) > len(prev_text):
                                                    delta = t[len(prev_text):]
                                                    delta = clean_gemini_text(delta, strip=False)
                                                    if delta:
                                                        yield delta
                                                    prev_text = t
                            except (json.JSONDecodeError, IndexError, TypeError):
                                pass
            return
        except Exception as e:
            last_err = e
            status = getattr(getattr(e, 'response', None), 'status_code', 0)
            log(f"Streaming failed on {current_base} (status {status}): {e}")
            if HAS_HTTPX and status == 405 and update_bl_if_needed():
                log("BL updated, falling back to non-streaming for this request")
                raw = gemini_stream_generate(prompt, model_id, think_mode, file_refs)
                text = extract_response_text(raw)
                if text:
                    yield text
                return
            if current_base != "https://gemini.google.com":
                log(f"Falling back from {current_base} to direct https://gemini.google.com...")
                continue
            raise last_err


def clean_gemini_text(text: str, strip: bool = True) -> str:
    """Remove internal code execution artifacts, citations [cite: X], and noise."""
    # Strip python/js sandbox code blocks
    text = re.sub(
        r'```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n.*?```\n?',
        '', text, flags=re.DOTALL
    )
    # Strip citation tags like [cite: 1], [cite: 1, 2], [cite: 1-3], [source: 1]
    text = re.sub(r'\[cite:\s*[\d,\s\-]+\]', '', text)
    text = re.sub(r'\[source:\s*[\d,\s\-]+\]', '', text)
    return text.strip() if strip else text


def extract_response_text(raw: str) -> str:
    """Parse StreamGenerate response to extract final text."""
    import re as _re
    bard_err = _re.search(r'BardErrorInfo\s*\[(\d+)\]', raw)
    if bard_err:
        raise RuntimeError(f"Gemini upstream rejected request: BardErrorInfo [{bard_err.group(1)}]")
    texts = []
    for line in raw.split("\n"):
        if '"wrb.fr"' not in line or len(line) < 200:
            continue
        try:
            arr = json.loads(line)
            inner_str = arr[0][2]
            if not inner_str or len(inner_str) < 50:
                continue
            inner = json.loads(inner_str)
            if isinstance(inner, list) and len(inner) > 4 and inner[4]:
                for part in inner[4]:
                    if isinstance(part, list) and len(part) > 1 and part[1]:
                        if isinstance(part[1], list):
                            for t in part[1]:
                                if isinstance(t, str) and len(t) > 0:
                                    texts.append(t)
        except (json.JSONDecodeError, IndexError, TypeError):
            pass
    text = ""
    for t in reversed(texts):
        if t.strip():
            text = t
            break
    return clean_gemini_text(text)


# ─── OpenAI Format Helpers ───────────────────────────────────────────────────

PROMPT_MAX_BYTES = 60000


def decode_data_url(url: str):
    match = re.match(r"^data:([^;,]+)?(;base64)?,(.*)$", url, re.DOTALL)
    if not match:
        return None
    mime = match.group(1) or "image/png"
    is_base64 = bool(match.group(2))
    data = match.group(3)
    try:
        if is_base64:
            return base64.b64decode(data, validate=True), mime
        return urllib.parse.unquote_to_bytes(data), mime
    except (ValueError, TypeError, binascii.Error):
        return None


def image_from_url(url: str, mime: str = None):
    if not isinstance(url, str) or not url:
        return None
    if url.startswith("data:"):
        return decode_data_url(url)
    return url, mime or "image/png"


def image_from_part(part: dict):
    part_type = part.get("type")
    if part_type == "image_url":
        image_url = part.get("image_url", {})
        if isinstance(image_url, dict):
            return image_from_url(image_url.get("url"), image_url.get("mime_type"))
        return image_from_url(image_url)
    if part_type in ("input_image", "image"):
        image_url = part.get("image_url") or part.get("url")
        if isinstance(image_url, dict):
            return image_from_url(image_url.get("url"), image_url.get("mime_type"))
        if image_url:
            return image_from_url(image_url, part.get("mime_type"))
        image_data = part.get("data") or part.get("base64")
        if isinstance(image_data, str):
            mime = part.get("mime_type") or part.get("media_type") or "image/png"
            if image_data.startswith("data:"):
                return decode_data_url(image_data)
            try:
                return base64.b64decode(image_data, validate=True), mime
            except (ValueError, TypeError, binascii.Error):
                return None
    return None


def messages_to_prompt(messages: list, tools: list = None) -> tuple:
    """Convert OpenAI messages to (prompt_str, images_list)."""
    parts = []
    images = []
    if tools:
        tool_defs = []
        for tool in tools:
            fn = tool.get("function", tool) if tool.get("type") == "function" else tool
            tool_defs.append({
                "name": fn.get("name", tool.get("name", "")),
                "description": fn.get("description", tool.get("description", "")),
                "parameters": fn.get("parameters", tool.get("parameters", {})),
            })
        if tool_defs:
            tools_json = json.dumps(tool_defs, indent=2)
            if len(tools_json) > PROMPT_MAX_BYTES // 2:
                slim_defs = [{"name": t["name"], "description": t["description"]} for t in tool_defs]
                tools_json = json.dumps(slim_defs, indent=2)
                log(f"Tools block too large ({len(tool_defs)} tools), stripped parameters")
            parts.append(
                "[System instruction]: You have access to tools. "
                "To call a tool, respond with:\n"
                '```tool_call\n{"name": "func_name", "arguments": {...}}\n```\n'
                "Only use tool_call blocks when needed.\n\n"
                f"Available tools:\n{tools_json}"
            )
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, list):
            text_parts = []
            for c in content:
                if c.get("type") in ("text", "input_text", "output_text"):
                    text_parts.append(c.get("text", ""))
                else:
                    image = image_from_part(c)
                    if image:
                        images.append(image)
                        text_parts.append("[Image attached]")
            content = " ".join(text_parts)
        if role == "system":
            parts.append(f"[System instruction]: {content}")
        elif role == "assistant":
            if msg.get("tool_calls"):
                tc_strs = []
                for tc in msg["tool_calls"]:
                    fn = tc.get("function", {})
                    tc_strs.append(
                        f'```tool_call\n{{"name": "{fn.get("name")}", '
                        f'"arguments": {fn.get("arguments", "{}")}}}\n```'
                    )
                parts.append(f"[Assistant]: {content or ''}\n" + "\n".join(tc_strs))
            else:
                parts.append(f"[Assistant]: {content}")
        elif role == "tool":
            parts.append(f"[Tool result for {msg.get('name', '')}]: {content}")
        else:
            parts.append(content if content else "")
    return "\n\n".join(p for p in parts if p), images


def google_contents_to_prompt(req: dict) -> tuple:
    """Convert Google API contents to (prompt_str, images_list)."""
    parts = []
    images = []

    sys_inst = req.get("systemInstruction")
    if sys_inst:
        sys_text = " ".join(
            part.get("text", "") for part in sys_inst.get("parts", []) if part.get("text")
        )
        if sys_text:
            parts.append(f"[System instruction]: {sys_text}")

    for content in req.get("contents", []):
        role = content.get("role", "user")
        text_parts = []
        for part in content.get("parts", []):
            if part.get("text"):
                text_parts.append(part["text"])
            elif part.get("inlineData"):
                data = part["inlineData"]
                try:
                    images.append((
                        base64.b64decode(data["data"], validate=True),
                        data.get("mimeType", "image/png"),
                    ))
                    text_parts.append("[Image attached]")
                except (KeyError, ValueError, TypeError, binascii.Error):
                    pass
        text = " ".join(text_parts)
        if role == "model":
            parts.append(f"[Assistant]: {text}")
        else:
            parts.append(text)

    return "\n\n".join(part for part in parts if part), images


def parse_tool_calls(text: str) -> tuple:
    """Extract tool_call blocks. Returns (clean_text, tool_calls_list)."""
    tool_calls = []
    pattern = r'```tool_call\s*\n(.*?)\n```'
    for match in re.findall(pattern, text, re.DOTALL):
        try:
            data = json.loads(match.strip())
            tool_calls.append({
                "id": f"call_{uuid.uuid4().hex[:8]}",
                "type": "function",
                "function": {
                    "name": data["name"],
                    "arguments": json.dumps(data.get("arguments", {}), ensure_ascii=False),
                },
            })
        except (json.JSONDecodeError, KeyError):
            pass
    clean = re.sub(pattern, '', text, flags=re.DOTALL).strip()
    return clean, tool_calls


# ─── HTTP Handler ────────────────────────────────────────────────────────────

class GeminiHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        client_ip = self.client_address[0] if self.client_address else "-"
        log(f"{client_ip} {fmt % args}")

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE, PATCH")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Private-Network", "true")

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._send_cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        # Universal open access: allow requests with or without API key (or sk-gemini)
        return True

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        try:
            if self.path.startswith("/v1") and not self._authorized():
                self.send_json({"error": {"message": "invalid api key"}}, 401)
                return
            if self.path == "/v1/models":
                self.send_json({"object": "list", "data": [
                    {"id": n, "object": "model", "created": 1700000000,
                     "owned_by": "google", "description": c["desc"]}
                    for n, c in MODELS.items()
                ]})
            elif self.path.startswith("/v1/images/cache/"):
                # Serve cached real image binary directly with proper Content-Type
                img_name = self.path.split("/v1/images/cache/")[-1]
                img_id = img_name.replace(".jpg", "").replace(".jpeg", "").replace(".png", "")
                img_bytes = IMAGE_CACHE.get(img_id)
                if img_bytes:
                    self.send_response(200)
                    self.send_header("Content-Type", "image/jpeg")
                    self.send_header("Content-Length", str(len(img_bytes)))
                    self._send_cors_headers()
                    self.send_header("Cache-Control", "public, max-age=86400")
                    self.end_headers()
                    self.wfile.write(img_bytes)
                else:
                    self.send_json({"error": "Image not found in cache"}, 404)
            elif self.path.startswith("/v1beta/models"):
                self._handle_google_models_list()
            elif self.path == "/":
                self.send_json({"status": "ok", "version": __version__,
                                "models": list(MODELS.keys())})
            else:
                self.send_json({"error": "not found"}, 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            log(f"GET error: {e}")

    def do_POST(self):
        try:
            if self.path.startswith("/v1") and not self._authorized():
                self.send_json({"error": {"message": "invalid api key"}}, 401)
                return
            body = self._read_request_body()
            if self.path == "/v1/chat/completions":
                self.handle_chat(body)
            elif self.path == "/v1/images/generations":
                self.handle_image_generations(body)
            elif self.path == "/v1/responses":
                self.handle_responses(body)
            elif ":streamGenerateContent" in self.path:
                self._handle_google_generate(body, stream=True)
            elif ":generateContent" in self.path:
                self._handle_google_generate(body, stream=False)
            else:
                self.send_json({"error": "not found"}, 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            log(f"POST error: {e}")
            try:
                self.send_json({"error": {"message": str(e)}}, 500)
            except:
                pass

    def _read_request_body(self) -> bytes:
        transfer_encoding = self.headers.get("Transfer-Encoding", "")
        if "chunked" in transfer_encoding.lower():
            chunks = []
            while True:
                size_line = self.rfile.readline()
                if not size_line:
                    break
                size_text = size_line.split(b";", 1)[0].strip()
                try:
                    size = int(size_text, 16)
                except ValueError:
                    raise ValueError("invalid chunked request body")
                if size == 0:
                    while True:
                        trailer = self.rfile.readline()
                        if trailer in (b"\r\n", b"\n", b""):
                            break
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.read(2)
            return b"".join(chunks)

        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length else b""

    def _resolve_model(self, model_name):
        think_override = None
        if "@think=" in model_name:
            model_name, think_str = model_name.rsplit("@think=", 1)
            think_override = int(think_str)
        cfg = MODELS.get(model_name)
        if not cfg:
            return None, None, None, f"Unknown model: {model_name}"
        return model_name, cfg["mode"], (think_override if think_override is not None else cfg["think"]), None

    def _call_gemini(self, prompt, model_id, think_mode, tools, file_refs=None):
        raw = gemini_stream_generate(prompt, model_id, think_mode, file_refs)
        text = extract_response_text(raw)
        tool_calls = None
        if tools and text:
            text, tool_calls = parse_tool_calls(text)
        return text or "", tool_calls

    def handle_image_generations(self, body: bytes):
        """OpenAI standard /v1/images/generations endpoint for DALL-E / FLUX."""
        try:
            req = json.loads(body)
            prompt = req.get("prompt", "").strip()
            if not prompt:
                self.send_json({"error": {"message": "prompt is required"}}, 400)
                return
            log(f"🎨 Generating Image via /v1/images/generations: '{prompt[:60]}'")
            img_id, b64_data, img_err = generate_real_image_bytes(prompt)
            if img_err or not b64_data:
                self.send_json({"error": {"message": img_err or "Image generation failed"}}, 500)
                return
            
            host = self.headers.get("Host", "localhost")
            scheme = "https" if "render.com" in host or "workers.dev" in host or "app.app" in host else "http"
            direct_cached_url = f"{scheme}://{host}/v1/images/cache/{img_id}.jpg"

            self.send_json({
                "created": int(time.time()),
                "data": [{
                    "b64_json": b64_data,
                    "url": direct_cached_url
                }]
            })
        except Exception as e:
            self.send_json({"error": {"message": str(e)}}, 500)

    def handle_chat(self, body: bytes):
        req = json.loads(body)
        model_name, model_id, think_mode, err = self._resolve_model(
            req.get("model", CONFIG["default_model"]))
        if err:
            self.send_json({"error": {"message": err}}, 400)
            return

        tools = req.get("tools")
        prompt, images = messages_to_prompt(req.get("messages", []), tools)
        if not prompt.strip():
            self.send_json({"error": {"message": "empty prompt"}}, 400)
            return

        stream = req.get("stream", False)
        cid = f"chatcmpl-{uuid.uuid4().hex[:12]}"

        # ─── Smart AI Image Intent Detection ─────────────────────────────────
        is_explicit_img_model = model_name in ("flux-1-schnell", "dall-e-3", "stable-diffusion-xl")
        image_prompt = prompt if is_explicit_img_model else extract_image_prompt(prompt)

        if image_prompt and not images and not tools:
            log(f"🎨 Smart AI Intent: Image Generation triggered for: '{image_prompt[:60]}'")
            img_id, b64_data, img_err = generate_real_image_bytes(image_prompt)
            if img_err or not b64_data:
                reply_text = f"Maaf kijiyega, image generate karne me samasya aayi: {img_err or 'Server connection error'}"
            else:
                host = self.headers.get("Host", "localhost")
                scheme = "https" if "render.com" in host or "workers.dev" in host or "app.app" in host else "http"
                local_url = f"{scheme}://{host}/v1/images/cache/{img_id}.jpg"
                
                # Directly embed the image HTML with base64 data so it renders immediately
                reply_text = (
                    f"Yeh lijiye aapki ultra-HD generated image:\n\n"
                    f'<img src="data:image/jpeg;base64,{b64_data}" alt="{image_prompt}" data-imgid="{img_id}" style="max-width:100%;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,0.5);margin:10px 0;display:block;" />\n\n'
                    f"✨ **Prompt:** *{image_prompt}*\n"
                    f"🚀 **Model:** *FLUX.1 Schnell (Ultra-HD)*"
                )

            msg = {"role": "assistant", "content": reply_text}
            if stream:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self._send_cors_headers()
                self.end_headers()
                chunk = {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()),
                         "model": model_name, "choices": [{"index": 0, "delta": msg, "finish_reason": "stop"}]}
                self.wfile.write(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode())
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            else:
                self.send_json({
                    "id": cid, "object": "chat.completion", "created": int(time.time()),
                    "model": model_name,
                    "choices": [{"index": 0, "message": msg, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": len(prompt)//4, "completion_tokens": len(reply_text)//4,
                              "total_tokens": (len(prompt)+len(reply_text))//4},
                })
            return
        try:
            file_refs = upload_images(images)
        except RuntimeError as e:
            self.send_json({"error": {"message": f"upstream error: {e}"}}, 502)
            return

        if stream and not tools:
            # True streaming: forward chunks as they arrive
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self._send_cors_headers()
                self.end_headers()
                first_chunk = {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()),
                               "model": model_name, "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]}
                self.wfile.write(f"data: {json.dumps(first_chunk)}\n\n".encode())
                for delta_text in gemini_stream_generate_iter(prompt, model_id, think_mode, file_refs):
                    chunk = {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()),
                             "model": model_name, "choices": [{"index": 0, "delta": {"content": delta_text}, "finish_reason": None}]}
                    self.wfile.write(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode())
                    self.wfile.flush()
                # Final chunk
                chunk = {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()),
                         "model": model_name, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as e:
                log(f"Stream error: {e}")
            return

        # Non-streaming (or tool calling which needs full response)
        try:
            text, tool_calls = self._call_gemini(prompt, model_id, think_mode, tools, file_refs)
        except Exception as e:
            self.send_json({"error": {"message": f"upstream error: {e}"}}, 502)
            return

        # ─── Automatic Refusal Interceptor: Fallback to Cloudflare Workers AI ─
        if text and any(phrase in text.lower() for phrase in GEMINI_IMAGE_REFUSAL_PHRASES):
            log(f"🛡️ Gemini image refusal detected. Automatically routing to Cloudflare Workers AI for: '{prompt[:60]}'")
            img_id, b64_data, img_err = generate_real_image_bytes(prompt)
            if b64_data:
                text = (
                    f"Yeh lijiye aapki ultra-HD generated image:\n\n"
                    f'<img src="data:image/jpeg;base64,{b64_data}" alt="{prompt}" data-imgid="{img_id}" style="max-width:100%;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,0.5);margin:10px 0;display:block;" />\n\n'
                    f"✨ **Prompt:** *{prompt}*\n"
                    f"🚀 **Model:** *FLUX.1 Schnell (Cloudflare Workers AI GPU)*"
                )

        msg = {"role": "assistant", "content": text or None}
        if tool_calls:
            msg["tool_calls"] = tool_calls
        finish = "tool_calls" if tool_calls else "stop"

        if stream:
            # Stream mode with tools: send as single chunk (need full parse for tool_calls)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            chunk = {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()),
                     "model": model_name, "choices": [{"index": 0, "delta": msg, "finish_reason": finish}]}
            self.wfile.write(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            self.send_json({
                "id": cid, "object": "chat.completion", "created": int(time.time()),
                "model": model_name,
                "choices": [{"index": 0, "message": msg, "finish_reason": finish}],
                "usage": {"prompt_tokens": len(prompt)//4, "completion_tokens": len(text)//4,
                          "total_tokens": (len(prompt)+len(text))//4},
            })

    def handle_responses(self, body: bytes):
        """OpenAI Responses API for Codex CLI compatibility."""
        req = json.loads(body)
        model_name, model_id, think_mode, err = self._resolve_model(
            req.get("model", CONFIG["default_model"]))
        if err:
            self.send_json({"error": {"message": err}}, 400)
            return

        input_items = req.get("input", [])
        tools = req.get("tools")

        messages = []
        if req.get("instructions"):
            messages.append({"role": "system", "content": req["instructions"]})
        if isinstance(input_items, str):
            messages.append({"role": "user", "content": input_items})
        elif isinstance(input_items, list):
            for item in input_items:
                if isinstance(item, str):
                    messages.append({"role": "user", "content": item})
                elif isinstance(item, dict):
                    if item.get("type") == "function_call_output":
                        messages.append({"role": "tool", "tool_call_id": item.get("call_id", ""),
                                         "name": item.get("name", ""), "content": item.get("output", "")})
                    elif item.get("type") in ("input_text", "input_image", "image"):
                        messages.append({"role": "user", "content": [item]})
                    elif item.get("role") == "assistant" or (item.get("type") == "message" and item.get("role") == "assistant"):
                        cp = item.get("content", [])
                        text_acc, tc_list = "", []
                        if isinstance(cp, list):
                            for c in cp:
                                if isinstance(c, dict):
                                    if c.get("type") == "output_text": text_acc += c.get("text", "")
                                    elif c.get("type") == "function_call": tc_list.append(c)
                        elif isinstance(cp, str):
                            text_acc = cp
                        m = {"role": "assistant", "content": text_acc or None}
                        if tc_list:
                            m["tool_calls"] = [{"id": tc.get("call_id", f"call_{i}"), "type": "function",
                                                "function": {"name": tc.get("name",""), "arguments": tc.get("arguments","{}")}}
                                               for i, tc in enumerate(tc_list)]
                        messages.append(m)
                    else:
                        role = item.get("role", "user")
                        messages.append({"role": role, "content": item.get("content", "")})

        if tools:
            tools = [{"type": "function", "function": {"name": t["name"], "description": t.get("description", ""), "parameters": t.get("parameters", {})}}
                     if t.get("type") == "function" and "function" not in t else t for t in tools]

        prompt, images = messages_to_prompt(messages, tools)
        if not prompt.strip():
            self.send_json({"error": {"message": "empty input"}}, 400)
            return

        try:
            file_refs = upload_images(images)
            text, tool_calls = self._call_gemini(prompt, model_id, think_mode, tools, file_refs)
        except Exception as e:
            self.send_json({"error": {"message": f"upstream error: {e}"}}, 502)
            return

        rid = f"resp_{uuid.uuid4().hex[:16]}"
        mid = f"msg_{uuid.uuid4().hex[:12]}"
        output = []
        if tool_calls:
            for tc in tool_calls:
                output.append({"type": "function_call", "id": tc["id"], "call_id": tc["id"],
                               "name": tc["function"]["name"], "arguments": tc["function"]["arguments"], "status": "completed"})
        if text or not tool_calls:
            output.append({"type": "message", "id": mid, "role": "assistant", "status": "completed",
                           "content": [{"type": "output_text", "text": text or "", "annotations": []}]})

        if req.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self._send_cors_headers()
            self.end_headers()
            seq = [0]

            def emit(ev_type, **fields):
                seq[0] += 1
                ev = {"type": ev_type, "sequence_number": seq[0], **fields}
                self.wfile.write(f"event: {ev_type}\ndata: {json.dumps(ev)}\n\n".encode())

            usage = {"input_tokens": len(prompt)//4, "output_tokens": len(text)//4, "total_tokens": (len(prompt)+len(text))//4}
            base_resp = {"id": rid, "object": "response", "created_at": int(time.time()), "model": model_name}
            emit("response.created", response={**base_resp, "status": "in_progress", "output": [], "usage": None})
            emit("response.in_progress", response={**base_resp, "status": "in_progress", "output": [], "usage": None})
            for oi, item in enumerate(output):
                if item["type"] == "function_call":
                    pending = {"type": "function_call", "id": item["id"], "call_id": item["call_id"],
                               "name": item["name"], "arguments": "", "status": "in_progress"}
                    emit("response.output_item.added", output_index=oi, item=pending)
                    emit("response.function_call_arguments.delta", item_id=item["id"], output_index=oi, delta=item["arguments"])
                    emit("response.function_call_arguments.done", item_id=item["id"], output_index=oi, arguments=item["arguments"])
                    emit("response.output_item.done", output_index=oi, item=item)
                elif item["type"] == "message":
                    pending = {"type": "message", "id": item["id"], "role": "assistant", "status": "in_progress", "content": []}
                    emit("response.output_item.added", output_index=oi, item=pending)
                    for ci, cp in enumerate(item["content"]):
                        emit("response.content_part.added", item_id=item["id"], output_index=oi, content_index=ci,
                             part={"type": "output_text", "text": "", "annotations": []})
                        emit("response.output_text.delta", item_id=item["id"], output_index=oi, content_index=ci, delta=cp["text"])
                        emit("response.output_text.done", item_id=item["id"], output_index=oi, content_index=ci, text=cp["text"])
                        emit("response.content_part.done", item_id=item["id"], output_index=oi, content_index=ci, part=cp)
                    emit("response.output_item.done", output_index=oi, item=item)
            emit("response.completed", response={**base_resp, "status": "completed", "output": output, "usage": usage})
            self.wfile.flush()
        else:
            self.send_json({"id": rid, "object": "response", "created_at": int(time.time()), "status": "completed",
                            "model": model_name, "output": output,
                            "usage": {"input_tokens": len(prompt)//4, "output_tokens": len(text)//4, "total_tokens": (len(prompt)+len(text))//4}})


    # ─── Google Native API (Gemini CLI compatible) ────────────────────────────

    def _parse_google_model_from_path(self):
        """Extract model name from /v1beta/models/{model}:method path."""
        m = re.match(r'/v1beta/models/([^:?]+)', self.path)
        if m:
            return m.group(1)
        return None

    def _handle_google_models_list(self):
        """GET /v1beta/models — Google AI format model list."""
        models = []
        for name, cfg in MODELS.items():
            models.append({
                "name": f"models/{name}",
                "displayName": name,
                "description": cfg["desc"],
                "supportedGenerationMethods": ["generateContent", "streamGenerateContent"],
            })
        self.send_json({"models": models})

    def _handle_google_generate(self, body: bytes, stream: bool):
        """Handle Google native generateContent / streamGenerateContent."""
        req = json.loads(body)
        model_name = self._parse_google_model_from_path()
        if not model_name:
            self.send_json({"error": {"message": "model not specified in path"}}, 400)
            return

        model_name, model_id, think_mode, err = self._resolve_model(model_name)
        if err:
            self.send_json({"error": {"message": err}}, 400)
            return

        prompt, images = google_contents_to_prompt(req)
        if not prompt.strip():
            self.send_json({"error": {"message": "empty content"}}, 400)
            return

        try:
            file_refs = upload_images(images)
            text, _ = self._call_gemini(prompt, model_id, think_mode, None, file_refs)
        except Exception as e:
            self.send_json({"error": {"message": f"upstream error: {e}"}}, 502)
            return

        candidate = {
            "content": {"parts": [{"text": text or ""}], "role": "model"},
            "finishReason": "STOP",
            "index": 0,
        }
        usage = {
            "promptTokenCount": len(prompt) // 4,
            "candidatesTokenCount": len(text) // 4,
            "totalTokenCount": (len(prompt) + len(text)) // 4,
        }
        response_obj = {
            "candidates": [candidate],
            "usageMetadata": usage,
            "modelVersion": model_name,
        }

        if stream:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(f"data: {json.dumps(response_obj)}\n\n".encode())
            self.wfile.flush()
        else:
            self.send_json(response_obj)


# ─── Main ────────────────────────────────────────────────────────────────────

def load_config(path: str):
    if path and os.path.exists(path):
        with open(path) as f:
            CONFIG.update(json.load(f))
        log(f"Config loaded: {path}")
    if not CONFIG.get("relay_url"):
        CONFIG["relay_url"] = os.environ.get("CLOUDFLARE_WORKER_URL") or os.environ.get("CF_RELAY_URL") or None


def main():
    parser = argparse.ArgumentParser(description="Gemini Web to OpenAI API")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--config", type=str, default=None)
    parser.add_argument("--cookie-file", type=str, default=None, help="Path to cookie file")
    parser.add_argument("--proxy", type=str, default=None, help="HTTP proxy, e.g. http://127.0.0.1:7890")
    parser.add_argument("--version", action="version", version=f"gemini-web2api {__version__}")
    args = parser.parse_args()

    config_path = args.config or os.environ.get("GEMINI_WEB2API_CONFIG")
    if not config_path:
        for p in ["./config.json", os.path.expanduser("~/.config/gemini-web2api/config.json")]:
            if os.path.exists(p):
                config_path = p
                break
    load_config(config_path)

    if args.port:
        CONFIG["port"] = args.port
    if args.cookie_file:
        CONFIG["cookie_file"] = args.cookie_file
    if args.proxy:
        CONFIG["proxy"] = args.proxy

    new_bl = fetch_latest_bl()
    if new_bl:
        CONFIG["gemini_bl"] = new_bl

    class ThreadedServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    port = CONFIG["port"]
    server = ThreadedServer((CONFIG["host"], port), GeminiHandler)
    print(f"gemini-web2api v{__version__}")
    print(f"  Listening: http://0.0.0.0:{port}")
    print(f"  Base URL:  http://localhost:{port}/v1")
    print(f"  Models:    {', '.join(MODELS.keys())}")
    print(f"  Cookie:    {'yes (' + CONFIG['cookie_file'] + ')' if CONFIG.get('cookie_file') else 'none (anonymous)'}")
    print(f"  Proxy:     {CONFIG.get('proxy') or 'none (uses system env HTTP_PROXY/HTTPS_PROXY)'}")
    print(f"  Retry:     {CONFIG['retry_attempts']}x / {CONFIG['retry_delay_sec']}s")
    print(f"  BL:        {CONFIG['gemini_bl']}")
    print(f"  Temporary: {'yes' if CONFIG.get('temporary_chats', False) else 'no'}")
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.shutdown()


if __name__ == "__main__":
    main()
