import { app, BrowserWindow, ipcMain, Menu, Notification, screen, session, shell } from 'electron';
import path from 'node:path';
import dotenv from 'dotenv';
import { createAssistantService, ReminderAction } from './assistant';
import { getDatabase } from './database';
import { createAiService } from './ai';
import { fetchLatestAiDigest } from './news';
import { transcribePcm } from './offlineSpeech';

const loadEnvFile = () => {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const candidates = [
    path.join(process.cwd(), '.env.local'),
    portableDir ? path.join(portableDir, '.env.local') : null,
    path.join(path.dirname(process.execPath), '.env.local'),
    path.join(process.resourcesPath, '.env.local')
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    dotenv.config({ path: candidate, override: false });
  }
};

loadEnvFile();

let petWindow: BrowserWindow | null = null;
let reminderTimer: NodeJS.Timeout | null = null;
let streamCounter = 0;
let petWindowState: { compactX: number; compactY: number; expanded: boolean } | null = null;

const database = getDatabase();
const assistantService = createAssistantService(database);
const aiService = process.env.OPENAI_API_KEY ? createAiService(process.env.OPENAI_API_KEY) : null;
const windowMargin = 18;
const compactBounds = { width: 156, height: 156 };
const expandedBounds = { width: 520, height: 860 };

const getAnchoredBounds = (width: number, height: number) => {
  const display = screen.getPrimaryDisplay();

  return {
    width,
    height,
    x: display.workArea.x + display.workArea.width - width - windowMargin,
    y: display.workArea.y + display.workArea.height - height - windowMargin
  };
};

const clampBoundsToDisplay = (x: number, y: number, width: number, height: number) => {
  const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
  const workArea = display.workArea;

  return {
    x: Math.min(Math.max(Math.round(x), workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(Math.round(y), workArea.y), workArea.y + workArea.height - height),
    width,
    height
  };
};

const getExpandedBoundsFromCompact = (compactX: number, compactY: number) =>
  clampBoundsToDisplay(
    compactX + compactBounds.width - expandedBounds.width,
    compactY + compactBounds.height - expandedBounds.height,
    expandedBounds.width,
    expandedBounds.height
  );

const syncCompactPositionFromBounds = (bounds: Electron.Rectangle) => {
  if (!petWindowState) {
    petWindowState = {
      compactX: bounds.x,
      compactY: bounds.y,
      expanded: bounds.width === expandedBounds.width && bounds.height === expandedBounds.height
    };
  }

  if (petWindowState.expanded) {
    petWindowState.compactX = bounds.x + expandedBounds.width - compactBounds.width;
    petWindowState.compactY = bounds.y + expandedBounds.height - compactBounds.height;
    return;
  }

  petWindowState.compactX = bounds.x;
  petWindowState.compactY = bounds.y;
};

const setPetWindowExpanded = (expanded: boolean) => {
  if (!petWindow) {
    return;
  }

  if (!petWindowState) {
    const currentBounds = petWindow.getBounds();
    petWindowState = {
      compactX: currentBounds.x,
      compactY: currentBounds.y,
      expanded: currentBounds.width === expandedBounds.width && currentBounds.height === expandedBounds.height
    };
    syncCompactPositionFromBounds(currentBounds);
  }

  petWindowState.expanded = expanded;

  const bounds = expanded
    ? getExpandedBoundsFromCompact(petWindowState.compactX, petWindowState.compactY)
    : clampBoundsToDisplay(petWindowState.compactX, petWindowState.compactY, compactBounds.width, compactBounds.height);

  petWindow.setBounds(bounds, true);
};

const getPetWindowBounds = () => {
  if (!petWindow) {
    return getAnchoredBounds(compactBounds.width, compactBounds.height);
  }

  return petWindow.getBounds();
};

const setPetWindowPosition = (x: number, y: number) => {
  if (!petWindow) {
    return;
  }

  const currentBounds = petWindow.getBounds();
  const nextBounds = clampBoundsToDisplay(x, y, currentBounds.width, currentBounds.height);

  petWindow.setPosition(nextBounds.x, nextBounds.y, true);
  syncCompactPositionFromBounds(nextBounds);
};

const showPetContextMenu = () => {
  if (!petWindow) {
    return;
  }

  const menu = Menu.buildFromTemplate([
    {
      label: '退出桌宠',
      click: () => app.quit()
    }
  ]);

  menu.popup({ window: petWindow });
};

const showReminderNotifications = () => {
  const dueReminders = assistantService.flushDueReminders();

  for (const reminder of dueReminders) {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Aster 提醒你',
        body: reminder.title
      }).show();
    }
  }
};

