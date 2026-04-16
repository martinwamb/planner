const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

// Reads an SSE stream from an AI endpoint.
// The server sends `: ping` heartbeats while Ollama generates, then one
// `data: {...json}` event (or `event: error`) at the end.
async function streamRequest(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });

  // If auth or validation failed the server responds with plain JSON before SSE starts
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by double newlines
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith(':')) continue; // heartbeat / comment

      if (trimmed.startsWith('event: error')) {
        const dataLine = trimmed.split('\n').find(l => l.startsWith('data: '));
        const errData = dataLine ? JSON.parse(dataLine.slice(6)) : {};
        throw new Error(errData.error || 'AI error');
      }

      if (trimmed.startsWith('data: ')) {
        return JSON.parse(trimmed.slice(6));
      }
    }
  }

  throw new Error('AI stream ended without a response');
}

export const api = {
  // Auth
  me:           ()      => request('/auth/me'),
  login:        (body)  => request('/auth/login',    { method: 'POST', body: JSON.stringify(body) }),
  register:     (body)  => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  logout:       ()      => request('/auth/logout',   { method: 'POST' }),

  // Projects
  getProjects:    ()       => request('/projects'),
  getProject:     (id)     => request(`/projects/${id}`),
  createProject:  (body)   => request('/projects',    { method: 'POST', body: JSON.stringify(body) }),
  updateProject:  (id, b)  => request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteProject:  (id)     => request(`/projects/${id}`, { method: 'DELETE' }),

  // Tags
  getTags:    ()       => request('/tags'),
  createTag:  (body)   => request('/tags',    { method: 'POST', body: JSON.stringify(body) }),
  deleteTag:  (id)     => request(`/tags/${id}`, { method: 'DELETE' }),

  // Tasks
  getTasks:       (projectId)  => request(`/projects/${projectId}/tasks`),
  createTask:     (pid, body)  => request(`/projects/${pid}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
  updateTask:     (id, body)   => request(`/tasks/${id}`,           { method: 'PUT',  body: JSON.stringify(body) }),
  moveTask:       (id, status) => request(`/tasks/${id}/status`,    { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteTask:     (id)         => request(`/tasks/${id}`,           { method: 'DELETE' }),
  toggleChecklist:(id, checked)=> request(`/checklist/${id}`,       { method: 'PATCH', body: JSON.stringify({ checked }) }),

  // AI — all use SSE streaming so the connection stays alive during long generations
  enhanceTask:       (body) => streamRequest('/ai/enhance-task',       { method: 'POST', body: JSON.stringify(body) }),
  suggestPriorities: ()     => streamRequest('/ai/suggest-priorities', { method: 'POST' }),
  sendWeeklyDigest:  ()     => streamRequest('/ai/weekly-digest',      { method: 'POST' }),
  getDailyPlan:      (date) => streamRequest('/ai/daily-plan',         { method: 'POST', body: JSON.stringify({ date }) }),
};
