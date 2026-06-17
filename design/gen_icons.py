import json, sys, time, urllib.request, urllib.parse, os, random

HOST = "https://comfy.wtfdie.com"
OUT = os.path.join(os.path.dirname(__file__), "icon-candidates")
os.makedirs(OUT, exist_ok=True)

PROMPTS = {
    "01-hall-cursor": "App icon, minimalist flat vector emblem. A glowing phosphor-green terminal command prompt cursor '>_' set inside the golden triangular gable of a Norse Valhalla longhall. Dark slate background, crisp geometric shapes, subtle glow, centered, icon design, high contrast.",
    "02-helmet-screen": "App icon design, a Viking horned helmet fused with a computer terminal screen, the visor is a black terminal showing a blinking green cursor, gold and emerald palette, flat modern emblem, dark background, centered, clean vector.",
    "03-rune-shield": "App icon, a Norse rune stylized as a terminal prompt arrow, carved into glowing green light on a dark obsidian round shield with gold rivets, minimalist emblem, centered, crisp, high contrast.",
    "04-hall-doorway": "App icon, isometric tiny golden Valhalla longhall whose doorway is a glowing green terminal window with code text, crossed Viking axes above, dark background, polished 3D game-icon style, centered.",
    "05-raven-prompt": "App icon, a black raven perched on a glowing green command-line prompt symbol, Norse mythology meets hacker terminal, emerald and gold on dark charcoal, flat illustrative emblem, centered, clean.",
    "06-mjolnir-cursor": "App icon, Mjolnir the Norse hammer crossed with a blinking terminal cursor forming a coat-of-arms shield emblem, glowing green runes, gold and brushed steel, dark background, bold minimalist vector.",
}

def workflow(text, seed):
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "flux1-dev-fp8.safetensors"}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["4", 1], "text": text}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["4", 1], "text": ""}},
        "10": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["6", 0], "guidance": 3.5}},
        "5": {"class_type": "EmptySD3LatentImage", "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
        "3": {"class_type": "KSampler", "inputs": {"seed": seed, "steps": 22, "cfg": 1.0,
              "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0,
              "model": ["4", 0], "positive": ["10", 0], "negative": ["7", 0], "latent_image": ["5", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "termhalla"}},
    }

def post(path, obj):
    data = json.dumps(obj).encode()
    req = urllib.request.Request(HOST + path, data=data, headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))

def get(path):
    return json.load(urllib.request.urlopen(HOST + path, timeout=60))

def run(name, text):
    seed = random.randint(1, 2**31)
    r = post("/prompt", {"prompt": workflow(text, seed)})
    pid = r["prompt_id"]
    print(f"[{name}] queued {pid} seed={seed}", flush=True)
    for _ in range(120):  # up to ~240s
        time.sleep(2)
        h = get(f"/history/{pid}")
        if pid in h:
            entry = h[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                print(f"[{name}] ERROR: {json.dumps(status.get('messages', []))[:800]}", flush=True)
                return None
            outs = entry.get("outputs", {})
            imgs = outs.get("9", {}).get("images", [])
            if imgs:
                im = imgs[0]
                q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im.get("subfolder", ""), "type": im.get("type", "output")})
                blob = urllib.request.urlopen(HOST + "/view?" + q, timeout=60).read()
                dest = os.path.join(OUT, name + ".png")
                with open(dest, "wb") as f:
                    f.write(blob)
                print(f"[{name}] saved {dest} ({len(blob)//1024} KB)", flush=True)
                return dest
    print(f"[{name}] timed out", flush=True)
    return None

if __name__ == "__main__":
    targets = sys.argv[1:] or list(PROMPTS)
    for n in targets:
        run(n, PROMPTS[n])