const createPetWindow = async () => {
  const initialBounds = getAnchoredBounds(compactBounds.width, compactBounds.height);
  petWindowState = {
    compactX: initialBounds.x,
    compactY: initialBounds.y,
    expanded: false
  };

  petWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    x: initialBounds.x,
    y: initialBounds.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    title: 'Desktop Pet Agent',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWindow.setMenuBarVisibility(false);
  petWindow.on('restore', () => petWindow?.setSkipTaskbar(true));
  petWindow.on('show', () => petWindow?.setSkipTaskbar(true));

  if (process.env['ELECTRON_RENDERER_URL']) {
    await petWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    await petWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
};

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });

  ipcMain.handle('pet:minimize', () => {
    if (!petWindow) {
      return;
    }

    petWindow.setSkipTaskbar(false);
    petWindow.minimize();
  });
  ipcMain.handle('pet:openExternal', (_event, url: string) => shell.openExternal(url));
  ipcMain.handle('pet:setExpanded', (_event, expanded: boolean) => setPetWindowExpanded(expanded));
  ipcMain.handle('pet:getWindowBounds', () => getPetWindowBounds());
  ipcMain.handle('pet:setWindowPosition', (_event, x: number, y: number) => setPetWindowPosition(x, y));
  ipcMain.handle('pet:showContextMenu', () => showPetContextMenu());
  ipcMain.handle('pet:clearChat', () => assistantService.clearChatLogs());
  ipcMain.handle('pet:transcribeAudio', async (_event, samples: ArrayBuffer) => {
    const pcmSamples = new Float32Array(samples);
    return transcribePcm(pcmSamples);
  });
  ipcMain.handle('pet:getDashboard', () => assistantService.getDashboardState());
  ipcMain.handle('pet:refreshDigest', async () => {
    const items = await fetchLatestAiDigest();
    assistantService.replaceDigestItems(items);
    return assistantService.getDashboardState();
  });
  ipcMain.handle('pet:startAssistantTurn', async (_event, input: string, source: 'text' | 'voice') => {
    const localResult = assistantService.handleLocalInput(input, source);
    const streamId = `stream-${Date.now()}-${streamCounter++}`;

    if (localResult.localOnly) {
      petWindow?.webContents.send('pet:assistantStream', {
        type: 'start',
        streamId
      });
      petWindow?.webContents.send('pet:assistantStream', {
        type: 'delta',
        streamId,
        delta: localResult.assistantMessage
      });
      petWindow?.webContents.send('pet:assistantStream', {
        type: 'done',
        streamId,
        finalText: localResult.assistantMessage,
        state: assistantService.getDashboardState()
      });
      return {
        streamId,
        state: assistantService.getDashboardState()
      };
    }

    if (!aiService) {
      const fallback = '当前还没有配置 OPENAI_API_KEY，所以我只能先帮你记事和提醒，暂时不能进行 AI 对话或资讯总结。';
      assistantService.finalizeAssistantReply(fallback);
      petWindow?.webContents.send('pet:assistantStream', { type: 'start', streamId });
      petWindow?.webContents.send('pet:assistantStream', { type: 'delta', streamId, delta: fallback });
      petWindow?.webContents.send('pet:assistantStream', {
        type: 'done',
        streamId,
        finalText: fallback,
        state: assistantService.getDashboardState()
      });
      return { streamId, state: assistantService.getDashboardState() };
    }

    petWindow?.webContents.send('pet:assistantStream', { type: 'start', streamId });
    const context = assistantService.buildContext();

    try {
      const finalText = await aiService.streamReply(input, context, (delta) => {
        petWindow?.webContents.send('pet:assistantStream', {
          type: 'delta',
          streamId,
          delta
        });
      });

      const state = assistantService.finalizeAssistantReply(finalText || '我已经处理好了。');
      petWindow?.webContents.send('pet:assistantStream', {
        type: 'done',
        streamId,
        finalText: finalText || '我已经处理好了。',
        state
      });

      return { streamId, state };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      petWindow?.webContents.send('pet:assistantStream', {
        type: 'error',
        streamId,
        message
      });
      return { streamId, state: assistantService.getDashboardState() };
    }
  });
  ipcMain.handle('pet:reminderAction', (_event, reminderId: string, action: ReminderAction) =>
    assistantService.mutateReminder(reminderId, action)
  );

  showReminderNotifications();
  reminderTimer = setInterval(showReminderNotifications, 15_000);
  void createPetWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createPetWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (reminderTimer) {
    clearInterval(reminderTimer);
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
