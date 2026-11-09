"""Standard-library checks for transactional saves, restart and offline writing."""

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def run():
    with tempfile.TemporaryDirectory() as directory:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        url = f"http://127.0.0.1:{port}"

        def call(path, method="GET", payload=None):
            req = Request(
                url + path,
                data=json.dumps(payload).encode() if payload is not None else None,
                method=method,
                headers={"Content-Type": "application/json"},
            )
            try:
                with urlopen(req, timeout=10) as response:
                    return response.status, json.load(response)
            except HTTPError as error:
                return error.code, json.load(error)

        def start():
            p = subprocess.Popen(
                [
                    sys.executable,
                    str(ROOT / "server.py"),
                    "--data",
                    directory + "/data.sqlite",
                    "--port",
                    str(port),
                ],
                env={**os.environ, "ETCH_MODEL_URL": "http://127.0.0.1:1"},
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            for _ in range(40):
                try:
                    if call("/api/workspace")[0] == 200:
                        return p
                except OSError:
                    time.sleep(0.1)
            raise RuntimeError("Server did not start")

        process = start()
        try:
            _, initial = call("/api/workspace")
            initial["state"]["profile"] = "Local author"
            assert call("/api/workspace", "PUT", initial)[0] == 200
            initial["state"]["profile"] = "Stale edit"
            assert call("/api/workspace", "PUT", initial)[0] == 409
            process.terminate()
            process.wait()
            process = start()
            assert call("/api/workspace")[1]["state"]["profile"] == "Local author"
            assert call("/api/workspace", "PUT", {"version": 1, "state": {}})[0] == 400
            assert (
                call("/api/outline", "POST", {"prompt": "Write", "notes": []})[0] == 400
            )
            notes = [
                dict(
                    id="a",
                    title="Memory",
                    body="A recurring detail gives the essay continuity.",
                ),
                dict(
                    id="b", title="Form", body="An outline makes the sequence visible."
                ),
            ]
            status, out = call(
                "/api/outline",
                "POST",
                dict(
                    prompt="A personal essay",
                    notes=notes,
                    edges=[dict(source="a", target="b", label="supports")],
                ),
            )
            assert (
                status == 200
                and out["engine"] == "Local extractive outline"
                and "notice" in out
            )
            assert out["sections"][0]["sources"] == ["a", "b"]
            status, image_outline = call(
                "/api/outline",
                "POST",
                {
                    "prompt": "Arrange my references",
                    "notes": [
                        dict(id="image", title="", body="", hasImage=True),
                        dict(
                            id="link", title="", body="", url="https://example.org/note"
                        ),
                    ],
                },
            )
            assert (
                status == 200
                and image_outline["sections"][0]["heading"] == "Image reference"
            )
            assert image_outline["sections"][1]["points"] == [
                "https://example.org/note"
            ]
            print("PASS image-only and URL-only source notes in the extractive writer.")
            print(
                "PASS atomic revision check, stale-write rejection, restart persistence, invalid requests and model-offline fallback."
            )
        finally:
            process.terminate()
            process.wait()


if __name__ == "__main__":
    run()
