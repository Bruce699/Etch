"""Browser acceptance test. Starts Etch against a temporary SQLite database."""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from spatial import verify_spatial

ROOT = Path(__file__).resolve().parents[1]


def run():
    with tempfile.TemporaryDirectory() as temporary:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        url = f"http://127.0.0.1:{port}"
        server = subprocess.Popen(
            [
                sys.executable,
                str(ROOT / "server.py"),
                "--port",
                str(port),
                "--data",
                temporary + "/test.sqlite",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            for _ in range(80):
                try:
                    with urllib.request.urlopen(url + "/api/workspace") as r:
                        json.load(r)
                    break
                except OSError:
                    time.sleep(0.1)
            with sync_playwright() as pw:
                browser = pw.chromium.launch(
                    channel=os.environ.get("ETCH_CHROME", "chrome")
                )
                page = browser.new_page(
                    viewport={"width": 1440, "height": 930}, accept_downloads=True
                )
                page.set_default_timeout(10000)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))

                def action(name):
                    return page.locator('[data-action="' + name + '"]:visible').last

                def workspace():
                    return page.request.get(url + "/api/workspace").json()["state"]

                def saved():
                    page.wait_for_timeout(350)

                def click_note(title):
                    page.locator("#world .item.note-card").filter(
                        has=page.locator(".note-title", has_text=title)
                    ).first.click()

                def field(title):
                    return page.get_by_label(title, exact=True)

                def check(msg):
                    print("PASS", msg, flush=True)

                def capture(name):
                    if os.environ.get("ETCH_EVIDENCE"):
                        folder = Path(os.environ["ETCH_EVIDENCE"])
                        folder.mkdir(parents=True, exist_ok=True)
                        page.wait_for_timeout(300)
                        page.screenshot(
                            path=str(folder / (name + ".png")), animations="disabled"
                        )

                page.goto(url)
                expect(page.locator(".recent-card")).to_have_count(5)
                page.evaluate("document.fonts.ready")
                capture("inbox")
                field("New note title").fill("A portable identity")
                field("New note body").fill(
                    "Remembering personal preferences should make it easier to move between tools."
                )
                field("New note body").press("Control+Enter")
                saved()
                page.reload()
                expect(page.locator(".home")).to_contain_text("A portable identity")
                check("capture and reload")
                page.locator("#global-search").fill("portable identity")
                action("edit-found").click()
                field("Note").fill(
                    "A persistent identity can carry preferences between tools."
                )
                page.get_by_role("button", name="Save note", exact=True).click()
                saved()
                page.locator('.tree-name[data-id="identity"]').click()
                expect(page.locator(".canvas")).to_be_visible()
                action("inbox").click()
                field("Search notes").fill("portable identity")
                expect(page.locator("[data-drawer-note]")).to_have_count(1)
                page.locator("[data-drawer-note]").first.drag_to(
                    page.locator("#world > .group .group-column").first
                )
                expect(page.locator("#world > .group")).to_contain_text(
                    "A portable identity"
                )
                action("panel-close").click()
                check("search and drag from inbox into section")
                click_note("Defaults in technology")
                action("threads").click()
                expect(page.locator(".popover")).to_contain_text("real world example")
                page.locator('[data-action="insert-thread"][data-id="agents"]').click()
                expect(page.locator("#world > .group")).to_contain_text(
                    "Agentic AI and dev ecosystems"
                )
                check("external thread insertion")
                click_note("Defaults in technology")
                action("appearances").click()
                expect(page.locator(".popover")).to_contain_text("Thoughts on AI")
                page.keyboard.press("Escape")
                click_note("Defaults in technology")
                action("color").click()
                page.locator("[data-color=peach]").click()
                capture("canvas")
                alpha = (
                    page.locator("#world .item.note-card")
                    .filter(has_text="A portable identity")
                    .first
                )
                alpha.click()
                action("connector").click()
                click_note("Defaults in technology")
                page.locator("#edge-label").fill("carries preferences across tools")
                page.get_by_role("button", name="Save connection").click()
                saved()
                assert any(
                    e["label"] == "carries preferences across tools"
                    for e in workspace()["edges"]
                )
                check("appearances, note color and labeled connector")
                page.locator("#world > .group > .section-name").first.click()
                action("layout").click()
                action("stack").click()
                expect(
                    page.locator("#world > .group > .columns > .group-column")
                ).to_have_count(1)
                action("fit").click()
                action("duplicate").click()
                saved()
                assert (
                    len(
                        [
                            i
                            for b in workspace()["boards"]
                            if b["id"] == "identity"
                            for i in b["items"]
                            if i["kind"] == "section"
                        ]
                    )
                    == 2
                )
                check("vertical arrangement and independent duplicate section")
                action("prompt").click()
                capture("prompt")
                field("Describe your writing needs").fill(
                    "Outline a personal essay about identity as a portable layer, using the notes in order."
                )
                page.locator(".write-prompt button[type=submit]").click()
                expect(page.locator("#world > [data-kind=doc]")).to_have_count(
                    2, timeout=180000
                )
                saved()
                d = workspace()["documents"][0]
                assert all(s["sources"] for s in d["sections"])
                assert any(
                    e["label"] == "carries preferences across tools" for e in d["edges"]
                )
                check(
                    "generated document ("
                    + d["engine"]
                    + ") with note and connector provenance"
                )
                page.locator("#world > [data-kind=doc] .doc-head").filter(
                    has_text=d["title"]
                ).last.dblclick()
                expect(page.locator(".editor")).to_be_visible()
                expect(page.locator("[data-doc-field=title]")).to_have_text(d["title"])
                action("reference").first.click()
                expect(page.locator("#world .source-focus").first).to_be_visible()
                capture("source-reference")
                page.locator("[data-doc-field=title]").fill("A portable layer")
                page.wait_for_function(
                    "async id => (await (await fetch('/api/workspace')).json()).state.documents.some(d => d.id === id && d.title === 'A portable layer')",
                    arg=d["id"],
                )
                action("expand").click()
                expect(page.locator(".editor.expanded")).to_be_visible()
                capture("full-editor")
                action("branch").click()
                field("Describe your writing needs").fill(
                    "Reframe this essay as questions about user agency."
                )
                page.get_by_role("button", name="Create branch").click()
                expect(page.locator("#world > [data-kind=doc]")).to_have_count(
                    3, timeout=180000
                )
                saved()
                page.wait_for_function(
                    "async id => (await (await fetch('/api/workspace')).json()).state.documents.some(d => d.parent === id)",
                    arg=d["id"],
                )
                check("source reveal, editing and preserved branch parent")
                page.reload()
                action("documents").click()
                expect(page.locator(".library-list")).to_contain_text(
                    "A portable layer"
                )
                page.locator(
                    f'[data-action=doc-from-list][data-id="{d["id"]}"]'
                ).click()
                action("doc-menu").click()
                with page.expect_download():
                    action("export-doc").click()
                check("persisted documents and Markdown download")
                verify_spatial(page, url, workspace)
                page.goto(url)
                page.locator('.recent-card[data-id="ai"]').click()
                action("new-note").click()
                page.get_by_role("button", name="Save note").click()
                expect(page.get_by_role("dialog")).to_be_visible()
                action("dismiss").click()
                page.goto(url)
                action("new-board").click()
                page.get_by_placeholder("Canvas name").fill("Empty canvas")
                page.get_by_role("button", name="Save", exact=True).click()
                expect(page.locator("#world > .placed")).to_have_count(0)
                check("empty canvas and invalid blank note")
                page.set_viewport_size({"width": 390, "height": 844})
                page.goto(url)
                expect(page.locator(".composer")).to_be_visible()
                assert page.evaluate(
                    "document.documentElement.scrollWidth <= innerWidth"
                )
                capture("compact-inbox")
                page.locator(".recent-card").first.click()
                expect(page.locator(".toolbar")).to_be_visible()
                assert not errors, errors
                check("narrow viewport and browser error check")
                browser.close()
        finally:
            server.terminate()
            server.wait()


if __name__ == "__main__":
    run()
