# Getting started with Aegir

A short checklist for testing the current macOS preview. Use your own accounts; no credentials come with the app.

1. **Set up Codex in Aegir.** In onboarding, choose **Check again** to test an existing Codex engine, or **Install Codex** to download a private copy for Aegir. Aegir detects engines bundled with Codex or ChatGPT in `/Applications` or `~/Applications`, as well as standard Codex CLI installations. Neither desktop app is required when using Aegir’s private copy. Choose **Sign in with ChatGPT** if prompted; this opens your browser and requires your own account with Codex access. Setup also checks that a Luna model is available to your account. If an installed engine cannot start, use **Install Codex** and retry here.

2. **Install Mnemosyne for memory.** With Python 3.10 or newer installed, run the following in Terminal. This puts it where Aegir automatically looks; no separate memory account or server is needed. [Package information](https://pypi.org/project/mnemosyne-memory/).

   ```sh
   python3 -m venv "$HOME/.local/share/aegir/mnemosyne-venv"
   "$HOME/.local/share/aegir/mnemosyne-venv/bin/python" -m pip install 'mnemosyne-memory[embeddings]'
   "$HOME/.local/share/aegir/mnemosyne-venv/bin/mnemosyne" --help
   ```

3. **Get the Aegir test build from Ludvig.** The current shared build is for Apple Silicon Macs. Open `Aegir.app`, then open Settings with `Cmd+,`. This is an unsigned development preview, so macOS may block opening it; send Ludvig the exact message if that happens. Building from source instead? Follow [Run in the README](../README.md#run); that route also needs Node and pnpm.

4. **Connect Slack through Composio (optional).** Create your own [Composio account](https://docs.composio.dev/docs/composio-connect) and connect the Slack workspace you want to test. In Aegir, go to **Settings → Connections → Slack via Composio**, enter your Slack connection ID and the **consumer API key from Composio's AI Clients setup**, then Connect. A Platform project API key is not interchangeable. Alternatively, leave the key blank and authorize the same Composio account in the browser. Your workspace may require admin approval. Composio is needed for this Slack connection, not for basic Aegir chat.

5. **Connect other tools if useful.** For Notion, click Connect in Settings and authorize your workspace. For browser tasks, install Google Chrome, enable Browser in Settings, and use **Open browser to sign in**. Aegir uses its own browser profile, so sign in there separately.

6. **Try a small task.** Send Aegir a hello, then ask it to remember a harmless preference and recall it in a new thread. If Slack is connected, ask it to find a message you know exists and check that it uses the right workspace. Finally, create a small task and hand it to the team. This tests chat, memory, connections, and delegation separately.

The **Hourly discovery** routine is enabled by default; pause it in the sidebar while setting up if you do not want background runs. Closing the window leaves Aegir running; use **Aegir → Quit** to exit. Launch at login can be changed in Settings.

If a connection says its saved credentials could not be unlocked, retry after unlocking the macOS Keychain. If that persists, disconnect and reconnect that connection. For other problems, send Ludvig the error text, what you were doing, and whether you used the shared build or built locally—never send API keys or tokens.
