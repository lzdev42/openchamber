import dns from 'dns';
import { URL } from 'url';

// ===== 内存日志缓冲区 =====
const MAX_LOGS = 200;
const logBuffer = [];

function addLog(level, message, data = null) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message: typeof message === 'string' ? message : JSON.stringify(message),
    data: data ? JSON.stringify(data) : null,
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
}

export function getLogs() {
  return [...logBuffer];
}

export function clearLogs() {
  logBuffer.length = 0;
}

// ===== DNS 缓存 =====
const dnsCache = new Map();
const DNS_CACHE_TTL = 60_000;
let dnsResolver = null;

function refreshDnsResolver(dnsConfig) {
  if (!dnsConfig || !dnsConfig.enabled || !Array.isArray(dnsConfig.servers) || dnsConfig.servers.length === 0) {
    dnsResolver = null;
    return;
  }
  dnsResolver = new dns.Resolver();
  dnsResolver.setServers(dnsConfig.servers);
  if (dnsConfig.timeout) dnsResolver.setTimeout(dnsConfig.timeout);
}

function customLookup(hostname, options, callback) {
  if (!dnsResolver) {
    return dns.lookup(hostname, options, callback);
  }
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    return callback(null, cached.ip, 4);
  }
  dnsResolver.resolve4(hostname, (err, addresses) => {
    if (err) {
      addLog('error', `DNS resolve failed ${hostname}: ${err.code || err.message}`);
      return dns.lookup(hostname, options, callback);
    }
    if (!addresses || addresses.length === 0) {
      return callback(new Error(`DNS returned no addresses for ${hostname}`));
    }
    const ip = addresses[0];
    dnsCache.set(hostname, { ip, expiresAt: Date.now() + DNS_CACHE_TTL });
    callback(null, ip, 4);
  });
}

// ===== 代理转发 =====
const FALLBACK_TRIGGER_CODES = [429, 500, 502, 503, 504];
const RETRY_DELAY_MS = 1000;

// Stall detection during body streaming. If no new chunk arrives from the
// upstream API for this many milliseconds, abort the reader and close the
// connection. This prevents the UI from hanging indefinitely when the API
// stalls mid-stream (e.g. connection silently drops after partial output).
// 30s aligns with OpenCode's own chunkTimeout default — if the upstream
// hasn't sent anything for 30s, it's almost certainly stalled.
const STALL_TIMEOUT_MS = 30_000;

const HOP_BY_HOP_HEADERS = new Set([
  'content-encoding',
  'transfer-encoding',
  'content-length',
  'connection',
  'keep-alive',
]);

function buildFallbackChain(routes, requestModel) {
  const routeConfig = routes[requestModel];
  if (!routeConfig) return [];

  const chain = [requestModel];
  if (Array.isArray(routeConfig.fallback)) {
    for (const fbName of routeConfig.fallback) {
      if (fbName === requestModel) continue;
      const fbRoute = routes[fbName];
      if (fbRoute && fbRoute.enabled !== false && !chain.includes(fbName)) {
        chain.push(fbName);
      }
    }
  }
  return chain;
}

function buildRequestBody(parsedBody, routeConfig) {
  const body = { ...parsedBody, ...(routeConfig.params || {}) };
  if (routeConfig.model_id) {
    body.model = routeConfig.model_id;
  }
  return JSON.stringify(body);
}

function buildProxyHeaders(originalHeaders, routeConfig, bodyString) {
  const headers = { ...originalHeaders };
  delete headers['host'];
  delete headers['connection'];
  delete headers['accept-encoding'];
  headers['content-length'] = Buffer.byteLength(bodyString);
  if (routeConfig.apikey) {
    headers['authorization'] = `Bearer ${routeConfig.apikey}`;
  }
  headers['content-type'] = 'application/json';
  return headers;
}

function resolveTargetUrl(endpoint) {
  const targetUrl = new URL(endpoint);
  if (!targetUrl.pathname.endsWith('/chat/completions')) {
    targetUrl.pathname = targetUrl.pathname.replace(/\/+$/, '') + '/chat/completions';
  }
  return targetUrl;
}

