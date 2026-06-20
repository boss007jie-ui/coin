const { execFile } = require("child_process");

function resolveProxyUrl(url, env = process.env) {
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.toLowerCase();
  const noProxy = String(env.NO_PROXY || env.no_proxy || "");

  if (matchesNoProxy(hostname, noProxy)) {
    return null;
  }

  if (parsedUrl.protocol === "https:") {
    return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy || null;
  }

  return env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy || null;
}

function matchesNoProxy(hostname, noProxy) {
  const rules = String(noProxy || "")
    .split(",")
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);

  return rules.some((rule) => {
    if (rule === "*") return true;
    if (rule.startsWith(".")) {
      const suffix = rule.slice(1);
      return hostname === suffix || hostname.endsWith(rule);
    }
    return hostname === rule || hostname.endsWith(`.${rule}`);
  });
}

function fetchTextViaCurlProxy(url, timeoutMs, headers = {}, proxyUrl, execFileImpl = execFile) {
  return new Promise((resolve, reject) => {
    const timeoutSec = Math.max(10, Math.ceil(timeoutMs / 1000));
    const args = [
      "-sSL",
      "--max-time",
      String(timeoutSec),
      "--connect-timeout",
      String(Math.min(10, timeoutSec)),
      "--proxy",
      proxyUrl
    ];

    for (const [name, value] of Object.entries(headers || {})) {
      args.push("-H", `${name}: ${value}`);
    }

    args.push(url);

    execFileImpl(
      "curl",
      args,
      { timeout: timeoutMs, maxBuffer: 30 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || "").trim() || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

module.exports = {
  fetchTextViaCurlProxy,
  resolveProxyUrl
};
