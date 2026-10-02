# Document workspace concept

## Implemented UI preview

`document-workspace-app.html` loads the real application UI against an isolated, in-memory desktop API. Serve it through Vite (without the Electron launch plugin) and open `/design/mockups/document-workspace-app.html`, then General → Aegir PRD. It reflects the refined interaction: formatted editing only, automatic selection context, no draft header or suggestion widget, and Esc/F6 keyboard navigation. Files and messages are simulated; no user data or agents are accessed.

The original standalone sketch below is retained as design history.

Open `document-workspace.html` in a browser. This is a standalone interaction sketch, not an application integration. It uses the existing Lime Glass palette and system font fallbacks; it has no external dependencies.

Click the PRD file card or Attached files to collapse navigation into a rail, hide the thread list, and open a document next to the conversation. Close restores the conversation layout. Resize the divider with a pointer or the left/right arrow keys. Below 760px, Document and Conversation buttons switch between the two surfaces.

The document supports direct text edits and a limited Markdown source toggle (headings, paragraphs, and bullet lists). Select document text and choose Ask the team to attach a passage to a message. Sending adds a local demo message; no agent is connected. The sample suggestion can be accepted or dismissed; accepting preserves other document edits and refuses to replace an already-edited target paragraph.

Edits last only until reload. Reset demo resets all state. Sidebar items illustrate context and are not navigation controls. Passage references reopen the document but do not yet anchor to the exact text. Version history, real Markdown round-trip fidelity, persistence, and live collaboration are outside this mockup.

Accessible controls include focus outlines, labeled editors, textual suggestion states, and a keyboard-operable resize separator. This concept introduces no production components or token changes.
