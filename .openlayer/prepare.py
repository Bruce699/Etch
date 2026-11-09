"""Preserve the existing workspace in a directory excluded from preview watching."""

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / "data" / "workspace.sqlite"
destination = ROOT / ".cache" / "etch" / "workspace.sqlite"

destination.parent.mkdir(parents=True, exist_ok=True)
if source.exists() and not destination.exists():
    # SQLite's backup API includes committed WAL contents, unlike a file copy.
    temporary = destination.with_suffix(".tmp")
    try:
        with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as original:
            with sqlite3.connect(temporary) as copied:
                original.backup(copied)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
