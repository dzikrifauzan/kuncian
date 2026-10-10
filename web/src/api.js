async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error('Tidak bisa terhubung. Cek sinyal, lalu coba lagi.');
    err.status = 0;
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* tidak ada isi */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/') && path !== '/me') window.dispatchEvent(new Event('kuncian:unauth'));
    const err = new Error(data?.error || 'Ada yang tidak beres. Coba lagi sebentar.');
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};