async function streamResponse(response, res) {
  res.status(response.status);
  response.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });
  if (response.body) {
    const reader = response.body.getReader();
    let hasWritten = false;
    while (true) {
      // Race each read against a stall timer. If the upstream API sends
      // nothing for STALL_TIMEOUT_MS, abort the reader and close the
      // response so OpenCode sees a clean connection close instead of
      // hanging forever.
      let stallTimer = null;
      const stallPromise = new Promise((_, reject) => {
        stallTimer = setTimeout(() => {
          const err = new Error('STREAM_STALL');
          err.stalled = true;
          err.hasWritten = hasWritten;
          reject(err);
        }, STALL_TIMEOUT_MS);
      });
      try {
        const { done, value } = await Promise.race([reader.read(), stallPromise]);
        clearTimeout(stallTimer);
        if (done) break;
        hasWritten = true;
        res.write(Buffer.from(value));
      } catch (error) {
        clearTimeout(stallTimer);
        // Stall (or reader error): abort the upstream reader.
        //
        // If hasWritten is false, no data has been flushed to the client
        // yet — res.status()/res.setHeader() were called but Express
        // hasn't sent headers (that only happens on first write or end).
        // We must NOT call res.end() here so the caller can still retry
        // or send an error response.
        //
        // If hasWritten is true, headers and partial body are already
        // committed. We close the response so OpenCode sees a clean
        // connection close instead of hanging forever.
        try { await reader.cancel(); } catch { /* ignore */ }
        if (hasWritten && !res.writableEnded) {
          res.end();
        }
        throw error;
      }
    }
  }
  res.end();
}

