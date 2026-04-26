# Desktop Pet Agent

## Current status

This is a desktop client prototype built with Electron, React, and TypeScript.

What works now:

- desktop window shell
- pet-style UI
- hover or click to reveal the full menu
- text input area
- voice-to-text entry point when Chromium speech recognition is available
- local SQLite memory and reminder persistence
- reminder actions: complete, delete, snooze 10 minutes
- desktop reminder notifications

What is not wired yet:

- real LLM API calls
- Windows calendar integration

## How to open

From the project root run:

```powershell
npm.cmd run dev
```

## Windows client

You can now build a standalone Windows executable:

```powershell
npm.cmd run dist:win
```

After packaging finishes, the client will be created here:

```text
release\Aster-0.1.0-portable.exe
```

You can double-click that file directly without opening VSCode.

If you want AI chat in the packaged client, place a `.env.local` file next to the `.exe` and add:

```env
OPENAI_API_KEY=your_real_key_here
```

When the Electron window appears:

- you will first see the compact desktop pet
- move your mouse over it to reveal the panel
- or click the pet once to pin the menu open
- click again or use the `折叠` button to collapse it

## API key

Create a `.env.local` file in the project root and add:

```env
OPENAI_API_KEY=your_real_key_here
```

In the next step, this key should be read from the Electron main process or a local backend layer instead of exposing it in the renderer UI.
