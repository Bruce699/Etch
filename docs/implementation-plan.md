# Etch reconstruction

The 171 selected objects are all on the Etch page. The 118 presentation frames use a 1920 × 1080 canvas. A further 52 text layers supply narration and one transparent rectangle sits outside the frames. The inventory includes 81 distinct image hashes and 15 distinct video hashes exposed by the layer inspection, including alternative fills. The page has no declared prototype starting point. Slide numbers in the audit follow rows from top to bottom and frames from left to right. The prototype player also reports 118 frames.

## Requirements and acceptance order

1. **Capture** — Slides 4, 7 and 67. Store a note independently of its appearances. The empty title/body composer accepts incomplete thoughts, pasted images and links. A committed note must survive a reload. The home screen shows the tree, recent canvas miniatures and a three-column inbox.
2. **Arrange** — Slides 5, 8, 68 and 103–106. Create, move and color cards. Hit-test section and column drops in world coordinates, retain free-space positions, and fit a soft section background around its contents. Changing to a vertical stack must establish the writing order.
3. **Connect** — Slides 9, 70 and 107–112. Store directed, labeled note relationships independently of location. Expose the label on interaction and show other appearances and external neighbors. Inserting a thread must preserve the note's original membership.
4. **Nest** — Slides 10, 71–83. Form a child canvas from selected notes, preserving their relative positions and shared identities. Navigate using the tree, breadcrumbs and live preview. Support a transfer without losing the note or its original edges.
5. **Write** — Slides 11–13, 85–93. Give the generator the selected notes, their order, the writer's prompt and the relationship labels. Produce a document with attributable passages. The editor and canvas must remain independently usable in split view.
6. **Iterate** — Slides 14–17, 94–102. Duplicate a cluster, insert and reorder a point, request a new version and keep the previous text. A branch must retain its generation-time source material after later edits.
7. **Adapt** — Slides 113–114. Rank inbox suggestions using canvas context. Offer previously used relationship labels and prior stylistic instruction as local signals. These slides describe future behavior with no training specification.
8. **Verify** — Run Rachel's journey on a fresh disposable workspace, including invalid inputs, reload, empty canvases, source navigation, edits, branching and narrow-screen controls. Compare product screenshots with the embedded demos. Audit every slide and retain explicit limits.

## Architecture decisions

A desktop-first browser application uses semantic DOM for editable cards, CSS for intrinsically sized sections, a transformed world for spatial gestures and SVG for dynamic connectors. SQLite stores the whole small single-user workspace atomically with a revision check. The writing service runs on loopback. Its replaceable local language model returns structured sections with validated source IDs. An extractive mode remains usable without a model. Both generation paths are identified in the editor.

The original frames alternate between “AI Thinking” and “Thoughts on AI”. The staged product uses “Thoughts on AI”, so the seed uses that name. The demo starts at different moments in Rachel's work. The initial workspace exposes a populated parent and identity subcanvas so both early and late workflows are reachable. Home and canvas previews render live data.

There are no specifications for cloud accounts, authentication, synchronization, pricing or a mobile app. This reconstruction targets a local single-user workspace. Compact layouts, keyboard equivalents, persistence, error handling and export are implementation decisions.