export function createAirouterRoutes(config) {
  const getConfig = () => config;

  const proxyChatCompletion = async (req, res) => {
    const currentConfig = typeof config === 'function' ? config() : config;
    const routes = currentConfig?.routes || {};
    const dnsConfig = currentConfig?.dns || { enabled: false };

    refreshDnsResolver(dnsConfig);

    const parsedBody = req.body;
    if (!parsedBody || typeof parsedBody !== 'object') {
      res.status(400).json({ error: { message: 'Invalid request body.' } });
      return;
    }

    const requestModel = parsedBody.model;
    if (!requestModel || typeof requestModel !== 'string') {
      res.status(400).json({ error: { message: "Missing 'model' field in request body." } });
      return;
    }

    const routeConfig = routes[requestModel];
    if (!routeConfig) {
      addLog('error', `No route configured for model: ${requestModel}`);
      res.status(404).json({ error: { message: `No route configured for model: ${requestModel}` } });
      return;
    }

    if (routeConfig.enabled === false) {
      addLog('warn', `Route disabled: ${requestModel}`);
      res.status(404).json({ error: { message: `Route disabled: ${requestModel}` } });
      return;
    }

    addLog('info', `Request ${requestModel}`);

    const fallbackChain = buildFallbackChain(routes, requestModel);
    if (fallbackChain.length > 1) {
      addLog('info', `Fallback chain: ${fallbackChain.join(' → ')}`);
    }

    const isClientAborted = { value: false };
    res.on('close', () => {
      if (!res.writableEnded) {
        isClientAborted.value = true;
      }
    });

    const tryRouteChain = async (chainIndex) => {
      if (isClientAborted.value) return;

      if (chainIndex >= fallbackChain.length) {
        addLog('error', `All routes (including fallbacks) failed: ${requestModel}`);
        if (!res.headersSent) {
          res.status(502).json({ error: { message: 'All routes (including fallbacks) failed' } });
        }
        return;
      }

      const routeName = fallbackChain[chainIndex];
      const rConfig = routes[routeName];

      if (chainIndex > 0) {
        addLog('warn', `Fallback [${chainIndex}/${fallbackChain.length - 1}] → ${routeName}`);
      }

      // Build request body with params merged
      const finalBodyString = buildRequestBody(parsedBody, rConfig);

      // Resolve target URL
      let targetUrl;
      try {
        targetUrl = resolveTargetUrl(rConfig.endpoint);
      } catch (e) {
        addLog('error', `Invalid endpoint URL: ${rConfig.endpoint}`);
        await tryRouteChain(chainIndex + 1);
        return;
      }

      // Build headers
      const proxyHeaders = buildProxyHeaders(req.headers || {}, rConfig, finalBodyString);

      const maxRetries = rConfig.max_retries !== undefined ? rConfig.max_retries : 3;
      const timeoutMs = rConfig.timeout !== undefined ? rConfig.timeout : 60000;
      const hasFallback = chainIndex < fallbackChain.length - 1;

      addLog('info', `Forward → ${routeName} model=${rConfig.model_id} @ ${targetUrl.hostname}`);

      const executeRequest = async (attempt) => {
        if (isClientAborted.value) return;

        addLog('info', `Attempt [${attempt + 1}/${maxRetries + 1}] ${routeName} → ${rConfig.model_id} @ ${targetUrl.hostname}`);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(targetUrl.toString(), {
            method: 'POST',
            headers: proxyHeaders,
            body: finalBodyString,
            signal: controller.signal,
          });

          clearTimeout(timer);

          if (response.status >= 400) {
            const errorText = await response.text().catch(() => '');
            const isRetriable = FALLBACK_TRIGGER_CODES.includes(response.status);

            addLog('error', `HTTP ${response.status} ${routeName} attempt=${attempt + 1}`, errorText.slice(0, 500));

            if (isRetriable && attempt < maxRetries && !isClientAborted.value) {
              const retryAfter = response.headers.get('retry-after');
              const delay = retryAfter ? Math.max(parseInt(retryAfter, 10) * 1000, RETRY_DELAY_MS) : RETRY_DELAY_MS;
              addLog('warn', `Retry [${attempt + 2}/${maxRetries + 1}] ${routeName} delay=${delay}ms`);
              await new Promise((resolve) => setTimeout(resolve, delay));
              await executeRequest(attempt + 1);
              return;
            }

            if (isRetriable && hasFallback && !isClientAborted.value) {
              const nextRoute = fallbackChain[chainIndex + 1];
              const nextConfig = routes[nextRoute];
              addLog('warn', `Fallback ${routeName} → ${nextRoute} (HTTP ${response.status}, retries exhausted)`);
              if (nextConfig) {
                addLog('info', `Fallback target: ${nextConfig.model_id || nextRoute} @ ${nextConfig.endpoint || '?'}`);
              }
              await tryRouteChain(chainIndex + 1);
              return;
            }

            // Non-retriable error or exhausted: forward the error response
            if (!res.headersSent) {
              await streamResponse(response, res);
            }
            return;
          }

          // Success: stream response
          addLog('info', `Success ${routeName} HTTP ${response.status}`);
          await streamResponse(response, res);
        } catch (error) {
          clearTimeout(timer);

          // Stream stall: the upstream returned HTTP 200 but then stopped
          // sending data. Whether we can retry depends on whether any data
          // was already forwarded to OpenCode:
          //
          // - hasWritten=false: no data (and no headers) have been flushed
          //   to the client. We can safely retry or fallback — Express
          //   hasn't committed the response yet.
          //
          // - hasWritten=true: partial body was already sent to OpenCode.
          //   Headers are committed. We CANNOT retry — close the response
          //   and give up.
          if (error?.stalled) {
            if (!error.hasWritten && !res.headersSent) {
              addLog('warn', `Stream stall ${routeName} (hasWritten=false) — retrying`);
              if (attempt < maxRetries && !isClientAborted.value) {
                addLog('warn', `Retry [${attempt + 2}/${maxRetries + 1}] ${routeName} delay=${RETRY_DELAY_MS}ms`);
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
                await executeRequest(attempt + 1);
                return;
              }
              if (hasFallback && !isClientAborted.value) {
                addLog('warn', `Fallback from ${routeName} (stream stall, no data written)`);
                await tryRouteChain(chainIndex + 1);
                return;
              }
              // All retries exhausted — report error to OpenCode
              if (!res.headersSent) {
                res.status(502).json({ error: { message: `Upstream stream stalled after ${STALL_TIMEOUT_MS}ms` } });
              }
              return;
            }
            addLog('warn', `Stream stall ${routeName} (hasWritten=${error.hasWritten}) — connection closed, cannot retry`);
            return;
          }

          const isTimeout = error?.name === 'AbortError';
          addLog('error', `${isTimeout ? 'Timeout' : 'Network error'} ${routeName}: ${error?.message || error}`);

          if (attempt < maxRetries && !isClientAborted.value) {
            addLog('warn', `Retry [${attempt + 2}/${maxRetries + 1}] ${routeName} delay=${RETRY_DELAY_MS}ms`);
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            await executeRequest(attempt + 1);
            return;
          }

          if (hasFallback && !isClientAborted.value) {
            addLog('warn', `Fallback from ${routeName} (${isTimeout ? 'timeout' : 'error'})`);
            await tryRouteChain(chainIndex + 1);
            return;
          }

          if (!res.headersSent) {
            res.status(502).json({ error: { message: `Bad Gateway: ${error?.message || error}` } });
          }
        }
      };

      await executeRequest(0);
    };

    await tryRouteChain(0);
  };

  return {
    proxyChatCompletion,
    getConfig,
  };
}
