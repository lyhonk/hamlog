export interface User {
  id: number;
  callsign: string;
  displayName: string;
  nickname: string;
  avatarUrl: string;
  email: string;
  bio: string;
  signature: string;
  role: 'admin' | 'operator';
}

export interface ManagedUser extends User {
  createdAt: string;
}

export interface CarouselSlide {
  id: number;
  title: string;
  subtitle: string;
  imageUrl: string;
  sortOrder: number;
  createdAt: string;
}

export interface Contact {
  id: number;
  contactedAt: string;
  callsign: string;
  frequencyMhz: number;
  band: string;
  mode: string;
  deviceId: number;
  device: string;
  antennaId: number;
  antenna: string;
  location: string;
  country: string;
  powerW: number;
  powerText: string;
  signalReport: string;
  note: string;
  operatorCallsign: string;
  ownerCallsign: string;
}

export interface ContactPayload {
  contactedAt: string;
  callsign: string;
  frequencyMhz: number;
  band?: string;
  mode: string;
  deviceId: number | string;
  antennaId: number | string;
  location: string;
  country: string;
  powerW?: number;
  powerText: string;
  signalReport: string;
  note: string;
  operatorCallsign?: string;
}

export interface UploadPreviewContact {
  contactedAt: string;
  callsign: string;
  frequencyMhz: number;
  band: string;
  mode: string;
  deviceName: string;
  antennaName: string;
  location: string;
  country: string;
  powerW: number;
  powerText: string;
  signalReport: string;
  note: string;
  operatorCallsign: string;
}

export interface Device {
  id: number;
  name: string;
  type: string;
  status: string;
  ownerCallsign: string;
}

export interface Antenna {
  id: number;
  name: string;
  type: string;
  ownerCallsign: string;
}

export interface DashboardSummary {
  cards: {
    totalContacts: number;
    monthContacts: number;
    activeOperators: number;
    deviceCount: number;
  };
  trends: { monthly: Array<{ month: string; count: number }> };
  distributions: {
    bands: Array<{ name: string; value: number }>;
    modes: Array<{ name: string; value: number }>;
  };
  ranks: {
    callsigns: Array<{ name: string; value: number }>;
    operators: Array<{ name: string; value: number }>;
    devices: Array<{ name: string; value: number }>;
  };
  countries: Array<{ name: string; value: number }>;
  activityCalendar: Array<{ weekDay: string; month: string; count: number }>;
  report: {
    text: string;
    metrics: Array<{ label: string; value: number | string; unit: string }>;
  };
}

const tokenKey = 'hamlog-token';

export function getStoredToken() {
  return localStorage.getItem(tokenKey);
}

export function storeToken(token: string) {
  localStorage.setItem(tokenKey, token);
}

export function clearToken() {
  localStorage.removeItem(tokenKey);
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new Error('无法连接到后端服务，请确认 API 已启动');
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error ?? '请求失败');
  return payload as T;
}

export async function login(callsign: string, password: string) {
  const payload = await request<{ token: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ callsign: callsign.trim().toUpperCase(), password: password.trim() })
  });
  storeToken(payload.token);
  return payload.user;
}

export const api = {
  me: () => request<{ user: User }>('/api/me'),
  updateProfile: (profile: { displayName: string; nickname: string; avatarUrl: string; email: string; bio: string; signature: string }) => request<{ user: User }>('/api/me', {
    method: 'PATCH',
    body: JSON.stringify(profile)
  }),
  changePassword: (currentPassword: string, newPassword: string) => request<{ ok: boolean }>('/api/me/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword })
  }),
  dashboard: () => request<DashboardSummary>('/api/dashboard/summary'),
  devices: () => request<{ devices: Device[] }>('/api/devices'),
  antennas: () => request<{ antennas: Antenna[] }>('/api/antennas'),
  previewContacts: (content: string) => request<{ rows: UploadPreviewContact[]; total: number }>('/api/contacts/preview', {
    method: 'POST',
    body: JSON.stringify({ content })
  }),
  importContacts: (format: 'csv' | 'adif' | 'xlsx' | 'records', content: string) => request<{ imported: number; skipped: number }>('/api/contacts/import', {
    method: 'POST',
    body: JSON.stringify({ format, content })
  }),
  contacts: (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') search.set(key, String(value));
    });
    return request<{ rows: Contact[]; total: number; page: number; pageSize: number; pages: number }>(`/api/contacts?${search.toString()}`);
  },
  updateContact: (id: number, payload: ContactPayload) => request<{ contact: Contact }>(`/api/contacts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  }),
  deleteContact: (id: number) => request<{ deleted: number }>(`/api/contacts/${id}`, {
    method: 'DELETE'
  }),
  deleteContacts: (ids: number[]) => request<{ deleted: number }>('/api/contacts', {
    method: 'DELETE',
    body: JSON.stringify({ ids })
  }),
  uploadImage: (scope: 'avatar' | 'carousel', dataUrl: string) => request<{ url: string; size: number }>('/api/uploads/image', {
    method: 'POST',
    body: JSON.stringify({ scope, dataUrl })
  }),
  carouselSlides: () => request<{ slides: CarouselSlide[] }>('/api/carousel-slides'),
  createCarouselSlide: (payload: { title: string; subtitle: string; imageUrl: string; sortOrder: number }) => request<{ slide: CarouselSlide }>('/api/carousel-slides', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  updateCarouselSlide: (id: number, payload: { title: string; subtitle: string; imageUrl: string; sortOrder: number }) => request<{ slide: CarouselSlide }>(`/api/carousel-slides/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  }),
  deleteCarouselSlide: (id: number) => request<{ deleted: number }>(`/api/carousel-slides/${id}`, {
    method: 'DELETE'
  }),
  users: () => request<{ users: ManagedUser[] }>('/api/users'),
  createUser: (payload: { callsign: string; displayName: string; password: string; role: 'admin' | 'operator' }) => request<{ user: ManagedUser }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  updateUserRole: (id: number, role: 'admin' | 'operator') => request<{ user: ManagedUser }>(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role })
  }),
  deleteUser: (id: number) => request<{ deleted: number }>(`/api/users/${id}`, {
    method: 'DELETE'
  })
};
