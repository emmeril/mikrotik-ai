# Design direction

Identity: a practical MikroTik operations assistant with a conversation-first workflow inspired by the clarity of modern AI chat products, without copying another product's branding.

Personality: technical, calm, direct, and suitable for daily network administration.

Palette: deep navy navigation, off-white work surface, blue for primary actions, and teal only for live status.

Typography: system sans serif for fast rendering and familiar administration-tool readability. Small uppercase labels mark workflow stages and technical metadata.

Layout: a persistent desktop conversation sidebar becomes an off-canvas menu on mobile. Router connection settings live in a dedicated drawer, while the main canvas follows a chat sequence: ask, review, and apply.

Account entry: a focused login and registration card introduces the self-hosted workspace. After login, the top bar identifies the active account and provides logout without adding a separate account-management section.

Visual motif: compact router context, restrained line icons, alternating user and assistant messages, and a grounded composer repeat across the workspace. The authentication screen stays focused and uses the same warm neutral canvas.

ENERGY 2 / RHYTHM 3 / MOTION 1

Technique reasons:

- Blue is reserved for primary actions, current navigation, and workflow indices so operators can scan the page quickly.
- The dark sidebar separates conversation controls and router context from the active chat.
- Conversation history is ordered by recent activity in the sidebar; restored plans are read-only so an old action cannot be applied accidentally.
- The remote-router guide sits beside router context in the sidebar so setup help is reachable without interrupting the active conversation.
- The desktop sidebar can collapse to give long plans more horizontal room; its restore control remains in the top bar.
- A working light and dark theme lets operators match long-session viewing conditions.
- Flat message rows keep the transcript readable; shadows are reserved for the composer and elevated drawers.
- The four quick prompts share one size because each is an equal starting point for a new request.
- Uppercase labels are limited to technical metadata, matching the character of a network console.
- The compact RouterOS version badge communicates the supported platform range rather than marketing status.
- Motion is limited to the mobile sidebar, state transitions, and temporary loading indicators that stop when a request completes.
- Form controls use a 44px minimum target, visible amber keyboard focus, and a dedicated stacked mobile layout.
- Quick prompts are shown only in the empty conversation so they support first use without competing with an active plan.
