export async function fetchProjects() {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error('Failed to fetch projects');
  return res.json();
}

export async function fetchWorkspace() {
  const res = await fetch('/api/workspace');
  if (!res.ok) throw new Error('Failed to fetch workspace');
  return res.json();
}

export async function createProject(name, path) {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to add project');
  }
  return data;
}

export async function deleteProjectApi(projectId) {
  const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete project');
  return res.json();
}

export async function fetchProjectSessions(projectId) {
  const res = await fetch(`/api/projects/${projectId}/sessions`);
  if (!res.ok) throw new Error('Failed to fetch sessions');
  return res.json();
}

export async function fetchSessionMessages(threadId, projectId = null, cursor = null, limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (projectId) params.append('project_id', String(projectId));
  if (cursor !== null && cursor !== undefined) params.append('cursor', String(cursor));

  const res = await fetch(`/api/sessions/${threadId}/messages?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch session messages');
  return res.json();
}

export async function deleteSessionApi(threadId) {
  const res = await fetch(`/api/sessions/${threadId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete session');
  return res.json();
}

export async function fetchPendingPermissions(threadId = null) {
  const url = threadId ? `/api/permissions/pending?thread_id=${encodeURIComponent(threadId)}` : '/api/permissions/pending';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch pending permissions');
  return res.json();
}

export async function submitPermissionDecision({ requestId, decision, updatedInput, answers, message }) {
  const res = await fetch('/api/permissions/decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_id: requestId,
      decision,
      updated_input: updatedInput || null,
      answers: answers || null,
      message: message || null,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to submit permission decision');
  }
  return res.json();
}

export async function uploadImagesApi(files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  const res = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to upload images');
  }
  return res.json();
}

export async function* streamChatApi({
  message,
  imagePaths = [],
  threadId,
  projectId,
  speechExplanation,
  settingSources,
  skillsMode,
  skillsList,
  permissionMode,
  signal,
}) {
  let skillsPayload = null;
  if (skillsMode === 'none') {
    skillsPayload = [];
  } else if (skillsMode === 'custom') {
    skillsPayload = Array.isArray(skillsList) ? skillsList : [];
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      image_paths: Array.isArray(imagePaths) && imagePaths.length > 0 ? imagePaths : null,
      thread_id: threadId,
      project_id: projectId || null,
      speech_explanation: Boolean(speechExplanation),
      setting_sources: settingSources,
      skills: skillsPayload,
      permission_mode: permissionMode,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Server returned error ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const lines = part.split('\n');
        let currentEvent = null;
        let eventData = null;

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              eventData = JSON.parse(line.slice(6).trim());
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }

        if (currentEvent && eventData !== null) {
          yield { event: currentEvent, data: eventData };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// --- Streaming-input mode helpers (long-lived SSE session) ---

export async function sendSessionMessage({ threadId, workspace, content, images = null, signal }) {
  const res = await fetch(`/api/sessions/${threadId}/messages?workspace=${encodeURIComponent(workspace)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, images }),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to send session message (${res.status})`);
  }
  return res.json();
}

export async function interruptSession({ threadId, workspace }) {
  const res = await fetch(`/api/sessions/${threadId}/interrupt?workspace=${encodeURIComponent(workspace)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to interrupt session (${res.status})`);
  }
  return res.json();
}

// Creates a long-lived EventSource that yields {event, data} dicts as
// parsed SSE messages from the backend SessionLoop. Caller must call .close()
// on the returned EventSource to unsubscribe.
export function createSessionEventSource({ threadId, workspace }) {
  const url = `/api/sessions/${threadId}/events?workspace=${encodeURIComponent(workspace)}`;
  const es = new EventSource(url);

  const subscribers = new Set();
  const emit = (parsed) => subscribers.forEach((cb) => { try { cb(parsed); } catch (_) {} });

  const onMessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      emit({ event: 'message', data });
    } catch (e) {
      console.error('Failed to parse session event data', e);
    }
  };
  const onHeartbeat = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      emit({ event: 'heartbeat', data });
    } catch (_) {}
  };
  const onError = () => emit({ event: 'error', data: { message: 'EventSource error' } });

  es.addEventListener('message', onMessage);
  es.addEventListener('heartbeat', onHeartbeat);
  es.onerror = onError;

  return {
    es,
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    close() {
      es.removeEventListener('message', onMessage);
      es.removeEventListener('heartbeat', onHeartbeat);
      es.onerror = null;
      subscribers.clear();
      es.close();
    },
  };
}
