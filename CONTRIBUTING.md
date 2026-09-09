# Contributing to AG2 AI Cohost

Help build a more useful AI partner for live streams, podcasts, and conversations. AG2 AI Cohost is a public [BlocUnited](https://github.com/BlocUnited-LLC) project, and contributions are welcome from developers, creators, designers, and documentation writers.

You can start with a small fix, share a reproducible bug, or describe what would make the cohost work better in your setup. For a larger feature or integration, open an [issue](https://github.com/BlocUnited-LLC/ag2-ai-cohost/issues) first so contributors can discuss the approach.

## Where you can help

| Area | Useful contributions |
|---|---|
| Voice and conversation | Improve interruption handling, microphone controls, connection recovery, and audio diagnostics. |
| Avatar and interface | Refine lip-sync, add accessible controls, and improve the experience at different OBS source sizes. |
| Creator integrations | Implement the moderation and stream-control tools that currently have placeholder implementations. |
| Reliability | Add focused tests, mock external services, and make setup errors easier to understand. |
| Documentation | Test the setup guide on your operating system, explain OBS workflows, or add troubleshooting steps. |

Web search and newsletter subscription already have service integrations. Test changes to those tools with mocks where possible; real calls can incur API usage or create subscriptions.

## Get started locally

1. Fork the repository, clone your fork, and create a branch for your change.
2. Follow the [README setup instructions](README.md) to install dependencies and configure the backend.
3. Use [browser controls and OBS setup](docs/usage.md), [agent configuration and tools](docs/configuration.md), and [troubleshooting](docs/troubleshooting.md) as working references.
4. Make a focused change and explain how someone else can check it.

Keep API keys, local `OAI_CONFIG_LIST` files, and private contact information out of commits, screenshots, and logs. Use the public configuration sample when sharing examples.

## Check your change

There is no automated test suite yet: `npm test` is a placeholder that exits with an error. Include the checks you actually ran in your pull request.

For JavaScript server or startup-script changes, run a syntax check on each changed file, for example:

```bash
node --check server.js
node --check scripts/setup-ag2.js
node --check scripts/start-ag2.js
```

For Python changes, you can check compilation without starting the backend or calling a provider:

```bash
python -m compileall -q ag2-backend/realtime_over_webrtc ag2-backend/tools
```

These commands check syntax only. For behavior changes, also exercise the relevant flow:

- **Browser or audio:** confirm the avatar loads, the start button enables audio, microphone mute works, and the cohost responds with lip-sync. Check interruption behavior if your change affects playback.
- **OBS:** describe the source size and OBS version, and check the behavior your change is intended to improve.
- **Tools:** verify arguments, expected results, and failure handling using mocks or a test account you control.
- **Documentation:** check relative links, commands, and the rendered Markdown. State any instructions you could not verify.

## Open a pull request

Describe the problem, the resulting behavior, and how you validated it. Link a related issue if there is one, and include a screenshot or short recording when it helps explain a visual change. Remove private information from any attachments.

Keep unrelated changes in separate pull requests. If something is unfinished or you need design feedback, a draft pull request is welcome.

For licensing context, see the repository [LICENSE](LICENSE) and the separate [backend license](ag2-backend/LICENSE). Preserve existing notices when changing or adding third-party code or assets.
