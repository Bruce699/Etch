"""Additional browser journeys for nesting, spatial editing, and media capture."""

import base64
import time
from playwright.sync_api import expect


def verify_spatial(page, url, workspace):
    def action(name):
        return page.locator('[data-action="' + name + '"]:visible').last

    def app_board(name):
        return next(b for b in workspace()["boards"] if b["name"] == name)

    def wait_save():
        page.wait_for_timeout(420)

    def drag(start, end):
        page.mouse.move(*start)
        page.mouse.down()
        page.mouse.move(*end, steps=15)
        page.mouse.up()

    def center(locator):
        rect = locator.bounding_box()
        return (rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2)

    page.goto(url + "/#canvas/design")
    first = page.locator("#world > .group .note-card").filter(
        has=page.locator(".note-title", has_text="Designing with taste")
    )
    second = page.locator("#world > .group .note-card").filter(
        has=page.locator(".note-title", has_text="Student designers")
    )
    first.click()
    second.click(modifiers=["Shift"])
    expect(page.locator("#world .selected")).to_have_count(2)
    page.locator(".context-bar [data-action=subcanvas]").click()
    page.get_by_placeholder("Canvas name").fill("Story and taste")
    page.get_by_role("button", name="Save", exact=True).click()
    wait_save()
    child = app_board("Story and taste")
    parent = app_board("Entering the design world")
    assert {i["ref"] for i in child["items"]} == {"student", "taste"}
    assert any(i.get("ref") == "student" for i in parent["items"])
    action("open-child").click()
    expect(page.locator(".path")).to_contain_text("Story and taste")
    page.locator("#world > .note-card").first.click()
    page.locator("#world > .note-card").last.click(modifiers=["Shift"])
    action("group").click()
    page.get_by_placeholder("Section name").fill("Argument order")
    page.get_by_role("button", name="Save", exact=True).click()
    action("layout").click()
    action("stack").click()
    action("fit").click()
    wait_save()
    group = page.locator("#world > .group")
    cards = group.locator(".note-card")
    before = [
        i["ref"] for i in app_board("Story and taste")["items"] if i["kind"] == "note"
    ]
    r = cards.first.bounding_box()
    drag(center(cards.last), (r["x"] + r["width"] / 2, r["y"] + 8))
    wait_save()
    after = [
        i["ref"] for i in app_board("Story and taste")["items"] if i["kind"] == "note"
    ]
    assert after == list(reversed(before)), (before, after)
    page.locator(".toolbar [data-action=new-note]").drag_to(cards.first)
    page.get_by_label("Inserted note title").fill("One example")
    page.get_by_label("Inserted note body").fill(
        "A critique session let me practice telling the story of a decision."
    )
    page.get_by_label("Inserted note body").press("Control+Enter")
    wait_save()
    expect(group).to_contain_text("One example")
    new = next(n for n in workspace()["notes"] if n["title"] == "One example")
    page.locator("#world .note-card").filter(has_text="One example").click()
    action("selection-more").click()
    action("choose-move").click()
    page.locator("[data-action=move-to][data-id=design]").click()
    wait_save()
    assert not any(
        i.get("ref") == new["id"] for i in app_board("Story and taste")["items"]
    )
    assert any(
        i.get("ref") == new["id"]
        for i in app_board("Entering the design world")["items"]
    )
    print(
        "PASS multi-selection, subcanvas, grouping, pointer reorder, inline insertion and transfer",
        flush=True,
    )

    page.goto(url)
    page.locator("[data-action=new-board]").click()
    page.get_by_placeholder("Canvas name").fill("Images")
    page.get_by_role("button", name="Save", exact=True).click()
    action("new-note").click()
    with page.expect_file_chooser() as chooser:
        page.get_by_role("button", name="Attach image", exact=True).click()
    image64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    chooser.value.set_files(
        {
            "name": "capture.png",
            "mimeType": "image/png",
            "buffer": base64.b64decode(image64),
        }
    )
    page.locator("#note-title").fill("A visual reference")
    page.locator("#note-url").fill("https://example.org/idea")
    page.get_by_role("button", name="Save note", exact=True).click()
    wait_save()
    page.reload()
    expect(page.locator("#world .note-art")).to_be_visible()
    assert (
        page.locator("#world .source-link").get_attribute("href")
        == "https://example.org/idea"
    )
    print("PASS attached image and source link persist through reload", flush=True)
