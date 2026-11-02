/** 分发API薄客户端，不依赖Cesium、不携带机器令牌、不控制地图。 */
export class FireflowClient {
  constructor({ baseUrl, pageOrigin = globalThis.location?.origin, fetchImpl = globalThis.fetch,
                storage = globalThis.localStorage, timeoutMs = 10000 } = {}) {
    const url = new URL(baseUrl || pageOrigin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('INVALID_SERVICE_URL');
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      throw new Error('HTTPS_REQUIRED');
    // 不把跨域失败解释为算法失败，不自动使用代理/关闭CORS/混入公网入口。
    if (pageOrigin && new URL(pageOrigin).origin !== url.origin) throw new Error('SAME_ORIGIN_REQUIRED');
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('INVALID_TIMEOUT');
    this.baseUrl = url.origin;
    this.fetch = fetchImpl;
    this.storage = storage;
    this.timeoutMs = timeoutMs;
    this.sessionId = null;
  }
  async api(path, data) {
    if (!path.startsWith('/api/v1/') || path.startsWith('//')) throw new Error('INVALID_API_PATH');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(this.baseUrl + path, {
        method: data === undefined ? 'GET' : 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', redirect: 'error',
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      if (!response.ok) throw new Error(`FIREFLOW_HTTP_${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  profiles() { return this.api('/api/v1/receiver-profiles'); }
  async selectIdentity(receiverType, roleId) {
    const key = 'fireflow-cesium-terminal-v1';
    let terminal = this.storage?.getItem(key);
    if (!terminal) {
      terminal = 'CESIUM_' + globalThis.crypto.randomUUID();
      this.storage?.setItem(key, terminal);
    }
    const result = await this.api('/api/v1/identity-selections', {
      terminal_id: terminal, receiver_type: receiverType, role_id: roleId,
    });
    if (!result.session_id) throw new Error('INVALID_SESSION_RESPONSE');
    this.sessionId = result.session_id;
    return result;
  }
  requireSession() { if (!this.sessionId) throw new Error('SELECT_IDENTITY_FIRST'); }
  catalog(category = 'wind', { research = false } = {}) {
    this.requireSession();
    const query = new URLSearchParams({ session_id: this.sessionId, category,
                                       view: research ? 'research' : 'operational' });
    return this.api('/api/v1/receiver-catalog?' + query);
  }
  requestProduct(requestType, { parameters = {}, idempotencyKey } = {}) {
    this.requireSession();
    // 网络重试必须传同一个key；一次新点击使用新key。不自动重发POST。
    return this.api('/api/v1/processing-requests', {
      session_id: this.sessionId, request_type: requestType, parameters,
      idempotency_key: idempotencyKey || globalThis.crypto.randomUUID(),
    });
  }
  requestStatus(requestId) {
    this.requireSession();
    return this.api('/api/v1/processing-requests/' + encodeURIComponent(requestId));
  }
  product(productId) { return this.api('/api/v1/products/' + encodeURIComponent(productId)); }
  datasetUrl(datasetId) { return this.baseUrl + '/api/v1/datasets/' + encodeURIComponent(datasetId) + '/content'; }
}
