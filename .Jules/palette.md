## 2026-08-05 - Clearer Disabled States in Resource Management Games
**Learning:** In incremental games, disabled plus/minus buttons that look exactly like enabled buttons (except for a native `disabled` attribute) cause friction because users don't immediately know *why* an action is blocked. Without tooltips, they have to deduce it.
**Action:** When adding +/- assignment buttons, always include distinct visual styling for the disabled state (dimmer, `not-allowed` cursor, lower opacity) and native `title` tooltips explaining the constraint (e.g., 'No free crew available').
