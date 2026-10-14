# Roadmap

Caotang is built in the open, one milestone at a time. This page says what exists, what is being built now, and what comes later. It promises no dates.

The design behind each item is in [architecture/](architecture/), and the decisions are in [decisions.md](decisions.md).

## Built

The first release (0.1.0) is a complete writing studio that runs in the browser:

- **Projects** stored in the browser, as a folder on disk (Chrome and Edge), or as a `.caotang` bundle. Folder saves check the folder first and ask before replacing anything another program changed. A project remembers its folder, so reopening it is one click.
- **Binder, corkboard, inspector and editor.** Chapters and scenes, index cards, synopsis and notes, a Markdown editor that saves as you type, word counts, a daily target and focus mode.
- **Codex** of characters, places, objects and lore, with aliases, include policies and a list of where each name appears.
- **The agent.** Plans you approve or edit, draft previews you apply or discard, and a checkpoint for each turn you can restore. It runs on any OpenAI-compatible provider you add, or on the built-in demo provider with no key.
- **Findings.** A quick consistency scan against the codex and your scene declarations, and a model review that runs only after you approve its plan.
- **Export** to Word, EPUB, Markdown and plain text, for the whole manuscript or a part, with saved recipes.
- **Screen and media.** Screenplay scenes in Fountain (with Final Draft import and export), branching dialogue in Ink, storyboards with shot cards, and video prompt packs for several video models.
- **Filters and goals.** Saved binder filters, project goals with deadline pacing, weekly and monthly goals that reset on the day you choose, a sprint timer and a writing history.
- **MCP.** Connect external Model Context Protocol servers to the agent, under per-call approval. Caotang also ships its own MCP server, so other AI tools can read a project folder and, if you allow it, change it with confirmation.

The [user guide](USER-GUIDE.md) describes all of it, and its last section lists what is not in this build yet.

## Next

### Providers

Caotang today speaks the OpenAI Chat Completions format to any compatible endpoint. The next milestone widens that, without asking writers to know which API family a provider uses:

- **Three adapters** inside the app: Anthropic Messages, OpenAI Responses and OpenAI Chat Completions.
- **Presets** for the major providers, each with the right address, adapter and authentication filled in, plus a generic OpenAI-compatible option with a custom address and headers. Custom headers are stored sealed, like keys.
- **Model lists and capabilities.** The provider's live model list where it offers one, and a capability table for thinking levels, image input, tools and structured output.
- **Native tool calling** for models that support it, with the current text protocol as the fallback.
- **Thinking.** A thinking-level control that shows only the levels the chosen model supports. Reasoning appears collapsed in the agent panel, never in the editor.
- **Task roles.** Chat and agent, Drafting, and Background, each set to its own profile, model and thinking level. Drafting and Background follow Chat until you change them, and cost is shown per role.
- **Honest reachability.** Some providers do not accept requests from a browser page. Their presets are shown, disabled, as needing the desktop app or the hosted instance.

### Files that are not UTF-8

Opening a project whose documents use an older encoding will no longer just refuse. Caotang detects the encoding, shows a preview, and converts the file after you approve, keeping a backup of the original. When it cannot tell between close candidates, it shows them side by side and can ask the AI to judge.

## Later

Each of these is its own milestone, designed when its turn comes.

- **Desktop app (Tauri).** For writers who would rather not run Caotang in a browser tab. Native folder storage, the operating system's keychain for keys, stdio MCP servers, and the providers a browser cannot reach.
- **Hosted instance** at `caotang.pawcommit.com`. Sign up with email, Google or GitHub; projects stored end-to-end encrypted so the operator cannot read them; a relay for providers browsers cannot reach. The local-only version at `caotang.app` stays as it is.
- **Mobile app**, reaching your projects on the hosted instance.
- **Signed MCP bundle.** The `.mcpb` bundle ships unsigned today. It will be signed once the bundling tool produces signed bundles that hosts accept.

## Not planned

- Accounts, subscriptions or credit meters in the local version.
- Telemetry or analytics.
- Video generation inside Caotang. It writes prompt packs; you generate video in your own tool with your own account.

## Suggest something

Open an issue on [github.com/caotang-app/caotang](https://github.com/caotang-app/caotang). A feature that fits the principles above (local-first, your own key, plain-text files, an agent that works through the app's own commands) has the best chance.
