"""Launch the local application, and its installed model if available."""

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / ".runtime"
VERSION = "b12211"
MODEL_URL = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true"
BINARY_URL = f"https://github.com/ggml-org/llama.cpp/releases/download/{VERSION}/llama-{VERSION}-bin-macos-arm64.tar.gz"
MODEL_DIGEST = "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"
BINARY_DIGEST = "4da4edb437358d31d55938ad849d262ca31b0e0ffb35e9caedb727a0cd5a8f0f"


def download(url, path, digest):
    temp = path.with_suffix(".part")
    subprocess.run(["curl", "-fL", "--retry", "2", url, "-o", str(temp)], check=True)
    checksum = hashlib.sha256()
    with temp.open("rb") as incoming:
        for chunk in iter(lambda: incoming.read(1024 * 1024), b""):
            checksum.update(chunk)
    if checksum.hexdigest() != digest:
        temp.unlink()
        raise ValueError(f"Checksum mismatch for {path.name}. Please retry.")
    temp.replace(path)


def fetch(path):
    try:
        with urllib.request.urlopen(path, timeout=1) as response:
            return json.load(response)
    except (OSError, ValueError):
        return {}


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument(
        "--install-model",
        action="store_true",
        help="Download the pinned Apple Silicon model and runtime",
    )
    args.add_argument("--no-browser", action="store_true")
    args.add_argument("--port", type=int, default=8741)
    opts = args.parse_args()
    binary = RUNTIME / ("llama-" + VERSION) / "llama-server"
    model = RUNTIME / "qwen.gguf"
    if opts.install_model:
        if platform.system() != "Darwin" or platform.machine() != "arm64":
            args.error(
                "The bundled installer targets Apple Silicon. Set ETCH_MODEL_URL to a local llama.cpp endpoint on other platforms."
            )
        RUNTIME.mkdir(exist_ok=True)
        if not binary.exists():
            archive = RUNTIME / "llama.tar.gz"
            download(BINARY_URL, archive, BINARY_DIGEST)
            subprocess.run(["tar", "-xzf", archive, "-C", RUNTIME], check=True)
            archive.unlink()
        if not model.exists():
            download(MODEL_URL, model, MODEL_DIGEST)
    app_url = f"http://127.0.0.1:{opts.port}"
    existing = fetch(app_url + "/api/workspace")
    if existing.get("state", {}).get("schema") == 1:
        print("Etch is already running at", app_url)
        if not opts.no_browser:
            webbrowser.open(app_url)
        return
    env = dict(os.environ)
    model_url = env.get("ETCH_MODEL_URL", "http://127.0.0.1:18267")
    workers = []
    try:
        if binary.is_file() and model.is_file() and "ETCH_MODEL_URL" not in env:
            if not fetch(model_url + "/v1/models"):
                log = (RUNTIME / "model.log").open("a")
                workers.append(
                    subprocess.Popen(
                        [
                            binary,
                            "-m",
                            model,
                            "--host",
                            "127.0.0.1",
                            "--port",
                            "18267",
                            "-c",
                            "8192",
                            "--parallel",
                            "1",
                            "--no-ui",
                        ],
                        stdout=log,
                        stderr=log,
                    )
                )
                for _ in range(60):
                    if (
                        fetch(model_url + "/v1/models")
                        or workers[-1].poll() is not None
                    ):
                        break
                    time.sleep(0.4)
            env.setdefault("ETCH_MODEL_NAME", "Qwen2.5 · on device")
        workers.append(
            subprocess.Popen(
                [sys.executable, str(ROOT / "server.py"), "--port", str(opts.port)],
                env=env,
            )
        )
        for _ in range(60):
            if fetch(app_url + "/api/workspace"):
                break
            if workers[-1].poll() is not None:
                raise RuntimeError("Could not start Etch on the selected port.")
            time.sleep(0.15)
        if not opts.no_browser:
            webbrowser.open(app_url)
        print("Press Control-C to stop Etch.", flush=True)
        workers[-1].wait()
    except KeyboardInterrupt:
        pass
    finally:
        for proc in reversed(workers):
            proc.terminate()
            proc.wait()


if __name__ == "__main__":
    main()
