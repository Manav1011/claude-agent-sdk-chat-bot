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
  streamChatApi,
} from '../utils/api';

const ChatContext = createContext(null);

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

  // Sessions & Messages
  const [currentThreadId, setCurrentThreadId] = useState(() => {
    return localStorage.getItem('qa-chat-current-thread') || null;
  });
  const [messages, setMessages] = useState({});
  const [sessionCursors, setSessionCursors] = useState({});
  const [isLoadingOlder, setIsLoadingOlder] = useState({});
  const [isSelectingSession, setIsSelectingSession] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Settings
  const [speechExplanation, setSpeechExplanation] = useState(() => {
    return localStorage.getItem('qa-speech-explanation') === 'true';
  });
  const [settingSources, setSettingSources] = useState(getInitialSettingSources);
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

  // Streaming & Context usage (per-session streaming state)
  const [contextUsage, setContextUsage] = useState(null);
  const [activeStreams, setActiveStreams] = useState({});
  const abortControllersRef = useRef({});

  // Computed streaming state for current active thread
  const activeStreamContent = (currentThreadId && activeStreams[currentThreadId]?.streamContent) || '';
  const activeThinkingContent = (currentThreadId && activeStreams[currentThreadId]?.thinkingContent) || '';
  const activeSpeechExplanation = (currentThreadId && activeStreams[currentThreadId]?.speechExplanation) || null;
  const isStreaming = Boolean(currentThreadId && activeStreams[currentThreadId]?.isStreaming);
  const isAiResponding = Boolean(currentThreadId && activeStreams[currentThreadId]?.isAiResponding);

  // Modals & UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isContextModalOpen, setIsContextModalOpen] = useState(false);
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
    try {
      await submitPermissionDecision({
        requestId,
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
      showNotification(e.message || 'Failed to submit permission decision', 'error');
      throw e;
    }
  }, [showNotification]);

  // Speech TTS State
  const [speechState, setSpeechState] = useState({
    isPlaying: false,
    activeId: null,
    rate: 1.0,
  });

  const currentSpeechIdRef = useRef(0);

  // Speech Audio Stop
  const stopSpeechAudio = useCallback(() => {
    currentSpeechIdRef.current += 1;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeechState(prev => ({ ...prev, isPlaying: false, activeId: null }));
  }, []);

  // Speech Audio Play
  const playSpeechExplanation = useCallback((text, id) => {
    if (!('speechSynthesis' in window) || !text) return;

    if (speechState.isPlaying && speechState.activeId === id) {
      stopSpeechAudio();
      return;
    }

    stopSpeechAudio();
    currentSpeechIdRef.current += 1;
    const speechId = currentSpeechIdRef.current;

    setSpeechState(prev => ({ ...prev, isPlaying: true, activeId: id }));

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speechState.rate;

    utterance.onend = () => {
      if (speechId !== currentSpeechIdRef.current) return;
      stopSpeechAudio();
    };

    utterance.onerror = (e) => {
      if (speechId !== currentSpeechIdRef.current) return;
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      stopSpeechAudio();
    };

    window.speechSynthesis.speak(utterance);
  }, [speechState.isPlaying, speechState.activeId, speechState.rate, stopSpeechAudio]);

  const cycleSpeechRate = useCallback((id, text) => {
    const speeds = [1.0, 1.25, 1.5, 2.0];
    const nextSpeed = speeds[(speeds.indexOf(speechState.rate) + 1) % speeds.length];
    setSpeechState(prev => ({ ...prev, rate: nextSpeed }));
    if (speechState.isPlaying && speechState.activeId === id) {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = nextSpeed;
      utterance.onend = () => stopSpeechAudio();
      utterance.onerror = (e) => {
        if (e.error === 'canceled' || e.error === 'interrupted') return;
        stopSpeechAudio();
      };
      window.speechSynthesis.speak(utterance);
    }
  }, [speechState.rate, speechState.isPlaying, speechState.activeId, stopSpeechAudio]);

  // Set Current Thread Helper
  const setCurrentThread = useCallback((threadId) => {
    setCurrentThreadId(threadId);
    if (threadId) {
      localStorage.setItem('qa-chat-current-thread', threadId);
    } else {
      localStorage.removeItem('qa-chat-current-thread');
    }
  }, []);

  // Load Sessions for a project
  const loadProjectSessions = useCallback(async (projectId) => {
    try {
      const data = await fetchProjectSessions(projectId);
      setProjectSessions(prev => ({
        ...prev,
        [projectId]: data.sessions || [],
      }));
      return data.sessions || [];
    } catch (e) {
      console.error('Failed to load project sessions:', e);
      setProjectSessions(prev => ({
        ...prev,
        [projectId]: [],
      }));
      return [];
    }
  }, []);

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

  // Toggle Project Expand/Collapse
  const toggleProject = useCallback(async (projectId) => {
    setActiveProjectId(projectId);
    localStorage.setItem('qa-active-project-id', projectId);

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
    stopSpeechAudio();
    setErrorMessage(null);
    setContextUsage(null);
    setCurrentThread(null);

    setOpenTabs((prev) => {
      const hasNull = prev.some((t) => t.threadId === null);
      if (hasNull) return prev;
      return [...prev, { threadId: null, projectId: targetProjId, title: 'New Conversation' }];
    });
  }, [stopSpeechAudio, setCurrentThread, activeProjectId]);

  // Select Session
  const selectSession = useCallback(async (threadId, projId = null, customTitle = null) => {
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
    stopSpeechAudio();
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
  }, [activeProjectId, stopSpeechAudio, setCurrentThread, refreshPendingPermissions, messages, activeStreams, projectSessions]);

  // Close Tab
  const closeTab = useCallback((threadIdToClose) => {
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
  }, [currentThreadId, selectSession, startNewChat]);

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
    stopSpeechAudio();
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
  }, [currentThreadId, stopSpeechAudio, startNewChat]);

  // Send Message & Stream
  const sendMessage = useCallback(async (text) => {
    const cleanText = (text || '').trim();
    if (!cleanText) return;

    let sessionThreadId = currentThreadId;
    const isNewSession = !sessionThreadId;
    if (!sessionThreadId) {
      sessionThreadId = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setCurrentThread(sessionThreadId);
    }

    if (activeStreams[sessionThreadId]?.isStreaming) return;

    const userMsg = { type: 'human', content: cleanText };
    setMessages(prev => ({
      ...prev,
      [sessionThreadId]: [...(prev[sessionThreadId] || []), userMsg],
    }));

    setOpenTabs((prev) => {
      const hasNull = prev.some((t) => t.threadId === null);
      if (hasNull) {
        return prev.map((t) =>
          t.threadId === null
            ? { ...t, threadId: sessionThreadId, title: cleanText.slice(0, 32), projectId: activeProjectId }
            : t
        );
      }
      const exists = prev.some((t) => t.threadId === sessionThreadId);
      if (!exists) {
        return [
          ...prev,
          { threadId: sessionThreadId, projectId: activeProjectId, title: cleanText.slice(0, 32) },
        ];
      }
      return prev;
    });

    const abortCtrl = new AbortController();
    abortControllersRef.current[sessionThreadId] = abortCtrl;

    setActiveStreams(prev => ({
      ...prev,
      [sessionThreadId]: {
        isStreaming: true,
        isAiResponding: true,
        streamContent: '',
        thinkingContent: '',
        speechExplanation: null,
      },
    }));

    setErrorMessage(null);

    let streamAccumulatedAi = '';
    let streamAccumulatedThinking = '';
    let speechExpl = null;

    try {
      for await (const { event, data } of streamChatApi({
        message: cleanText,
        threadId: sessionThreadId,
        projectId: activeProjectId,
        speechExplanation,
        settingSources,
        skillsMode,
        skillsList,
        permissionMode,
        signal: abortCtrl.signal,
      })) {
        const incomingSessionId = data.session_id || data.thread_id;
        if (incomingSessionId && incomingSessionId !== sessionThreadId) {
          const prevId = sessionThreadId;
          sessionThreadId = incomingSessionId;
          setCurrentThread(incomingSessionId);
          abortControllersRef.current[incomingSessionId] = abortCtrl;
          delete abortControllersRef.current[prevId];

          setOpenTabs((prev) =>
            prev.map((t) => (t.threadId === prevId ? { ...t, threadId: incomingSessionId } : t))
          );
          setActiveStreams(prev => {
            const next = { ...prev, [incomingSessionId]: prev[prevId] || {} };
            delete next[prevId];
            return next;
          });
          setMessages(prev => {
            const existing = prev[prevId] || [];
            const updated = { ...prev, [incomingSessionId]: existing };
            if (prevId !== incomingSessionId) delete updated[prevId];
            return updated;
          });
        }

        if (event === 'message') {
          if (data.type === 'human') continue;

          if (data.type === 'context_usage') {
            setContextUsage(data.data);
            continue;
          }

          if (data.type === 'permission_request') {
            setActiveStreams(prev => ({
              ...prev,
              [sessionThreadId]: {
                ...(prev[sessionThreadId] || {}),
                isAiResponding: false,
              },
            }));
            const reqItem = {
              ...data,
              session_id: data.session_id || sessionThreadId,
            };
            setPendingPermissions((prev) => {
              if (prev.some((r) => r.request_id === data.request_id)) return prev;
              return [...prev, reqItem];
            });
            continue;
          }

          if (data.type === 'speech_explanation') {
            speechExpl = data.content;
            setActiveStreams(prev => ({
              ...prev,
              [sessionThreadId]: {
                ...(prev[sessionThreadId] || {}),
                speechExplanation: data.content,
              },
            }));
            continue;
          }

          if (data.type === 'text_delta') {
            streamAccumulatedAi += data.content;
            setActiveStreams(prev => ({
              ...prev,
              [sessionThreadId]: {
                ...(prev[sessionThreadId] || {}),
                isStreaming: true,
                isAiResponding: false,
                streamContent: streamAccumulatedAi,
              },
            }));
          } else if (data.type === 'thinking_delta') {
            streamAccumulatedThinking += data.content;
            setActiveStreams(prev => ({
              ...prev,
              [sessionThreadId]: {
                ...(prev[sessionThreadId] || {}),
                isStreaming: true,
                isAiResponding: false,
                thinkingContent: streamAccumulatedThinking,
              },
            }));
          } else if (data.type === 'tool_result' || data.type === 'tool') {
            if (streamAccumulatedAi || streamAccumulatedThinking) {
              const pendingItems = [];
              if (streamAccumulatedThinking) {
                pendingItems.push({ type: 'thinking', content: streamAccumulatedThinking });
                streamAccumulatedThinking = '';
              }
              if (streamAccumulatedAi) {
                pendingItems.push({
                  type: 'ai',
                  content: streamAccumulatedAi,
                  speech_explanation: speechExpl,
                });
                streamAccumulatedAi = '';
                speechExpl = null;
              }
              if (pendingItems.length > 0) {
                setMessages(prev => ({
                  ...prev,
                  [sessionThreadId]: [...(prev[sessionThreadId] || []), ...pendingItems],
                }));
              }
            }

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
          } else if (data.type === 'tool_result_content') {
            setMessages(prev => {
              const currentList = prev[sessionThreadId] || [];
              const updatedList = [...currentList];
              let found = false;
              if (data.tool_id) {
                for (let i = updatedList.length - 1; i >= 0; i--) {
                  if (updatedList[i].tool_id === data.tool_id || updatedList[i].id === data.tool_id) {
                    updatedList[i] = {
                      ...updatedList[i],
                      content: data.content,
                    };
                    found = true;
                    break;
                  }
                }
              }
              if (!found) {
                for (let i = updatedList.length - 1; i >= 0; i--) {
                  if (updatedList[i].type === 'tool' || updatedList[i].type === 'tool_result') {
                    updatedList[i] = {
                      ...updatedList[i],
                      content: data.content,
                    };
                    found = true;
                    break;
                  }
                }
              }
              return {
                ...prev,
                [sessionThreadId]: updatedList,
              };
            });
          } else {
            setMessages(prev => ({
              ...prev,
              [sessionThreadId]: [...(prev[sessionThreadId] || []), data],
            }));
          }
        } else if (event === 'done') {
          const threadChanged = data.thread_id && data.thread_id !== sessionThreadId;
          const finalThreadId = threadChanged ? data.thread_id : sessionThreadId;
          if (threadChanged) {
            setCurrentThread(data.thread_id);
          }

          const itemsToCommit = [];
          if (streamAccumulatedThinking) {
            itemsToCommit.push({ type: 'thinking', content: streamAccumulatedThinking });
          }
          if (streamAccumulatedAi) {
            itemsToCommit.push({
              type: 'ai',
              content: streamAccumulatedAi,
              speech_explanation: speechExpl,
              usage: data.usage || null,
            });
          }

          if (itemsToCommit.length > 0) {
            setMessages(prev => ({
              ...prev,
              [finalThreadId]: [...(prev[finalThreadId] || prev[sessionThreadId] || []), ...itemsToCommit],
            }));
          }

          setActiveStreams(prev => {
            const next = { ...prev };
            delete next[finalThreadId];
            delete next[sessionThreadId];
            return next;
          });

          if (isNewSession || threadChanged) {
            if (activeProjectId) {
              await loadProjectSessions(activeProjectId);
            }
          }
        } else if (event === 'error') {
          setErrorMessage(data.message || 'Stream processing failed');
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setErrorMessage(err.message || 'Failed to communicate with agent server');
      }
    } finally {
      delete abortControllersRef.current[sessionThreadId];
      setActiveStreams(prev => {
        const next = { ...prev };
        delete next[sessionThreadId];
        return next;
      });
    }
  }, [
    activeStreams,
    currentThreadId,
    activeProjectId,
    speechExplanation,
    settingSources,
    skillsMode,
    skillsList,
    permissionMode,
    setCurrentThread,
    loadProjectSessions,
  ]);

  const stopStream = useCallback((targetThreadId = currentThreadId) => {
    if (targetThreadId && abortControllersRef.current[targetThreadId]) {
      abortControllersRef.current[targetThreadId].abort();
      delete abortControllersRef.current[targetThreadId];
    }
    setActiveStreams(prev => {
      const next = { ...prev };
      delete next[targetThreadId];
      return next;
    });
  }, [currentThreadId]);

  // Initial mount
  useEffect(() => {
    loadProjects().then(() => {
      const storedThread = localStorage.getItem('qa-chat-current-thread');
      if (storedThread) {
        selectSession(storedThread);
      }
    });
  }, []);

  const value = {
    projects,
    activeProjectId,
    expandedProjects,
    loadingProjects,
    projectSessions,
    currentThreadId,
    openTabs,
    closeTab,
    activeStreams,
    messages,
    sessionCursors,
    isLoadingOlder,
    isSelectingSession,
    isLoadingMessages,
    speechExplanation,
    settingSources,
    skillsMode,
    skillsList,
    permissionMode,
    contextUsage,
    isStreaming,
    isAiResponding,
    activeStreamContent,
    activeThinkingContent,
    activeSpeechExplanation,
    isSettingsOpen,
    isContextModalOpen,
    isSidebarOpen,
    setIsSidebarOpen,
    toggleSidebar,
    isMobileSidebarOpen: isSidebarOpen,
    setIsMobileSidebarOpen: setIsSidebarOpen,
    notifications,
    errorMessage,
    speechState,
    setSpeechExplanation: (val) => {
      setSpeechExplanation(val);
      localStorage.setItem('qa-speech-explanation', String(val));
    },
    setSettingSources: (val) => {
      setSettingSources(val);
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
    setIsSettingsOpen,
    setIsContextModalOpen,
    showNotification,
    toggleProject,
    expandAllProjects,
    collapseAllProjects,
    addNewProject,
    deleteProject,
    loadProjectSessions,
    selectSession,
    loadOlderMessages,
    deleteSession,
    startNewChat,
    sendMessage,
    stopStream,
    playSpeechExplanation,
    stopSpeechAudio,
    cycleSpeechRate,
    pendingPermissions,
    respondToPermission,
    refreshPendingPermissions,
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
