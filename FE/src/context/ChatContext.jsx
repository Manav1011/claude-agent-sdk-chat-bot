import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchProjects,
  fetchWorkspace,
  createProject,
  deleteProjectApi,
  fetchProjectSessions,
  fetchSessionMessages,
  deleteSessionApi,
  fetchPendingPermissions,
  submitPermissionDecision,
  sendSessionMessage,
  interruptSession,
  rebuildSessionSettings,
  createSessionEventSource,
  fetchServerInfo,
} from '../utils/api';
import { skillsWireValue } from '../utils/settingsWire';

const ChatContext = createContext(null);

// Order-independent signature of the three session-scope settings, so
// "Done with nothing changed" can skip the rebuild POST entirely.
function settingsSig(s) {
  return JSON.stringify([
    s.settingSources ?? null,
    s.skills ?? null,
    s.permissionMode ?? null,
    s.outputStyle ?? null,
    s.effort ?? null,
  ]);
}

function getInitialSettingSources() {
  const stored = localStorage.getItem('qa-setting-sources');
  if (stored === 'user') return ['user'];
  if (stored === 'local') return ['local'];
  if (stored && stored.startsWith('[')) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      return null;
    }
  }
  return null;
}

export function ChatProvider({ children }) {
  // Sidebar & Projects
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(() => {
    const val = localStorage.getItem('qa-active-project-id');
    return val ? parseInt(val, 10) : null;
  });
  const [expandedProjects, setExpandedProjects] = useState(new Set());
  const [loadingProjects, setLoadingProjects] = useState(new Set());
  const [projectSessions, setProjectSessions] = useState({});
  // ponytail: per-project pagination state — { has_more: bool, loading: bool }.
  // Sessions are still keyed by projectId in projectSessions; meta is keyed the same.
  const [projectSessionsMeta, setProjectSessionsMeta] = useState({});

  // Sessions & Messages
  const [currentThreadId, setCurrentThreadId] = useState(() => {
    return localStorage.getItem('qa-chat-current-thread') || null;
  });
  const [messages, setMessages] = useState({});
  const [sessionCursors, setSessionCursors] = useState({});
  // ponytail: per-session SDK command list. Populated once when the BE
  // broadcasts commands_available (Task 1). The list is fixed for the
  // session's lifetime — settings changes don't re-fetch because the SDK
  // locks setting_sources/skills on the first message and permission_mode
  // doesn't gate commands. Reading components re-derive filtered views.
  const [commands, setCommands] = useState({});
  const [isLoadingOlder, setIsLoadingOlder] = useState({});
  const [isSelectingSession, setIsSelectingSession] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Settings
  const [settingSources, setSettingSourcesState] = useState(getInitialSettingSources);
  // ponytail: mirror settingSources into a ref so openSessionStream (wrapped in
  // useCallback with stable deps) can read the latest value at SSE-open time
  // without re-running on every settings change — that would tear down and
  // recreate every active EventSource.
  const settingSourcesRef = useRef(settingSources);
  useEffect(() => { settingSourcesRef.current = settingSources; }, [settingSources]);
  const [skillsMode, setSkillsMode] = useState(() => {
    const mode = localStorage.getItem('qa-skills-mode');
    return mode === 'all' ? 'default' : (mode || 'default');
  });
  const [skillsList, setSkillsList] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('qa-skills-list') || '[]');
    } catch {
      return [];
    }
  });
  const [permissionMode, setPermissionMode] = useState(() => {
    return localStorage.getItem('qa-permission-mode') || null;
  });
  const [outputStyle, setOutputStyle] = useState(() => {
    return localStorage.getItem('qa-output-style') || null;
  });
  const [effort, setEffort] = useState(() => {
    return localStorage.getItem('qa-effort') || 'medium';
  });
  // ponytail: available output styles fetched from server-info.
  const [availableOutputStyles, setAvailableOutputStyles] = useState([]);
  // ponytail: { [threadId]: boolean } — true while a rebuild POST is in flight
  // for that session. The indicator in ChatInput reads `rebuilding[currentThreadId]`.
  const [rebuilding, setRebuilding] = useState({});
  // ponytail: per-thread debounce timer. Multiple rapid settings changes
  // (e.g. toggling three scopes) collapse into one rebuild 400ms after the
  // last change. Without this, each toggle pays a 2s SDK init.
  const rebuildTimersRef = useRef({});
  // ponytail: { [threadId]: JSON string of last-applied settings }. Lets
  // applySettingsToSession skip the POST when Done was clicked with nothing
  // changed since the last rebuild (open modal → Done = no 2s SDK churn).
  const lastAppliedRef = useRef({});

  // ponytail: safety net. If the rebuild POST succeeds but the
  // commands_available broadcast is lost (network blip, client crash),
  // the indicator would stick forever. Clear it 6s after the POST resolved.
  useEffect(() => {
    const stuck = Object.entries(rebuilding)
      .filter(([, v]) => v)
      .map(([tid]) => tid);
    if (stuck.length === 0) return;
    const t = setTimeout(() => {
      setRebuilding((prev) => {
        const next = { ...prev };
        stuck.forEach((tid) => { next[tid] = false; });
        return next;
      });
    }, 6000);
    return () => clearTimeout(t);
  }, [rebuilding]);

  const [expandThoughts, setExpandThoughts] = useState(() => {
    return localStorage.getItem('qa-expand-thoughts') === 'true';
  });
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('qa-theme') || 'dark';
  });

  useEffect(() => {
    try {
      localStorage.setItem('qa-theme', theme);
    } catch (e) {}
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem('qa-output-style', outputStyle || '');
    } catch (e) {}
  }, [outputStyle]);

  useEffect(() => {
    try {
      localStorage.setItem('qa-effort', effort || '');
    } catch (e) {}
  }, [effort]);

  // Streaming & Context usage (per-session streaming state)
  const [contextUsage, setContextUsage] = useState(null);
  const [activeStreams, setActiveStreams] = useState({});
  const abortControllersRef = useRef({});

  // ponytail: SSE handler is registered once per session but its closure's `activeStreams`
  // reference goes stale on re-render — the `done` handler reads `cur.streamContent` and
  // commits an empty string. Mirror the latest stream buffers in a ref so the handler
  // always sees fresh values without depending on closure-captured React state.
  const streamBuffersRef = useRef({});  // { threadId: { streamContent, thinkingContent } }

  // Per-session EventSource manager for streaming-input mode (one long-lived SSE per session).
  // Map<threadId, { streamManager: { close, subscribe }, unsubscribe }>
  const sessionStreamRef = useRef({});

  // ponytail: first time the SDK emits for a brand-new threadId (one not yet in
  // projectSessions), refresh the workspace's session list once so it shows up
  // in the sidebar without a page reload. Cleared when the user changes projects.
  const sidebarRefreshedForRef = useRef(new Set());

  // ponytail: gate the visibilitychange catch-up so it only runs on a true
  // hidden→visible transition with at least one dead stream. Without this, a
  // healthy tab + alt-tab would re-render the message list on every focus.
  const wasHiddenRef = useRef(false);

  // Computed streaming state for current active thread
  const activeStreamContent = (currentThreadId && activeStreams[currentThreadId]?.streamContent) || '';
  const activeThinkingContent = (currentThreadId && activeStreams[currentThreadId]?.thinkingContent) || '';
  const isStreaming = Boolean(currentThreadId && activeStreams[currentThreadId]?.isStreaming);
  const isAiResponding = Boolean(currentThreadId && activeStreams[currentThreadId]?.isAiResponding);

  // Modals & UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isContextModalOpen, setIsContextModalOpen] = useState(false);
  const [previewModalImage, setPreviewModalImage] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    return typeof window !== 'undefined' ? window.innerWidth >= 1024 : true;
  });
  const [notifications, setNotifications] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);
  const [pendingPermissions, setPendingPermissions] = useState([]);

  // Multi-Session Open Tabs State
  const [openTabs, setOpenTabs] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('qa-open-tabs') || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });

  // Reply-to-quote state: when set, the next send includes the quoted text as
  // a markdown blockquote appended to the user message. Cleared after send.
  const [replyQuote, setReplyQuote] = useState(null);
  const clearReplyQuote = useCallback(() => setReplyQuote(null), []);

  useEffect(() => {
    try {
      localStorage.setItem('qa-open-tabs', JSON.stringify(openTabs));
    } catch (e) {}
  }, [openTabs]);

  // Notifications helper
  const showNotification = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random().toString(36).substring(2);
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3300);
  }, []);

  const refreshPendingPermissions = useCallback(async (threadId = currentThreadId) => {
    try {
      const data = await fetchPendingPermissions(threadId);
      setPendingPermissions(data.requests || []);
    } catch (e) {
      console.error('Failed to fetch pending permissions:', e);
    }
  }, [currentThreadId]);

  const respondToPermission = useCallback(async (requestId, decision, payload = {}) => {
    // Look up the session_id of the request before mutating state so we can
    // pass it to the BE — the BE handler uses (session_id, request_id) as the
    // future key, and the FE without session_id would force a scan.
    const sessionId = pendingPermissions.find((r) => r.request_id === requestId)?.session_id;
    try {
      await submitPermissionDecision({
        requestId,
        sessionId,
        decision,
        updatedInput: payload.updatedInput,
        answers: payload.answers,
        message: payload.message,
      });
      setPendingPermissions(prev => prev.filter(r => r.request_id !== requestId));
      showNotification(
        decision === 'allow' ? 'Permission allowed' : 'Permission denied',
        decision === 'allow' ? 'success' : 'info'
      );
    } catch (e) {
      // BE returns 404 when the future has already been resolved (e.g. session
      // was interrupted while the prompt was open). The prompt is stale — drop
      // it locally so the user isn't stuck retrying.
      const msg = e?.message || '';
      if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('already resolved')) {
        setPendingPermissions(prev => prev.filter(r => r.request_id !== requestId));
        showNotification('Permission already resolved', 'info');
        return;
      }
      showNotification(msg || 'Failed to submit permission decision', 'error');
      throw e;
    }
  }, [showNotification]);

  // Resolve workspace path for an active project (returns null if not resolved yet).
  const getWorkspacePath = useCallback(() => {
    if (!activeProjectId) return null;
    const proj = projects.find((p) => p.id === activeProjectId);
    return proj ? proj.path : null;
  }, [activeProjectId, projects]);

  // Open long-lived SSE for a session. Idempotent — returns the existing handle if already open.
  // The sessionEventHandler closure wires incoming events into React state.
  // ponytail: settingSources is read from settingSourcesRef (not the dep array)
  // so the latest user-configured scope is always sent on SSE-open without
  // forcing openSessionStream to re-run when the user changes it.
  const openSessionStream = useCallback((threadId, sessionEventHandler) => {
    if (!threadId) return null;
    const existing = sessionStreamRef.current[threadId];
    // ponytail: a CLOSED EventSource will never deliver events again. Detect and
    // replace it. Without this, a single network blip permanently breaks the
    // session — error fires, browser gives up, FE never sees new messages.
    if (existing && existing.streamManager?.es?.readyState === EventSource.CLOSED) {
      try { existing.unsubscribe(); existing.streamManager.close(); } catch (_) {}
      delete sessionStreamRef.current[threadId];
    } else if (existing) {
      // If a different handler was registered, swap it.
      if (existing.unsubscribe) existing.unsubscribe();
      const unsub = existing.streamManager.subscribe(sessionEventHandler);
      sessionStreamRef.current[threadId] = { ...existing, unsubscribe: unsub };
      return existing.streamManager;
    }
    const ws = getWorkspacePath();
    if (!ws) return null;
    const streamManager = createSessionEventSource({
      threadId,
      workspace: ws,
      settingSources: settingSourcesRef.current,
    });
    const unsubscribe = streamManager.subscribe(sessionEventHandler);
    sessionStreamRef.current[threadId] = { streamManager, unsubscribe };
    return streamManager;
  }, [getWorkspacePath]);

  const closeSessionStream = useCallback((threadId) => {
    const handle = sessionStreamRef.current[threadId];
    if (!handle) return;
    try {
      handle.unsubscribe();
      handle.streamManager.close();
    } catch (_) {}
    delete sessionStreamRef.current[threadId];
  }, []);

  // ponytail: settings-rebuild trigger. Called once per modal "Done" via
  // applySettingsToSession (not from the setters — toggling must not spam
  // ~2s SDK rebuilds). Skips entirely when nothing changed since the last
  // successful apply. The debounce/abort machinery stays — cheap insurance
  // against double-clicked Done.
  const rebuildSession = useCallback((threadId, settings) => {
    if (!threadId) return;
    const ws = getWorkspacePath();
    if (!ws) return;
    if (lastAppliedRef.current[threadId] === settingsSig(settings)) return;
    // ponytail: clear any pending timer for this thread so the new change
    // resets the 400ms window. The previous scheduled call becomes a no-op
    // (we cancel its in-flight AbortController via the signal).
    const prev = rebuildTimersRef.current[threadId];
    if (prev) {
      clearTimeout(prev.timer);
      prev.controller.abort();
    }
    const controller = new AbortController();
    rebuildTimersRef.current[threadId] = { timer: null, controller };
    rebuildTimersRef.current[threadId].timer = setTimeout(async () => {
      setRebuilding((prev) => ({ ...prev, [threadId]: true }));
      try {
        await rebuildSessionSettings({
          threadId,
          workspace: ws,
          settingSources: settings.settingSources,
          skills: settings.skills,
          permissionMode: settings.permissionMode,
          outputStyle: settings.outputStyle,
          effort: settings.effort,
          signal: controller.signal,
        });
        // ponytail: record on SUCCESS only — an aborted/failed POST must not
        // mark settings as applied, or a later identical Done would be skipped.
        lastAppliedRef.current[threadId] = settingsSig(settings);
        // ponytail: don't clear `rebuilding` here — wait for the matching
        // commands_available (next step). On error, fall through to the
        // catch and clear so the indicator doesn't stick.
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('rebuildSession failed', e);
          setRebuilding((prev) => ({ ...prev, [threadId]: false }));
        }
      } finally {
        // ponytail: only delete our own entry — an aborted POST must not evict
        // the replacement entry a newer change already registered, or the next
        // change can't clearTimeout/abort the newer rebuild.
        if (rebuildTimersRef.current[threadId]?.controller === controller) {
          delete rebuildTimersRef.current[threadId];
        }
      }
    }, 400);
  }, [getWorkspacePath]);

  // Close all open session streams — for unmount or workspace switch.
  const closeAllSessionStreams = useCallback(() => {
    for (const tid of Object.keys(sessionStreamRef.current)) {
      closeSessionStream(tid);
    }
  }, [closeSessionStream]);

  // Set Current Thread Helper
  const setCurrentThread = useCallback((threadId) => {
    setCurrentThreadId(threadId);
    if (threadId) {
      localStorage.setItem('qa-chat-current-thread', threadId);
    } else {
      localStorage.removeItem('qa-chat-current-thread');
    }
  }, []);

  // Load Sessions for a project (initial 5).
  const loadProjectSessions = useCallback(async (projectId) => {
    setProjectSessionsMeta(prev => ({ ...prev, [projectId]: { ...prev[projectId], loading: true } }));
    try {
      const data = await fetchProjectSessions(projectId, { limit: 5, offset: 0 });
      setProjectSessions(prev => ({
        ...prev,
        [projectId]: data.sessions || [],
      }));
      setProjectSessionsMeta(prev => ({
        ...prev,
        [projectId]: { has_more: !!data.has_more, loading: false },
      }));
      return data.sessions || [];
    } catch (e) {
      console.error('Failed to load project sessions:', e);
      setProjectSessions(prev => ({
        ...prev,
        [projectId]: [],
      }));
      setProjectSessionsMeta(prev => ({
        ...prev,
        [projectId]: { has_more: false, loading: false },
      }));
      return [];
    }
  }, []);

  // Load the next page of sessions for a project (10 at a time).
  const loadMoreSessions = useCallback(async (projectId) => {
    const meta = projectSessionsMeta[projectId];
    if (!meta || !meta.has_more || meta.loading) return;
    setProjectSessionsMeta(prev => ({ ...prev, [projectId]: { ...prev[projectId], loading: true } }));
    try {
      const current = projectSessions[projectId] || [];
      const data = await fetchProjectSessions(projectId, { limit: 10, offset: current.length });
      setProjectSessions(prev => ({
        ...prev,
        [projectId]: [...(prev[projectId] || []), ...(data.sessions || [])],
      }));
      setProjectSessionsMeta(prev => ({
        ...prev,
        [projectId]: { has_more: !!data.has_more, loading: false },
      }));
    } catch (e) {
      console.error('Failed to load more sessions:', e);
      setProjectSessionsMeta(prev => ({ ...prev, [projectId]: { ...prev[projectId], loading: false } }));
    }
  }, [projectSessions, projectSessionsMeta]);

  // Load Projects
  const loadProjects = useCallback(async () => {
    try {
      const data = await fetchProjects();
      let projectList = data.projects || [];

      if (projectList.length === 0) {
        try {
          const wsData = await fetchWorkspace();
          const defaultPath = wsData.workspace || '.';
          const name = defaultPath.split('/').filter(Boolean).pop() || 'Default Project';
          const newProj = await createProject(name, defaultPath);
          projectList = [newProj];
        } catch (err) {
          console.error('Failed to auto-add default project:', err);
        }
      }

      setProjects(projectList);

      if (projectList.length > 0) {
        const storedActiveId = localStorage.getItem('qa-active-project-id');
        const activeProj = projectList.find(p => p.id === (storedActiveId ? parseInt(storedActiveId, 10) : null)) || projectList[0];
        if (activeProj) {
          setActiveProjectId(activeProj.id);
          localStorage.setItem('qa-active-project-id', activeProj.id);
          setExpandedProjects(prev => new Set(prev).add(activeProj.id));
          await loadProjectSessions(activeProj.id);
        }
      }
    } catch (e) {
      console.error('Failed to load projects:', e);
    }
  }, [loadProjectSessions]);

  // Fetch available output styles from the backend whenever workspace changes.
  useEffect(() => {
    const ws = getWorkspacePath();
    if (!ws) return;
    fetchServerInfo(ws).then((info) => {
      setAvailableOutputStyles(info.output_styles || []);
    }).catch(() => {});
  }, [getWorkspacePath]);

  // Toggle Project Expand/Collapse
  // ponytail: clicking a project header is just expand/collapse. activeProjectId
  // is owned by selectSession / startNewChat — flipping it here used to switch
  // the running chat's workspace whenever you peeked at another project's sessions.
  const toggleProject = useCallback(async (projectId) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });

    if (!projectSessions[projectId]) {
      setLoadingProjects(prev => new Set(prev).add(projectId));
      await loadProjectSessions(projectId);
      setLoadingProjects(prev => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  }, [projectSessions, loadProjectSessions]);

  // Expand All Projects
  const expandAllProjects = useCallback(async () => {
    const toLoad = [];
    const newExpanded = new Set();
    projects.forEach(p => {
      newExpanded.add(p.id);
      if (!projectSessions[p.id]) {
        toLoad.push(p.id);
      }
    });
    setExpandedProjects(newExpanded);

    if (toLoad.length > 0) {
      setLoadingProjects(prev => {
        const next = new Set(prev);
        toLoad.forEach(id => next.add(id));
        return next;
      });
      await Promise.all(toLoad.map(id => loadProjectSessions(id)));
      setLoadingProjects(prev => {
        const next = new Set(prev);
        toLoad.forEach(id => next.delete(id));
        return next;
      });
    }
  }, [projects, projectSessions, loadProjectSessions]);

  // Collapse All Projects
  const collapseAllProjects = useCallback(() => {
    setExpandedProjects(new Set());
  }, []);

  // Add Project
  const addNewProject = useCallback(async (name, path) => {
    if (!path || !path.trim()) {
      showNotification('Please provide a valid project directory path', 'error');
      return false;
    }
    const cleanPath = path.trim();
    const projName = name && name.trim() ? name.trim() : (cleanPath.split('/').filter(Boolean).pop() || 'Project');

    try {
      const data = await createProject(projName, cleanPath);
      setProjects(prev => [data, ...prev]);
      setActiveProjectId(data.id);
      localStorage.setItem('qa-active-project-id', data.id);
      setExpandedProjects(prev => new Set(prev).add(data.id));
      await loadProjectSessions(data.id);
      startNewChat();
      showNotification(`Project "${projName}" added`, 'success');
      return true;
    } catch (e) {
      showNotification(e.message || 'Failed to add project', 'error');
      return false;
    }
  }, [loadProjectSessions, showNotification]);

  // Delete Project
  const deleteProject = useCallback(async (projectId) => {
    try {
      await deleteProjectApi(projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));
      setExpandedProjects(prev => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
      setProjectSessions(prev => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });

      if (activeProjectId === projectId) {
        setProjects(currentProjects => {
          const remaining = currentProjects.filter(p => p.id !== projectId);
          if (remaining.length > 0) {
            const nextProj = remaining[0];
            setActiveProjectId(nextProj.id);
            localStorage.setItem('qa-active-project-id', nextProj.id);
            setExpandedProjects(prev => new Set(prev).add(nextProj.id));
            loadProjectSessions(nextProj.id);
          } else {
            setActiveProjectId(null);
            localStorage.removeItem('qa-active-project-id');
          }
          return remaining;
        });
      }
      showNotification('Project removed from tracking', 'info');
    } catch (e) {
      showNotification('Failed to remove project', 'error');
    }
  }, [activeProjectId, loadProjectSessions, showNotification]);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  // Sync project session titles and message titles to openTabs
  useEffect(() => {
    setOpenTabs((prev) => {
      let hasChanges = false;
      const updated = prev.map((tab) => {
        if (!tab.threadId) return tab;
        // 1. Search in projectSessions
        let foundSession = null;
        if (tab.projectId && projectSessions[tab.projectId]) {
          foundSession = projectSessions[tab.projectId].find((s) => s.thread_id === tab.threadId);
        }
        if (!foundSession) {
          for (const list of Object.values(projectSessions)) {
            const match = list.find((s) => s.thread_id === tab.threadId);
            if (match) {
              foundSession = match;
              break;
            }
          }
        }
        if (foundSession && foundSession.first_message && foundSession.first_message !== tab.threadId && foundSession.first_message !== tab.title) {
          hasChanges = true;
          return { ...tab, title: foundSession.first_message, projectId: foundSession.project_id || tab.projectId };
        }

        // 2. Search in in-memory messages if title is generic
        const isGenericTitle = !tab.title || tab.title === 'Conversation' || tab.title === 'New Conversation' || tab.title === tab.threadId;
        if (isGenericTitle && messages[tab.threadId]?.length) {
          const firstHuman = messages[tab.threadId].find((m) => m.type === 'human')?.content;
          if (firstHuman && firstHuman !== tab.title) {
            hasChanges = true;
            return { ...tab, title: firstHuman.slice(0, 36) };
          }
        }

        return tab;
      });
      return hasChanges ? updated : prev;
    });
  }, [projectSessions, messages]);

  // Start New Chat
  const startNewChat = useCallback((projId = null) => {
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
    const targetProjId = projId || activeProjectId;
    if (targetProjId) {
      setActiveProjectId(targetProjId);
      localStorage.setItem('qa-active-project-id', String(targetProjId));
      setExpandedProjects((prev) => new Set(prev).add(targetProjId));
    }
    setErrorMessage(null);
    setContextUsage(null);
    // ponytail: assign a UUID eagerly. sendMessage did this lazily on first
    // send, but the slash-command palette needs the SSE open before the user
    // types `/` — which means currentThreadId must be non-null the moment
    // the new tab is selected. We reuse the same getRandomValues fallback
    // sendMessage uses, in case the browser blocks randomUUID in a non-
    // secure context.
    const newThreadId = (crypto.randomUUID && crypto.randomUUID())
      // eslint-disable-next-line no-bitwise
      || ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
          (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c/4).toString(16));
    setCurrentThread(newThreadId);

    setOpenTabs((prev) => {
      const hasNull = prev.some((t) => t.threadId === null);
      if (hasNull) {
        // ponytail: upgrade the existing null tab to the new UUID so we
        // don't end up with two tabs sharing the same session.
        return prev.map((t) => (t.threadId === null ? { ...t, threadId: newThreadId, projectId: targetProjId } : t));
      }
      return [...prev, { threadId: newThreadId, projectId: targetProjId, title: 'New Conversation' }];
    });
  }, [setCurrentThread, activeProjectId]);

  // Select Session
  const selectSession = useCallback(async (threadId, projId = null, customTitle = null) => {
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
    const pId = projId || activeProjectId;
    if (pId) {
      setActiveProjectId(pId);
      localStorage.setItem('qa-active-project-id', String(pId));
    }
    setCurrentThread(threadId);
    setContextUsage(null);
    setErrorMessage(null);

    // Resolve initial title
    let initialTitle = customTitle;
    if (!initialTitle || initialTitle === 'Conversation') {
      const list = (pId && projectSessions[pId]) || [];
      const s = list.find((item) => item.thread_id === threadId);
      if (s && s.first_message && s.first_message !== s.thread_id) {
        initialTitle = s.first_message;
      } else {
        const msgs = messages[threadId] || [];
        const human = msgs.find((m) => m.type === 'human');
        if (human && human.content) {
          initialTitle = human.content.slice(0, 36);
        }
      }
    }

    setOpenTabs((prev) => {
      const existing = prev.find((t) => t.threadId === threadId);
      if (existing) {
        return prev.map((t) =>
          t.threadId === threadId
            ? {
                ...t,
                projectId: pId || t.projectId,
                title: initialTitle || t.title || 'Conversation',
              }
            : t
        );
      }
      return [...prev, { threadId, projectId: pId, title: initialTitle || 'Conversation' }];
    });

    const alreadyHasMessages = Boolean(messages[threadId]?.length);
    const isCurrentlyStreaming = Boolean(activeStreams[threadId]?.isStreaming);

    if (!alreadyHasMessages && !isCurrentlyStreaming) {
      setIsSelectingSession(true);
      setIsLoadingMessages(true);
    }

    try {
      const data = await fetchSessionMessages(threadId, pId, null, 50);
      const loadedMessages = data.messages || [];
      setMessages(prev => ({
        ...prev,
        [threadId]: loadedMessages,
      }));
      setSessionCursors(prev => ({
        ...prev,
        [threadId]: data.next_cursor !== undefined ? data.next_cursor : null,
      }));

      // If tab still has a generic title, infer from loaded messages
      const firstHuman = loadedMessages.find((m) => m.type === 'human')?.content;
      if (firstHuman) {
        setOpenTabs((prev) =>
          prev.map((t) =>
            t.threadId === threadId && (!t.title || t.title === 'Conversation' || t.title === 'New Conversation' || t.title === t.threadId)
              ? { ...t, title: firstHuman.slice(0, 36) }
              : t
          )
        );
      }

      refreshPendingPermissions(threadId);
    } catch (e) {
      console.error('Failed to load session messages:', e);
      if (!alreadyHasMessages) {
        setErrorMessage('Failed to load session messages from server.');
      }
    } finally {
      setIsLoadingMessages(false);
      setTimeout(() => {
        setIsSelectingSession(false);
      }, 150);
    }
  }, [activeProjectId, setCurrentThread, refreshPendingPermissions, messages, activeStreams, projectSessions]);

  // Close Tab
  const closeTab = useCallback((threadIdToClose) => {
    // ponytail: tear down the EventSource for the closed tab so it can't fire
    // errors into a dead handler later. Without this, closing a streaming tab
    // leaks the source and triggers "EventSource error" on subsequent switches.
    closeSessionStream(threadIdToClose);
    setOpenTabs((prevTabs) => {
      const idx = prevTabs.findIndex((t) => t.threadId === threadIdToClose);
      if (idx === -1) return prevTabs;
      const nextTabs = prevTabs.filter((t) => t.threadId !== threadIdToClose);

      if (currentThreadId === threadIdToClose) {
        if (nextTabs.length > 0) {
          const nextIdx = Math.max(0, Math.min(idx, nextTabs.length - 1));
          const target = nextTabs[nextIdx];
          if (target.threadId) {
            selectSession(target.threadId, target.projectId);
          } else {
            startNewChat(target.projectId);
          }
        } else {
          startNewChat();
        }
      }
      return nextTabs;
    });
  }, [closeSessionStream, currentThreadId, selectSession, startNewChat]);

  // Close every tab except `keepThreadId`. If the kept tab isn't the active one,
  // switch the active session to it.
  const closeOtherTabs = useCallback((keepThreadId) => {
    setOpenTabs((prevTabs) => {
      const kept = prevTabs.find((t) => t.threadId === keepThreadId);
      if (!kept) return prevTabs;
      return [kept];
    });
    if (currentThreadId !== keepThreadId) {
      const kept = (openTabs || []).find((t) => t.threadId === keepThreadId);
      if (kept?.threadId) {
        selectSession(kept.threadId, kept.projectId);
      } else {
        startNewChat(kept?.projectId);
      }
    }
  }, [currentThreadId, openTabs, selectSession, startNewChat]);

  // Close every tab to the right of `keepThreadId` (inclusive of the tab's right neighbors).
  const closeTabsToRight = useCallback((keepThreadId) => {
    setOpenTabs((prevTabs) => {
      const idx = prevTabs.findIndex((t) => t.threadId === keepThreadId);
      if (idx === -1) return prevTabs;
      return prevTabs.slice(0, idx + 1);
    });
  }, []);

  // Close every tab to the left of `keepThreadId`.
  const closeTabsToLeft = useCallback((keepThreadId) => {
    setOpenTabs((prevTabs) => {
      const idx = prevTabs.findIndex((t) => t.threadId === keepThreadId);
      if (idx === -1) return prevTabs;
      return prevTabs.slice(idx);
    });
  }, []);

  // Close every tab. Falls back to a fresh "new conversation" tab.
  const closeAllTabs = useCallback(() => {
    setOpenTabs([]);
    startNewChat();
  }, [startNewChat]);

  // Load Older Messages on scroll
  const loadOlderMessages = useCallback(async (threadId = currentThreadId) => {
    if (!threadId || isLoadingOlder[threadId] || !sessionCursors[threadId]) return;

    const cursor = sessionCursors[threadId];
    setIsLoadingOlder(prev => ({ ...prev, [threadId]: true }));

    try {
      const data = await fetchSessionMessages(threadId, activeProjectId, cursor, 50);
      const newMessages = data.messages || [];
      setSessionCursors(prev => ({
        ...prev,
        [threadId]: data.next_cursor !== undefined ? data.next_cursor : null,
      }));

      if (newMessages.length > 0) {
        setMessages(prev => ({
          ...prev,
          [threadId]: [...newMessages, ...(prev[threadId] || [])],
        }));
      }
    } catch (e) {
      console.error('Failed to load older messages:', e);
    } finally {
      setIsLoadingOlder(prev => ({ ...prev, [threadId]: false }));
    }
  }, [currentThreadId, isLoadingOlder, sessionCursors, activeProjectId]);

  // Delete Session
  const deleteSession = useCallback(async (threadId, projectId) => {
    try {
      await deleteSessionApi(threadId);
    } catch (e) {
      console.error('Failed to delete session:', e);
    }

    if (projectId) {
      setProjectSessions(prev => ({
        ...prev,
        [projectId]: (prev[projectId] || []).filter(s => s.thread_id !== threadId),
      }));
    }
    setMessages(prev => {
      const next = { ...prev };
      delete next[threadId];
      return next;
    });

    setOpenTabs((prev) => prev.filter((t) => t.threadId !== threadId));

    if (currentThreadId === threadId) {
      startNewChat();
    }
  }, [currentThreadId, startNewChat]);

  const stopStream = useCallback(async (targetThreadId) => {
    const threadId = (typeof targetThreadId === 'string' && targetThreadId) ? targetThreadId : currentThreadId;
    if (!threadId) return;
    // New: tell the backend SessionLoop to interrupt the agent mid-turn.
    // (Old abort-controller approach only tore down the SSE reader; the subprocess kept running.)
    try {
      const ws = getWorkspacePath();
      if (ws) {
        await interruptSession({ threadId, workspace: ws });
      }
    } catch (err) {
      console.error('interruptSession failed', err);
    }
    // Clean up the legacy abort-controller entries just in case.
    if (abortControllersRef.current[threadId]) {
      try { abortControllersRef.current[threadId].abort(); } catch (_) {}
      delete abortControllersRef.current[threadId];
    }
    // Clear per-thread stream state so UI stops showing it.
    delete streamBuffersRef.current[threadId];
    setActiveStreams(prev => {
      const next = { ...prev };
      delete next[threadId];
      return next;
    });
  }, [currentThreadId, getWorkspacePath]);

  // Send Message & Stream — streaming-input mode: POST message to long-lived SSE session,
  // event handler processes responses via openSessionStream subscription.
  const sendMessage = useCallback(async (text, imagePaths = [], imagePreviews = [], settings = null) => {
    const cleanText = (text || '').trim();
    if (!cleanText && (!imagePaths || imagePaths.length === 0)) return;

    let sessionThreadId = currentThreadId;

    // Auto-interrupt if a turn is currently streaming for this session.
    // Read the ref (not activeStreams state) so we see the live in-flight
    // buffer instead of a stale closure snapshot.
    if (sessionThreadId && streamBuffersRef.current[sessionThreadId]) {
      await stopStream(sessionThreadId);
    }

    const isNewSession = !sessionThreadId;
    if (!sessionThreadId) {
      // Backend requires UUID for /api/sessions/{id}/... — use getRandomValues (works in
      // non-secure contexts) with a randomUUID fast-path.
      sessionThreadId = (crypto.randomUUID && crypto.randomUUID())
        // eslint-disable-next-line no-bitwise
        || ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c/4).toString(16));
      setCurrentThread(sessionThreadId);
    }

    // ponytail: stream state is per-thread and built incrementally inside _handleSessionEvent
    // (was: blocked new sends while stream active — now they queue at the server).
    const userImages = Array.isArray(imagePreviews) && imagePreviews.length > 0
      ? imagePreviews
      : (Array.isArray(imagePaths) ? imagePaths : []);

    const userMsg = {
      type: 'human',
      content: cleanText,
      images: userImages,
    };

    setMessages(prev => ({
      ...prev,
      [sessionThreadId]: [...(prev[sessionThreadId] || []), userMsg],
    }));

    const tabTitlePrompt = cleanText || (imagePaths.length > 0 ? 'Image Analysis' : 'Conversation');

    setOpenTabs((prev) => {
      const hasNull = prev.some((t) => t.threadId === null);
      if (hasNull) {
        return prev.map((t) =>
          t.threadId === null
            ? { ...t, threadId: sessionThreadId, title: tabTitlePrompt.slice(0, 32), projectId: activeProjectId }
            : t
        );
      }
      const exists = prev.some((t) => t.threadId === sessionThreadId);
      if (!exists) {
        return [
          ...prev,
          { threadId: sessionThreadId, projectId: activeProjectId, title: tabTitlePrompt.slice(0, 32) },
        ];
      }
      return prev;
    });

    setActiveStreams(prev => ({
      ...prev,
      [sessionThreadId]: {
        isStreaming: true,
        isAiResponding: true,
        streamContent: '',
        thinkingContent: '',
      },
    }));

    setErrorMessage(null);

    // Open long-lived SSE for this session if not already open. Subscribe a per-thread handler
    // that converts backend events into React state updates.
    openSessionStream(sessionThreadId, (parsed) => _handleSessionEvent(sessionThreadId, parsed));

    // Fire-and-forget POST. Errors surface through the SSE error event from the backend.
    try {
      await sendSessionMessage({
        threadId: sessionThreadId,
        workspace: getWorkspacePath(),
        content: cleanText,
        images: userImages,
        settingSources: settings?.settingSources,
        skills: settings?.skills,
        permissionMode: settings?.permissionMode,
        outputStyle: settings?.outputStyle,
        effort: settings?.effort,
      });
      // The server locks these on the first message — same settings state,
      // so a modal Done that changed nothing must not trigger a rebuild.
      if (settings) lastAppliedRef.current[sessionThreadId] = settingsSig(settings);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to send message');
    }
  }, [
    currentThreadId,
    activeProjectId,
    openSessionStream,
    getWorkspacePath,
    setCurrentThread,
    stopStream,
  ]);

  // Session Event Handler — converts events from the long-lived SessionLoop SSE into React state.
  // `streamContent` / `thinkingContent` live in activeStreams[threadId] so message queueing
  // doesn't conflate turns — each 'done' resets them so the next turn shows the new stream.
  const _handleSessionEvent = useCallback((sessionThreadId, parsed) => {
    const event = parsed.event;
    const data = parsed.data;
    if (!data || data.type === 'human') return;

    if (event === 'heartbeat') return;

    if (event === 'error') {
      // ponytail: a fatal error means the EventSource is CLOSED and the browser
      // will not reconnect. openSessionStream recreates it on the next sendMessage,
      // and sendMessage clears errorMessage — so showing the banner here is just
      // noise for a connection the user can't manually recover. Suppress it.
      if (data.fatal) return;
      setErrorMessage(data.message || 'Stream processing failed');
      return;
    }

    if (event !== 'message') return;

    // ponytail: SDK CLI writes the JSONL row on first turn — once we see a real
    // event for a thread that's not yet in the sidebar, refresh that workspace
    // once so the new session appears without a reload.
    if (activeProjectId && !sidebarRefreshedForRef.current.has(sessionThreadId)) {
      const list = projectSessions[activeProjectId] || [];
      if (!list.some((s) => s.thread_id === sessionThreadId)) {
        sidebarRefreshedForRef.current.add(sessionThreadId);
        loadProjectSessions(activeProjectId);
      } else {
        sidebarRefreshedForRef.current.add(sessionThreadId);
      }
    }

    if (data.type === 'commands_available') {
      // ponytail: replace, don't merge. The BE broadcasts the full list once
      // per session, so any prior list for this session is stale (e.g. the
      // user created a new session with the same UUID by reloading).
      setCommands((prev) => ({ ...prev, [sessionThreadId]: data.commands || [] }));
      // ponytail: a fresh commands list is the BE's signal that the rebuild
      // (if any) is complete. Clear the indicator so the user can type.
      setRebuilding((prev) => (prev[sessionThreadId] ? { ...prev, [sessionThreadId]: false } : prev));
      return;
    }
    if (data.type === 'context_usage') {
      setContextUsage(data.data);
      return;
    }

    if (data.type === 'permission_request') {
      setActiveStreams(prev => ({
        ...prev,
        [sessionThreadId]: { ...(prev[sessionThreadId] || {}), isAiResponding: false },
      }));
      const reqItem = { ...data, session_id: data.session_id || sessionThreadId };
      setPendingPermissions((prev) => {
        if (prev.some((r) => r.request_id === data.request_id)) {
          // SDK retry of an already-known request — log so it doesn't fail silently.
          console.warn(`[permission] duplicate request_id ${data.request_id} - ignoring`);
          return prev;
        }
        return [...prev, reqItem];
      });
      return;
    }

    if (data.type === 'permission_resolved') {
      setPendingPermissions((prev) => prev.filter((r) => r.request_id !== data.request_id));
      // Agent will resume after we resolve; mark responding again.
      setActiveStreams(prev => ({
        ...prev,
        [sessionThreadId]: { ...(prev[sessionThreadId] || {}), isAiResponding: true },
      }));
      return;
    }

    if (data.type === 'text_delta') {
      const buf = (streamBuffersRef.current[sessionThreadId] ||= { streamContent: '', thinkingContent: '' });
      buf.streamContent += data.content || '';
      setActiveStreams(prev => {
        const cur = prev[sessionThreadId] || {};
        return {
          ...prev,
          [sessionThreadId]: {
            ...cur,
            isStreaming: true,
            isAiResponding: false,
            streamContent: buf.streamContent,
          },
        };
      });
      return;
    }

    if (data.type === 'thinking_delta') {
      const buf = (streamBuffersRef.current[sessionThreadId] ||= { streamContent: '', thinkingContent: '' });
      buf.thinkingContent += data.content || '';
      setActiveStreams(prev => {
        const cur = prev[sessionThreadId] || {};
        return {
          ...prev,
          [sessionThreadId]: {
            ...cur,
            isStreaming: true,
            isAiResponding: false,
            thinkingContent: buf.thinkingContent,
          },
        };
      });
      return;
    }

    if (data.type === 'tool_result' || data.type === 'tool') {
      // Flush accumulated stream into messages before adding the tool entry.
      const cur = streamBuffersRef.current[sessionThreadId] || {};
      const itemsToCommit = [];
      if (cur.thinkingContent) {
        itemsToCommit.push({ type: 'thinking', content: cur.thinkingContent });
      }
      if (cur.streamContent) {
        itemsToCommit.push({
          type: 'ai',
          content: cur.streamContent,
        });
      }
      if (itemsToCommit.length > 0) {
        setMessages(prev => ({
          ...prev,
          [sessionThreadId]: [...(prev[sessionThreadId] || []), ...itemsToCommit],
        }));
      }

      // Reset buffers
      streamBuffersRef.current[sessionThreadId] = { streamContent: '', thinkingContent: '' };
      setActiveStreams(prev => ({
        ...prev,
        [sessionThreadId]: {
          ...(prev[sessionThreadId] || {}),
          streamContent: '',
          thinkingContent: '',
          isAiResponding: true,
        },
      }));

      const toolItem = {
        type: 'tool',
        name: data.tool_name || data.name || 'Tool',
        tool_name: data.tool_name || data.name || 'Tool',
        tool_id: data.tool_id || data.id,
        input: data.args || data.input || {},
        args: data.args || data.input || {},
        content: data.content ?? data.output ?? data.result ?? '',
      };
      setMessages(prev => ({
        ...prev,
        [sessionThreadId]: [...(prev[sessionThreadId] || []), toolItem],
      }));
      return;
    }

    if (data.type === 'tool_result_content') {
      setMessages(prev => {
        const currentList = prev[sessionThreadId] || [];
        const updatedList = [...currentList];
        let found = false;
        if (data.tool_id) {
          for (let i = updatedList.length - 1; i >= 0; i--) {
            if (updatedList[i].tool_id === data.tool_id || updatedList[i].id === data.tool_id) {
              updatedList[i] = { ...updatedList[i], content: data.content };
              found = true;
              break;
            }
          }
        }
        if (!found) {
          for (let i = updatedList.length - 1; i >= 0; i--) {
            if (updatedList[i].type === 'tool' || updatedList[i].type === 'tool_result') {
              updatedList[i] = { ...updatedList[i], content: data.content };
              found = true;
              break;
            }
          }
        }
        return { ...prev, [sessionThreadId]: updatedList };
      });
      return;
    }

    if (data.type === 'done') {
      // Read from ref — closure's `activeStreams` is stale (see streamBuffersRef comment).
      const cur = streamBuffersRef.current[sessionThreadId] || {};
      const itemsToCommit = [];
      if (cur.thinkingContent) {
        itemsToCommit.push({ type: 'thinking', content: cur.thinkingContent });
      }
      if (cur.streamContent) {
        itemsToCommit.push({
          type: 'ai',
          content: cur.streamContent,
          usage: data.usage || null,
        });
      }
      if (itemsToCommit.length > 0) {
        setMessages(prev => ({
          ...prev,
          [sessionThreadId]: [...(prev[sessionThreadId] || []), ...itemsToCommit],
        }));
      }
      delete streamBuffersRef.current[sessionThreadId];
      setActiveStreams(prev => {
        const next = { ...prev };
        delete next[sessionThreadId];
        return next;
      });
      if (data.thread_id && data.thread_id !== sessionThreadId) {
        setCurrentThread(data.thread_id);
      }
      return;
    }

    // Generic fallback — append unknown event types as messages.
    setMessages(prev => ({
      ...prev,
      [sessionThreadId]: [...(prev[sessionThreadId] || []), data],
    }));
  }, [setCurrentThread, activeProjectId, projectSessions, loadProjectSessions]);

  // Initial mount
  useEffect(() => {
    loadProjects().then(() => {
      const storedThread = localStorage.getItem('qa-chat-current-thread');
      if (storedThread) {
        selectSession(storedThread);
      }
    });
  }, []);

  // Cleanup: tear down all EventSources on unmount.
  useEffect(() => {
    return () => closeAllSessionStreams();
  }, [closeAllSessionStreams]);

  // ponytail: open the SSE whenever the active session changes, not only
  // when the user sends a message. The BE broadcasts commands_available
  // on the first message, so the SSE must already be subscribed for the
  // FE to receive it. openSessionStream is idempotent (it swaps the
  // handler if the SSE is already open, replaces it if CLOSED) so this is
  // safe to fire on every currentThreadId change.
  useEffect(() => {
    if (!currentThreadId) return;
    openSessionStream(currentThreadId, (parsed) => _handleSessionEvent(currentThreadId, parsed));
  }, [currentThreadId, openSessionStream, _handleSessionEvent]);

  // ponytail: switching workspaces should re-arm the one-shot sidebar refresh.
  useEffect(() => {
    sidebarRefreshedForRef.current = new Set();
  }, [activeProjectId]);

  // ponytail: when the tab comes back to the front, dead EventSources must be
  // recreated (iOS Safari + long background = CLOSED, browser will not auto-
  // reconnect) and a messages-API catch-up fills any gap older than the
  // 2000-event ring buffer. The Last-Event-ID header handles events still in
  // the buffer; this handler handles the buffer-exhausted case + the case
  // where the browser gave up on reconnecting entirely.
  useEffect(() => {
    const onVis = () => {
      const nowVisible = document.visibilityState === 'visible';
      if (!nowVisible) {
        wasHiddenRef.current = true;
        return;
      }
      if (!wasHiddenRef.current) return; // first mount or already visible
      wasHiddenRef.current = false;

      let anyDead = false;
      for (const threadId of Object.keys(sessionStreamRef.current)) {
        const handle = sessionStreamRef.current[threadId];
        const es = handle?.streamManager?.es;
        if (!es) continue;
        // CONNECTING = browser is auto-retrying, leave it (Last-Event-ID will
        //              fire when the reconnect lands).
        // OPEN = live, no action.
        // CLOSED = browser gave up. Recreate with a no-op handler for
        //          backgrounded tabs (their state is refilled by selectSession
        //          on focus). The active tab's handler is registered separately.
        if (es.readyState === EventSource.CLOSED) {
          anyDead = true;
          openSessionStream(threadId, () => {
            // ponytail: no-op on purpose. Backgrounded-tab state is refilled
            // by selectSession's history load when the user switches to it;
            // writing here would race the active tab's reducer.
          });
        } else if (es.readyState === EventSource.CONNECTING) {
          // ponytail: count as unhealthy — the user may have been away long
          // enough for the ring buffer to wrap, so the catch-up still runs.
          anyDead = true;
        }
      }

      // Catch-up for the active tab. Covers events older than the buffer.
      // Idempotent: reducer dedupes by content; server returns full history.
      if (anyDead && currentThreadId) {
        fetchSessionMessages(currentThreadId, activeProjectId, null, 50)
          .then((data) => {
            if (!data?.messages) return;
            setMessages((prev) => ({ ...prev, [currentThreadId]: data.messages }));
          })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [openSessionStream, currentThreadId, activeProjectId]);

  const value = {
    projects,
    activeProjectId,
    expandedProjects,
    loadingProjects,
    projectSessions,
    currentThreadId,
    openTabs,
    closeTab,
    closeOtherTabs,
    closeTabsToLeft,
    closeTabsToRight,
    closeAllTabs,
    replyQuote,
    setReplyQuote,
    clearReplyQuote,
    activeStreams,
    messages,
    sessionCursors,
    isLoadingOlder,
    isSelectingSession,
    isLoadingMessages,
    settingSources,
    skillsMode,
    skillsList,
    permissionMode,
    outputStyle,
    setOutputStyle,
    availableOutputStyles,
    effort,
    setEffort,
    rebuilding,
    rebuildSession,
    // Done-button entry point: one rebuild for all toggled settings, no-op
    // when the sig matches what's already applied/locked.
    applySettingsToSession: () => {
      rebuildSession(currentThreadId, {
        settingSources: settingSourcesRef.current,
        skills: skillsWireValue(skillsMode, skillsList),
        permissionMode,
        outputStyle,
        effort,
      });
    },
    contextUsage,
    isStreaming,
    isAiResponding,
    activeStreamContent,
    activeThinkingContent,
    isSettingsOpen,
    isContextModalOpen,
    previewModalImage,
    setPreviewModalImage,
    isSidebarOpen,
    setIsSidebarOpen,
    toggleSidebar,
    isMobileSidebarOpen: isSidebarOpen,
    setIsMobileSidebarOpen: setIsSidebarOpen,
    notifications,
    errorMessage,
    setSettingSources: (val) => {
      setSettingSourcesState(val);
      settingSourcesRef.current = val;
      if (!val) localStorage.removeItem('qa-setting-sources');
      else if (val.includes('user')) localStorage.setItem('qa-setting-sources', 'user');
      else if (val.includes('local')) localStorage.setItem('qa-setting-sources', 'local');
    },
    setSkillsMode: (val) => {
      setSkillsMode(val);
      localStorage.setItem('qa-skills-mode', val);
    },
    setSkillsList: (val) => {
      setSkillsList(val);
      localStorage.setItem('qa-skills-list', JSON.stringify(val));
    },
    setPermissionMode: (val) => {
      setPermissionMode(val);
      if (val) localStorage.setItem('qa-permission-mode', val);
      else localStorage.removeItem('qa-permission-mode');
    },
    expandThoughts,
    setExpandThoughts: (val) => {
      setExpandThoughts(val);
      localStorage.setItem('qa-expand-thoughts', String(val));
    },
    theme,
    setTheme,
    setIsSettingsOpen,
    setIsContextModalOpen,
    showNotification,
    toggleProject,
    expandAllProjects,
    collapseAllProjects,
    addNewProject,
    deleteProject,
    loadProjectSessions,
    loadMoreSessions,
    projectSessionsMeta,
    selectSession,
    loadOlderMessages,
    deleteSession,
    startNewChat,
    sendMessage,
    stopStream,
    pendingPermissions,
    respondToPermission,
    refreshPendingPermissions,
    commands,  // { [threadId]: [{name, description, argumentHint}] } — the raw map
    currentCommands: commands[currentThreadId] || [],  // selector for the active session
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
