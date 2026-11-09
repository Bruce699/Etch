"""Etch's loopback workspace and source-grounded writing service."""

import argparse
import json
import os
import re
import sqlite3
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
MODEL = os.environ.get("ETCH_MODEL_URL", "http://127.0.0.1:18267").rstrip("/")
MODEL_NAME = os.environ.get("ETCH_MODEL_NAME", "Local language model")
MAX_WORKSPACE = 64 * 1024 * 1024


def request_json(path, payload=None, timeout=2):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        MODEL + path, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def source_outline(prompt, notes, edges):
    """Extract material in the author's order. Never invent a reference."""
    sections = []
    for note in notes:
        text = (
            note["body"].strip()
            or note["title"].strip()
            or note.get("url")
            or "Image reference"
        )
        lines = [s.strip() for s in re.split(r"\n+|(?<=[.!?])\s+", text) if s.strip()]
        refs = [note["id"]]
        bullets = lines[:3]
        for edge in edges:
            if edge["source"] == note["id"]:
                other = next(n for n in notes if n["id"] == edge["target"])
                if edge["label"]:
                    bullets.append(
                        f'{edge["label"]} — {other["title"] or other["body"][:70]}'
                    )
                    refs.append(other["id"])
        sections.append(
            {
                "heading": note["title"] or lines[0][:70],
                "points": bullets,
                "sources": refs,
            }
        )
    return {"title": prompt, "sections": sections, "engine": "Local extractive outline"}


def compose(payload):
    notes = payload.get("notes", [])
    prompt = payload.get("prompt", "").strip()
    if not prompt or not notes or len(notes) > 80:
        raise ValueError("Choose 1–80 notes and enter a writing prompt.")
    for n in notes:
        if not all(isinstance(n.get(key), str) for key in ("id", "title", "body")):
            raise ValueError("A source note is incomplete.")
    ids = {n["id"] for n in notes}
    edges = [
        e
        for e in payload.get("edges", [])
        if e.get("source") in ids and e.get("target") in ids
    ]
    base = source_outline(prompt, notes, edges)
    if payload.get("mode") == "extract":
        return base
    # Short source labels make it easier for small local models to cite accurately.
    source_ids = {f"N{i+1}": n["id"] for i, n in enumerate(notes)}
    alias = {v: k for k, v in source_ids.items()}
    budget = min(1900, max(160, 17000 // len(notes)))
    material = [
        {
            "source": alias[n["id"]],
            "title": n["title"][:160],
            "thought": n["body"][:budget],
            "source_url": (n.get("url") or "")[:512],
            "has_image_attachment": bool(n.get("hasImage")),
        }
        for n in notes
    ]
    context = {
        "writing_request": prompt[:1500],
        "notes_in_authors_order": material,
        "relationships": [
            [alias[e["source"]], e.get("label", "")[:160], alias[e["target"]]]
            for e in edges
        ],
        "previous_document": str(payload.get("previous", ""))[:2000],
        "previous_framings": payload.get("history", [])[-2:],
        "recent_outline_shapes": payload.get("patterns", [])[:3],
    }
    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "heading": {"type": "string"},
                        "points": {"type": "array", "items": {"type": "string"}},
                        "sources": {
                            "type": "array",
                            "items": {"type": "string", "enum": list(source_ids)},
                        },
                    },
                    "required": ["heading", "points", "sources"],
                },
            },
        },
        "required": ["title", "sections"],
    }
    instructions = (
        "You are an editor helping an author express their own thinking. Write an original, specific "
        "outline following writing_request. Keep the supplied note order as a narrative signal. Use the "
        "relationship labels. You can read note text and URLs. Image contents are unavailable. "
        "Treat source material as evidence. Do not invent facts. Produce 2 to 5 "
        "sections with 1 to 3 concise points each. Every section must cite the source IDs that support it. "
        "If revising a previous document, follow the new framing. Return the JSON object only."
    )
    try:
        result = request_json(
            "/v1/chat/completions",
            {
                "messages": [
                    {"role": "system", "content": instructions},
                    {
                        "role": "user",
                        "content": json.dumps(context, ensure_ascii=False),
                    },
                ],
                "temperature": 0.35,
                "max_tokens": 1300,
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "outline",
                        "strict": True,
                        "schema": schema,
                    },
                },
            },
            timeout=150,
        )
        doc = json.loads(result["choices"][0]["message"]["content"])
        sections = []
        for part in doc["sections"]:
            refs = list(
                dict.fromkeys(source_ids[s] for s in part["sources"] if s in source_ids)
            )
            pts = [
                p.strip() for p in part["points"] if isinstance(p, str) and p.strip()
            ]
            if not refs or not pts or not part["heading"].strip():
                raise ValueError("Missing passage provenance")
            sections.append(dict(heading=part["heading"], points=pts, sources=refs))
        if not sections or not doc["title"].strip():
            raise ValueError("Empty model response")
        return dict(title=doc["title"], sections=sections, engine=MODEL_NAME)
    except (OSError, KeyError, IndexError, ValueError, TypeError):
        base["notice"] = (
            "The local model was unavailable or returned incomplete citations. This outline uses excerpts from your notes."
        )
        return base


