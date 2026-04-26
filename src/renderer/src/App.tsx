import { motion } from 'framer-motion';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { decodeBlobToPcm } from './offlineSpeech';

type InputSource = 'text' | 'voice';
type ReminderAction = 'complete' | 'delete' | 'snooze10';

type ReminderRecord = {
  id: string;
  title: string;
  rawInput: string;
  remindAt: string;
  status: 'pending' | 'notified' | 'completed';
  source: InputSource;
  createdAt: string;
};

type ChatRecord = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  source: InputSource | 'system';
  createdAt: string;
  streaming?: boolean;
};

type DigestItem = {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
};

type DashboardState = {
  reminders: ReminderRecord[];
  chatLogs: ChatRecord[];
  digestItems: DigestItem[];
};

type StreamEvent =
  | { type: 'start'; streamId: string }
  | { type: 'delta'; streamId: string; delta: string }
  | { type: 'done'; streamId: string; finalText: string; state: DashboardState }
  | { type: 'error'; streamId: string; message: string };

declare global {
  interface Window {
    petApi: {
      minimize: () => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      setExpanded: (expanded: boolean) => Promise<void>;
      getWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number }>;
      setWindowPosition: (x: number, y: number) => Promise<void>;
      showContextMenu: () => Promise<void>;
      transcribeAudio: (samples: ArrayBuffer) => Promise<string>;
      getDashboard: () => Promise<DashboardState>;
      refreshDigest: () => Promise<DashboardState>;
      startAssistantTurn: (input: string, source: InputSource) => Promise<{ streamId: string; state: DashboardState }>;
      reminderAction: (reminderId: string, action: ReminderAction) => Promise<DashboardState>;
      onAssistantStream: (listener: (payload: StreamEvent) => void) => () => void;
    };
  }
}

const PANEL_ANIMATION_MS = 180;

const quickActions = [
  '提醒我明天下午 3 点和客户开会',
  '现阶段我的重点应该是什么？',
  '今天 AI 圈有什么值得我关注的？',
  '记一下：我现在正在做 AI 转型'
];

const emptyState: DashboardState = {
  reminders: [],
  digestItems: [],
  chatLogs: [
    {
      id: 'boot-1',
      role: 'assistant',
      content: '我是 Aster。你可以让我记信息、设提醒、问简单问题，也可以让我给你看最新 AI 资讯。',
      source: 'system',
      createdAt: new Date().toISOString()
    }
  ]
};

const formatTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

const formatReminderDay = (value: string) =>
  new Date(value).toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  });

const formatReminderClock = (value: string) =>
  new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  });

