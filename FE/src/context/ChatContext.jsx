import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchProjects,
  fetchWorkspace,
  createProject,
  deleteProjectApi,
  fetchProjectSessions,
  fetchSessionMessages,
  deleteSessionApi,
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

  // Streaming & Context usage
  const [contextUsage, setContextUsage] = useState(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeStreamContent, setActiveStreamContent] = useState('');
  const [activeThinkingContent, setActiveThinkingContent] = useState('');
  const [activeSpeechExplanation, setActiveSpeechExplanation] = useState(null);
  const [isAiResponding, setIsAiResponding] = useState(false);

  // Modals & UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isContextModalOpen, setIsContextModalOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);

  // Speech TTS State
  const [speechState, setSpeechState] = useState({
    isPlaying: false,
    activeId: null,
    rate: 1.0,
  });

  const abortControllerRef = useRef(null);
  const currentSpeechIdRef = useRef(0);

  // Notifications helper
  const showNotification = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random().toString(36).substring(2);
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3300);
  }, []);

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

  // Start New Chat
  const startNewChat = useCallback(() => {
    if (window.innerWidth < 1024) {
      setIsMobileSidebarOpen(false);
    }
    stopSpeechAudio();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setIsAiResponding(false);
    setActiveStreamContent('');
    setActiveThinkingContent('');
    setActiveSpeechExplanation(null);
    setErrorMessage(null);
    setContextUsage(null);
    setCurrentThread(null);
  }, [stopSpeechAudio, setCurrentThread]);

  // Select Session
  const selectSession = useCallback(async (threadId, projId = null) => {
    if (window.innerWidth < 1024) {
      setIsMobileSidebarOpen(false);
    }
    stopSpeechAudio();
    if (projId) {
      setActiveProjectId(projId);
      localStorage.setItem('qa-active-project-id', projId);
    }
    setCurrentThread(threadId);
    setContextUsage(null);
    setIsSelectingSession(true);
    setIsLoadingMessages(true);
    setErrorMessage(null);
    setActiveStreamContent('');
    setActiveThinkingContent('');
    setActiveSpeechExplanation(null);

    try {
      const pId = projId || activeProjectId;
      const data = await fetchSessionMessages(threadId, pId, null, 50);
      setMessages(prev => ({
        ...prev,
        [threadId]: data.messages || [],
      }));
      setSessionCursors(prev => ({
        ...prev,
        [threadId]: data.next_cursor !== undefined ? data.next_cursor : null,
      }));
    } catch (e) {
      console.error('Failed to load session messages:', e);
      setErrorMessage('Failed to load session messages from server.');
    } finally {
      setIsLoadingMessages(false);
      setTimeout(() => {
        setIsSelectingSession(false);
      }, 150);
    }
  }, [activeProjectId, stopSpeechAudio, setCurrentThread]);

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

    if (currentThreadId === threadId) {
      startNewChat();
    }
  }, [currentThreadId, stopSpeechAudio, startNewChat]);

  // Send Message & Stream
  const sendMessage = useCallback(async (text) => {
    const cleanText = (text || '').trim();
    if (!cleanText || isStreaming) return;

    setIsStreaming(true);
    setIsAiResponding(true);
    setErrorMessage(null);
    setActiveStreamContent('');
    setActiveThinkingContent('');
    setActiveSpeechExplanation(null);

    let sessionThreadId = currentThreadId;
    const isNewSession = !sessionThreadId;
    if (!sessionThreadId) {
      sessionThreadId = `session-${Date.now().toString(36)}`;
      setCurrentThread(sessionThreadId);
    }

    const userMsg = { type: 'human', content: cleanText };
    setMessages(prev => ({
      ...prev,
      [sessionThreadId]: [...(prev[sessionThreadId] || []), userMsg],
    }));

    abortControllerRef.current = new AbortController();

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
        signal: abortControllerRef.current.signal,
      })) {
        if (event === 'message') {
          if (data.type === 'human') continue;

          if (data.type === 'context_usage') {
            setContextUsage(data.data);
            continue;
          }

          if (data.type === 'speech_explanation') {
            speechExpl = data.content;
            setActiveSpeechExplanation(data.content);
            continue;
          }

          setIsAiResponding(false);

          if (data.type === 'text_delta') {
            streamAccumulatedAi += data.content;
            setActiveStreamContent(streamAccumulatedAi);
          } else if (data.type === 'thinking_delta') {
            streamAccumulatedThinking += data.content;
            setActiveThinkingContent(streamAccumulatedThinking);
          } else if (data.type === 'tool_result' || data.type === 'tool') {
            // Commit any partial AI text or thinking first
            if (streamAccumulatedAi || streamAccumulatedThinking) {
              const pendingItems = [];
              if (streamAccumulatedThinking) {
                pendingItems.push({ type: 'thinking', content: streamAccumulatedThinking });
                streamAccumulatedThinking = '';
                setActiveThinkingContent('');
              }
              if (streamAccumulatedAi) {
                pendingItems.push({
                  type: 'ai',
                  content: streamAccumulatedAi,
                  speech_explanation: speechExpl,
                });
                streamAccumulatedAi = '';
                speechExpl = null;
                setActiveStreamContent('');
                setActiveSpeechExplanation(null);
              }
              if (pendingItems.length > 0) {
                setMessages(prev => ({
                  ...prev,
                  [sessionThreadId]: [...(prev[sessionThreadId] || []), ...pendingItems],
                }));
              }
            }

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
            setIsAiResponding(true);
          } else if (data.type === 'tool_result_content') {
            // Update the matching tool message with its result content
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
            setIsAiResponding(true);
          }
        } else if (event === 'done') {
          setIsAiResponding(false);
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

          setActiveStreamContent('');
          setActiveThinkingContent('');
          setActiveSpeechExplanation(null);

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
      setIsAiResponding(false);
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [
    isStreaming,
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

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setIsAiResponding(false);
  }, []);

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
    isMobileSidebarOpen,
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
    setIsMobileSidebarOpen,
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