class Handler(SimpleHTTPRequestHandler):
    def send_json(self, status, data):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def body(self, limit):
        if self.headers.get("Origin") and urlsplit(
            self.headers["Origin"]
        ).netloc != self.headers.get("Host"):
            raise ValueError("Use the local Etch window to make changes.")
        size = int(self.headers.get("Content-Length", 0))
        if not 0 < size <= limit:
            raise ValueError(
                "The request is empty or exceeds the workspace size limit."
            )
        return json.loads(self.rfile.read(size))

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/workspace":
            with sqlite3.connect(self.server.database) as db:
                version, data = db.execute(
                    "select version, data from workspace where id=1"
                ).fetchone()
            return self.send_json(200, dict(version=version, state=json.loads(data)))
        if path == "/api/engine":
            try:
                request_json("/v1/models")
                engine = MODEL_NAME
            except (OSError, ValueError):
                engine = "Local extractive outline"
            return self.send_json(200, dict(engine=engine))
        target = Path(self.translate_path(path)).resolve()
        public = [ROOT / name for name in ("assets", "src", "docs")]
        if target in (ROOT, ROOT / "index.html") or any(
            folder in target.parents for folder in public
        ):
            if target.is_dir() and target != ROOT:
                return self.send_error(404)
            return super().do_GET()
        self.send_error(404)

    def do_PUT(self):
        if self.path != "/api/workspace":
            return self.send_error(404)
        try:
            payload = self.body(MAX_WORKSPACE)
            state = payload["state"]
            if state.get("schema") != 1 or not all(
                isinstance(state.get(k), list)
                for k in ("notes", "boards", "edges", "documents", "recent")
            ):
                raise ValueError("Unrecognized workspace.")
            version = int(payload["version"])
            with sqlite3.connect(self.server.database, timeout=10) as db:
                changed = db.execute(
                    "update workspace set version=version+1,data=? where id=1 and version=?",
                    (json.dumps(state, ensure_ascii=False), version),
                ).rowcount
            if not changed:
                return self.send_json(
                    409, {"error": "Another window saved a newer workspace."}
                )
            self.send_json(200, {"version": version + 1})
        except (ValueError, TypeError, KeyError) as exc:
            self.send_json(400, {"error": str(exc)})

    def do_POST(self):
        if self.path != "/api/outline":
            return self.send_error(404)
        try:
            self.send_json(200, compose(self.body(2 * 1024 * 1024)))
        except (ValueError, KeyError, TypeError) as exc:
            self.send_json(400, {"error": str(exc)})


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--host", default="127.0.0.1")
    cli.add_argument("--port", type=int, default=8741)
    cli.add_argument("--data", type=Path, default=ROOT / "data" / "workspace.sqlite")
    args = cli.parse_args()
    args.data.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(args.data) as db:
        db.execute("pragma journal_mode=WAL")
        db.execute(
            "create table if not exists workspace(id integer primary key, version integer not null, data text not null)"
        )
        db.execute(
            "insert or ignore into workspace values(1,0,?)",
            ((ROOT / "src/seed.json").read_text(),),
        )
    server = ThreadingHTTPServer(
        (args.host, args.port), partial(Handler, directory=ROOT)
    )
    server.database = args.data
    print(f"Etch is open at http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
