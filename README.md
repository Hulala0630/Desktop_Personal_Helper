# Aster

Aster is a vibe-coded desktop assistant built with Electron, React, and TypeScript.

It lives on the desktop as a small pet, accepts text and offline voice input, keeps local reminders, and fetches fresh AI news from provider and engineering blogs.

## What it does

- Desktop pet style client, not a browser tab
- Hover or click to open the assistant panel
- Freely draggable pet window
- Right-click pet to quit the app
- Local reminder storage and desktop notifications
- Local memory used as agent context
- Streaming AI replies through the OpenAI API
- Offline voice transcription routed into the chat input box
- AI news digest from model providers and technical AI sources

## Tech stack

- Electron
- React
- TypeScript
- better-sqlite3
- OpenAI Responses API
- whisper-tiny based offline transcription

## Quick start

### 1. Clone the project

```powershell
git clone <your-repo-url>
cd desktop_pet_agent
```

### 2. Install dependencies

```powershell
npm.cmd install
```

### 3. Add your API key

You now have two ways to do this:

- Development: create `.env.local` in the project root
- Packaged client: launch the app and paste the key into the built-in first-run setup card

Example:

```env
OPENAI_API_KEY=your_real_key_here
```

### 4. Run in development

```powershell
npm.cmd run dev
```

## Build the Windows client

Generate a portable Windows executable:

```powershell
npm.cmd run dist:win
```

Output:

```text
release\Aster-0.1.0-portable.exe
```

You can double-click the `.exe` directly without opening VS Code.

Generate an installer version:

```powershell
npm.cmd run dist:installer
```

Installer output:

```text
release\Aster-Setup-0.1.0.exe
```

After installation, the first launch will ask the user for an API key and automatically create `.env.local` for them.

## How to use

- Move the mouse over the pet to preview the panel
- Click the pet to pin the panel open
- Drag the pet to any place on the desktop
- Right-click the pet to close the app
- Type a message to create reminders, save context, or ask simple questions
- Click the microphone button to record offline voice input
- Review AI news in the digest section

## Local data

The app stores reminders, chat logs, and memory in a local SQLite database under the Electron user data directory on your machine.

That local data is not included in this repository.

## Repository notes

The following are intentionally not committed:

- `.env.local`
- `node_modules`
- build output such as `out` and `release`
- local user data and SQLite files

## Current focus

Aster is designed first as a lightweight desktop companion for:

- reminder management
- personal context capture
- simple AI chat
- fresh AI updates for builders and technical users