function App() {
  const [dashboard, setDashboard] = useState<DashboardState>(emptyState);
  const [draft, setDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPinnedOpen, setIsPinnedOpen] = useState(false);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const [isDigestCollapsed, setIsDigestCollapsed] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState('离线语音待命。首次使用会下载 whisper-tiny 模型，之后由主进程在本地转写。');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isRefreshingDigest, setIsRefreshingDigest] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const closeTimerRef = useRef<number | null>(null);
  const hoverOpenTimerRef = useRef<number | null>(null);
  const suppressHoverUntilRef = useRef(0);
  const activeStreamMessageIdRef = useRef<string | null>(null);
  const dragStateRef = useRef<{
    startPointerX: number;
    startPointerY: number;
    startWindowX: number;
    startWindowY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    void window.petApi.getDashboard().then(setDashboard);

    const unsubscribe = window.petApi.onAssistantStream((payload) => {
      if (payload.type === 'start') {
        const messageId = `assistant-${payload.streamId}`;
        activeStreamMessageIdRef.current = messageId;
        setDashboard((current) => ({
          ...current,
          chatLogs: [
            ...current.chatLogs,
            {
              id: messageId,
              role: 'assistant',
              content: '',
              source: 'system',
              createdAt: new Date().toISOString(),
              streaming: true
            }
          ]
        }));
      }

      if (payload.type === 'delta') {
        const messageId = activeStreamMessageIdRef.current;
        if (!messageId) {
          return;
        }

        setDashboard((current) => ({
          ...current,
          chatLogs: current.chatLogs.map((message) =>
            message.id === messageId ? { ...message, content: `${message.content}${payload.delta}` } : message
          )
        }));
      }

      if (payload.type === 'done') {
        const messageId = activeStreamMessageIdRef.current;
        activeStreamMessageIdRef.current = null;
        setDashboard({
          ...payload.state,
          chatLogs: payload.state.chatLogs.map((message) =>
            messageId && message.id === messageId ? { ...message, streaming: false } : message
          )
        });
        setIsSubmitting(false);
      }

      if (payload.type === 'error') {
        const messageId = activeStreamMessageIdRef.current;
        activeStreamMessageIdRef.current = null;
        setDashboard((current) => ({
          ...current,
          chatLogs: current.chatLogs.map((message) =>
            message.id === messageId ? { ...message, content: `出错了：${payload.message}`, streaming: false } : message
          )
        }));
        setIsSubmitting(false);
      }
    });

    return () => {
      unsubscribe();
      if (hoverOpenTimerRef.current) {
        window.clearTimeout(hoverOpenTimerRef.current);
      }
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      const deltaX = event.screenX - dragState.startPointerX;
      const deltaY = event.screenY - dragState.startPointerY;

      if (!dragState.moved && (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)) {
        dragState.moved = true;
        suppressHoverUntilRef.current = Date.now() + 320;
      }

      void window.petApi.setWindowPosition(dragState.startWindowX + deltaX, dragState.startWindowY + deltaY);
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const clearHoverOpenTimer = () => {
    if (hoverOpenTimerRef.current) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
  };

  const scheduleHoverOpen = () => {
    clearHoverOpenTimer();

    if (Date.now() < suppressHoverUntilRef.current || dragStateRef.current) {
      return;
    }

    hoverOpenTimerRef.current = window.setTimeout(() => {
      hoverOpenTimerRef.current = null;
      if (Date.now() < suppressHoverUntilRef.current || dragStateRef.current) {
        return;
      }

      void openPanel();
    }, 140);
  };

  const openPanel = async (pin = false) => {
    clearHoverOpenTimer();
    clearCloseTimer();
    if (pin) {
      setIsPinnedOpen(true);
    }
    await window.petApi.setExpanded(true);
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    setIsPanelVisible(true);
  };

  const closePanel = async (force = false) => {
    clearHoverOpenTimer();
    clearCloseTimer();
    if (!force && isPinnedOpen) {
      return;
    }

    setIsPanelVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      void window.petApi.setExpanded(false);
      closeTimerRef.current = null;
    }, PANEL_ANIMATION_MS);
  };

  const scheduleClosePanel = () => {
    if (isPinnedOpen) {
      return;
    }

    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      void closePanel();
    }, 240);
  };

  const startAssistantTurn = async (value: string, source: InputSource) => {
    const content = value.trim();
    if (!content) {
      return;
    }

    const userMessage: ChatRecord = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      source,
      createdAt: new Date().toISOString()
    };

    setDashboard((current) => ({
      ...current,
      chatLogs: [...current.chatLogs, userMessage]
    }));

    setDraft('');
    setIsSubmitting(true);
    await openPanel(true);
    await window.petApi.startAssistantTurn(content, source);
  };

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault();
    await startAssistantTurn(draft, 'text');
  };

  const handleReminderAction = async (reminderId: string, action: ReminderAction) => {
    setDashboard(await window.petApi.reminderAction(reminderId, action));
  };

  const stopRecording = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      return;
    }

    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setIsRecording(false);
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceStatus('当前环境无法访问麦克风。');
      return;
    }

    try {
      setVoiceStatus('正在请求麦克风权限...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      });

      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        try {
          const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          audioChunksRef.current = [];
          setIsTranscribing(true);
          setVoiceStatus('正在离线转写语音...');
          const pcmSamples = await decodeBlobToPcm(audioBlob);
          const transcript = await window.petApi.transcribeAudio(pcmSamples.buffer);

          if (!transcript) {
            setVoiceStatus('没有识别到清晰语音，你可以再试一次。');
            return;
          }

          setDraft(transcript);
          setVoiceStatus('已转写到输入框。你可以修改后再发送。');
          await openPanel(true);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setVoiceStatus(`离线转写失败：${message}`);
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setVoiceStatus('正在录音，再点一次按钮即可停止并转写。');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceStatus(`无法开始录音：${message}`);
    }
  };

  const toggleOfflineVoice = async () => {
    await openPanel(true);
    if (isTranscribing || isSubmitting) {
      return;
    }

    if (isRecording) {
      await stopRecording();
      return;
    }

    await startRecording();
  };

  const refreshDigest = async () => {
    setIsRefreshingDigest(true);
    try {
      setDashboard(await window.petApi.refreshDigest());
    } finally {
      setIsRefreshingDigest(false);
    }
  };

  return (
    <div className="pet-root">
      <div className="pet-stage">
        <button
          type="button"
          className="pet-trigger"
          onMouseEnter={scheduleHoverOpen}
          onMouseLeave={() => {
            clearHoverOpenTimer();
            scheduleClosePanel();
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }

            clearHoverOpenTimer();
            clearCloseTimer();
            suppressHoverUntilRef.current = Date.now() + 500;

            void (async () => {
              if (isPanelVisible && !isPinnedOpen) {
                setIsPanelVisible(false);
                await window.petApi.setExpanded(false);
              }

              const bounds = await window.petApi.getWindowBounds();
              dragStateRef.current = {
                startPointerX: event.screenX,
                startPointerY: event.screenY,
                startWindowX: bounds.x,
                startWindowY: bounds.y,
                moved: false
              };
            })();
          }}
          onPointerUp={() => {
            const dragState = dragStateRef.current;
            if (dragState?.moved) {
              suppressHoverUntilRef.current = Date.now() + 320;
              dragStateRef.current = null;
              return;
            }

            if (isPinnedOpen) {
              setIsPinnedOpen(false);
              void closePanel(true);
            } else {
              void openPanel(true);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            void window.petApi.showContextMenu();
          }}
          aria-label={isPanelVisible ? '收起菜单' : '展开菜单'}
        >
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ repeat: Number.POSITIVE_INFINITY, duration: 3.6, ease: 'easeInOut' }}
            className="pet-avatar"
          >
            <div className="pet-face">
              <span className="eye" />
              <span className="eye" />
            </div>
          </motion.div>
        </button>

        {isPanelVisible ? <div className="hover-bridge" /> : null}

        <motion.div
          initial={false}
          animate={{
            opacity: isPanelVisible ? 1 : 0,
            y: isPanelVisible ? 0 : 18,
            scale: isPanelVisible ? 1 : 0.985
          }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="floating-panel chat-shell"
          style={{ pointerEvents: isPanelVisible ? 'auto' : 'none' }}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClosePanel}
        >
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Desktop Pet Agent</p>
              <h1 className="panel-title">Aster</h1>
            </div>
            <div className="panel-actions">
              <button
                className="icon-button"
                onClick={() => {
                  setIsPinnedOpen(false);
                  void closePanel(true);
                }}
                aria-label="折叠"
                title="折叠"
              >
                <span>⌄</span>
              </button>
              <button className="icon-button" onClick={() => void window.petApi.minimize()} aria-label="收起窗口" title="收起窗口">
                <span>—</span>
              </button>
            </div>
          </div>

          <div className="panel-scroll">
            <section className="panel-block bubble-panel">
              <div className="chat-stack bubbles inner-scroll">
                {dashboard.chatLogs.map((message) => (
                  <div key={message.id} className={`bubble-row ${message.role === 'user' ? 'user' : 'assistant'}`}>
                    <div className={`chat-bubble ${message.role === 'assistant' ? 'assistant' : 'user'}`}>
                      <p className="bubble-author">{message.role === 'assistant' ? 'Aster' : 'You'}</p>
                      <p className="mt-2 text-sm leading-6 text-ink">
                        {message.content || (message.streaming ? '...' : '')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <form className="mt-4" onSubmit={(event) => void submitMessage(event)}>
                <textarea
                  className="input-box"
                  rows={4}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="告诉我你的安排、提醒、当前重点，或者问我今天 AI 圈有什么值得关注的。"
                />
                <div className="mt-3 flex items-center gap-3">
                  <button className="primary-button" type="submit" disabled={isSubmitting || isTranscribing}>
                    {isSubmitting ? 'Aster 正在回复...' : '发送'}
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => void toggleOfflineVoice()}
                    disabled={isSubmitting || isTranscribing}
                    aria-label={isTranscribing ? '转写中' : isRecording ? '停止并转写' : '离线语音输入'}
                    title={isTranscribing ? '转写中' : isRecording ? '停止并转写' : '离线语音输入'}
                  >
                    <span>{isRecording ? '■' : '🎤'}</span>
                  </button>
                </div>
                <p className="mt-3 text-sm text-ink/70">{voiceStatus}</p>
              </form>

              <div className="mt-4 space-y-3">
                {quickActions.map((action) => (
                  <button key={action} className="action-pill" type="button" onClick={() => setDraft(action)}>
                    {action}
                  </button>
                ))}
              </div>
            </section>

            <section className="panel-grid">
              <article className="feature-card bubble-panel">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ember">近期提醒</p>
                  <span className="tag">{dashboard.reminders.length} 条</span>
                </div>
                <div className="mt-3 space-y-3 inner-scroll reminders-scroll">
                  {dashboard.reminders.length === 0 ? (
                    <p className="text-sm leading-6 text-ink/70">还没有提醒。你可以直接说“提醒我明天下午 3 点开会”。</p>
                  ) : (
                    dashboard.reminders.map((reminder) => (
                      <div key={reminder.id} className="data-card">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="reminder-day">{formatReminderDay(reminder.remindAt)}</p>
                            <p className="reminder-title">{reminder.title}</p>
                            <p className="reminder-time">{formatReminderClock(reminder.remindAt)}</p>
                          </div>
                          <span
                            className={
                              reminder.status === 'pending'
                                ? 'status pending'
                                : reminder.status === 'completed'
                                  ? 'status completed'
                                  : 'status notified'
                            }
                          >
                            {reminder.status === 'pending'
                              ? '待提醒'
                              : reminder.status === 'completed'
                                ? '已完成'
                                : '已通知'}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {reminder.status !== 'completed' ? (
                            <>
                              <button
                                type="button"
                                className="tiny-button"
                                onClick={() => void handleReminderAction(reminder.id, 'complete')}
                              >
                                完成
                              </button>
                              <button
                                type="button"
                                className="tiny-button"
                                onClick={() => void handleReminderAction(reminder.id, 'snooze10')}
                              >
                                延后 10 分钟
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            className="tiny-button danger"
                            onClick={() => void handleReminderAction(reminder.id, 'delete')}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </article>

              <article className="feature-card bubble-panel">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ember">AI 资讯</p>
                  <div className="flex gap-2">
                    <button className="tiny-button" type="button" onClick={() => setIsDigestCollapsed((current) => !current)}>
                      {isDigestCollapsed ? '展开' : '折叠'}
                    </button>
                    <button className="tiny-button" type="button" onClick={() => void refreshDigest()}>
                      {isRefreshingDigest ? '刷新中...' : '刷新'}
                    </button>
                  </div>
                </div>
                {!isDigestCollapsed ? (
                  <div className="mt-3 space-y-3 inner-scroll digest-scroll">
                    {dashboard.digestItems.length === 0 ? (
                      <p className="text-sm leading-6 text-ink/70">
                        现在会抓取 provider 官方动态和技术博客，包括 OpenAI、Anthropic、DeepMind、Mistral、Cohere、LangChain、Latent Space、Simon Willison 等来源。
                      </p>
                    ) : (
                      dashboard.digestItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="news-card"
                          onClick={() => void window.petApi.openExternal(item.sourceUrl)}
                        >
                          <p className="text-sm font-semibold text-ink">{item.title}</p>
                          <p className="mt-2 text-sm leading-6 text-ink/70">{item.summary}</p>
                          <p className="mt-2 text-xs uppercase tracking-[0.18em] text-ocean/70">
                            {item.sourceName} · {formatTime(item.publishedAt)}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-ink/70">资讯摘要已折叠，点“展开”查看最新 AI 动态。</p>
                )}
              </article>
            </section>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default App;
