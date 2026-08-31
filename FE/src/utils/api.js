export async function verifyPasswordApi(password) {
  const res = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return Boolean(data.valid);
}

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

export async function fetchProjectSessions(projectId, { limit = 5, offset = 0 } = {}) {
  const res = await fetch(`/api/projects/${projectId}/sessions?limit=${limit}&offset=${offset}`);
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

export async function submitPermissionDecision({ requestId, sessionId, decision, updatedInput, answers, message }) {
  const res = await fetch('/api/permissions/decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_id: requestId,
      session_id: sessionId || null,
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

// --- Streaming-input mode helpers (long-lived SSE session) ---

export async function sendSessionMessage({ threadId, workspace, content, images = null, settingSources, skills, permissionMode, signal }) {
  const res = await fetch(`/api/sessions/${threadId}/messages?workspace=${encodeURIComponent(workspace)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      images,
      setting_sources: settingSources ?? null,
      skills: skills ?? null,
      permission_mode: permissionMode ?? null,
    }),
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

export async function rebuildSessionSettings({ threadId, workspace, settingSources, skills, permissionMode, signal }) {
  const res = await fetch(`/api/sessions/${threadId}/settings?workspace=${encodeURIComponent(workspace)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: '',  // unused; the body shape matches sendSessionMessage
      setting_sources: settingSources ?? null,
      skills: skills ?? null,
      permission_mode: permissionMode ?? null,
    }),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to rebuild session (${res.status})`);
  }
  return res.json();
}

// Creates a long-lived EventSource that yields {event, data} dicts as
// parsed SSE messages from the backend SessionLoop. Caller must call .close()
// on the returned EventSource to unsubscribe. `settingSources` is JSON-encoded
// into the query so the BE can build the broadcast client with the same scope
// the first user message will declare (palette == per-turn).
export function createSessionEventSource({ threadId, workspace, settingSources = null }) {
  const params = new URLSearchParams({ workspace });
  if (Array.isArray(settingSources) && settingSources.length) {
    params.set('setting_sources', JSON.stringify(settingSources));
  }
  const url = `/api/sessions/${threadId}/events?${params.toString()}`;
  const es = new EventSource(url);

  const subscribers = new Set();
  const emit = (parsed) => subscribers.forEach((cb) => { try { cb(parsed); } catch (_) {} });

  const onMessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      // ponytail: SSE-spec replay id. ev.lastEventId is set by the browser from
      // the `id:` line in the prior stream; empty string when the server never
      // sent one (old server compat). Propagated as metadata — the reducer
      // ignores unknown fields, and the visibilitychange handler reads it
      // indirectly via the existing fatal/error flow.
      emit({ event: 'message', data, id: ev.lastEventId || null });
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
  // ponytail: EventSource fires onerror in three states. CONNECTING = browser
  // is auto-reconnecting (transient, silent). OPEN = shouldn't fire onerror but
  // if it does, the connection is alive. CLOSED = terminal, browser will not
  // reconnect — emit a fatal flag so callers can recreate the source.
  const onError = () => {
    if (es.readyState === EventSource.CONNECTING) return;
    const fatal = es.readyState === EventSource.CLOSED;
    emit({ event: 'error', data: { message: 'EventSource error', fatal } });
  };

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
