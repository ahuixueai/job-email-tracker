import { useEffect, useRef, useState } from "react";

/**
 * 登录页：邮箱收 6 位验证码登录；作者账号可以用密码登录（备用）。
 * 发码、密码登录之前都要过 Cloudflare Turnstile（防机器人，多数时候不用点）。
 */

interface TurnstileApi {
  render(el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("load failed"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** 人机验证的小框。每次 resetKey 变化就重新出一张票（票只能用一次）。 */
function Turnstile({ siteKey, resetKey, onToken }: { siteKey: string; resetKey: number; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let widget: string | null = null;
    let alive = true;
    onToken(null);
    loadTurnstile().then(
      () => {
        if (!alive || !box.current || !window.turnstile) return;
        widget = window.turnstile.render(box.current, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
      if (widget !== null) window.turnstile?.remove(widget);
    };
  }, [siteKey, resetKey, onToken]);
  return (
    <div className="mt-4">
      <div ref={box} data-turnstile />
      {failed ? <p className="mt-1 text-xs text-on-drop-soft">人机验证加载不出来，检查一下网络后刷新页面。</p> : null}
    </div>
  );
}

interface AuthConfig {
  turnstileSiteKey: string | null;
  passwordLogin: boolean;
  devMode: boolean;
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

const field = "mt-1 w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-ink outline-none focus:border-brand-line";
const primary =
  "mt-5 w-full rounded-lg bg-brand-soft px-3 py-2 text-sm font-semibold text-on-brand-soft hover:opacity-85 disabled:opacity-50";

export function Login({ onDone }: { onDone: () => void }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [mode, setMode] = useState<"code" | "password">("code");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  /** 冷却是按邮箱算的（服务端也是）：换了邮箱就不用等。 */
  const [cooldownEmail, setCooldownEmail] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/config")
      .then((res) => res.json() as Promise<AuthConfig>)
      .then(setConfig, () => setConfig({ turnstileSiteKey: null, passwordLogin: true, devMode: false }));
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const needsHuman = config?.turnstileSiteKey ? true : false;
  const humanReady = !needsHuman || token !== null;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const waiting = cooldown > 0 && cooldownEmail === email.trim().toLowerCase() ? cooldown : 0;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch {
      setError("连不上服务器，检查一下网络");
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      const r = await post("/api/auth/code", { email: email.trim(), turnstile: token });
      setResetKey((k) => k + 1); // 票用过了，换一张
      if (r.ok) {
        setStep("code");
        setCode("");
        setCooldown(60);
        setCooldownEmail(email.trim().toLowerCase());
        setDevCode(typeof r.data.devCode === "string" ? r.data.devCode : null);
      } else {
        if (typeof r.data.retryAfter === "number") {
          setCooldown(r.data.retryAfter);
          setCooldownEmail(email.trim().toLowerCase());
        }
        setError(typeof r.data.error === "string" ? r.data.error : `发送失败（${r.status}）`);
      }
    });

  const verify = () =>
    run(async () => {
      const r = await post("/api/auth/verify", { email: email.trim(), code });
      if (r.ok) onDone();
      else setError(typeof r.data.error === "string" ? r.data.error : `登录失败（${r.status}）`);
    });

  const passwordLogin = () =>
    run(async () => {
      const r = await post("/api/login", { password, turnstile: token });
      setResetKey((k) => k + 1);
      if (r.ok) onDone();
      else setError(typeof r.data.error === "string" ? r.data.error : `登录失败（${r.status}）`);
    });

  if (config === null) return <div className="flex min-h-full items-center justify-center px-4 py-16 text-sm text-ink-faint">载入中…</div>;

  const human = config.turnstileSiteKey ? <Turnstile siteKey={config.turnstileSiteKey} resetKey={resetKey} onToken={setToken} /> : null;
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (mode === "password") void passwordLogin();
          else if (step === "email") void sendCode();
          else void verify();
        }}
        className="w-full max-w-sm rounded-card border border-hairline bg-surface p-6 shadow-card"
        data-login={mode === "password" ? "password" : step}
      >
        <h1 className="text-lg font-semibold text-ink">求职看板</h1>

        {mode === "password" ? (
          <>
            <p className="mt-1 text-sm text-ink-soft">备用登录：输入你设置的看板密码。</p>
            <label className="mt-5 block text-sm text-ink-soft" htmlFor="password">
              密码
            </label>
            <input id="password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
            {human}
            <button type="submit" disabled={busy || password.length === 0 || !humanReady} className={primary}>
              {busy ? "登录中…" : "登录"}
            </button>
          </>
        ) : step === "email" ? (
          <>
            <p className="mt-1 text-sm text-ink-soft">输入邮箱，我们发一个 6 位验证码给你。</p>
            <label className="mt-5 block text-sm text-ink-soft" htmlFor="email">
              邮箱
            </label>
            <input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
            {human}
            <button type="submit" disabled={busy || !emailOk || !humanReady || waiting > 0} className={primary} data-action="send-code">
              {busy ? "发送中…" : waiting > 0 ? `${waiting} 秒后可再发` : "发送验证码"}
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-soft" data-code-sent>
              验证码已发到 <span className="text-ink">{email.trim()}</span>，10 分钟内有效。没收到就看看垃圾邮件。
            </p>
            {devCode ? (
              <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-xs text-ink" data-dev-code>
                本地开发模式，没有真的发信：验证码 <span className="font-mono font-semibold">{devCode}</span>
              </p>
            ) : null}
            <label className="mt-5 block text-sm text-ink-soft" htmlFor="code">
              验证码
            </label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className={`${field} font-mono text-lg tracking-[0.4em]`}
            />
            <button type="submit" disabled={busy || code.length !== 6} className={primary} data-action="verify-code">
              {busy ? "登录中…" : "登录"}
            </button>
            <div className="mt-3 flex items-center justify-between text-xs">
              <button type="button" onClick={() => { setStep("email"); setError(null); }} className="text-ink-soft hover:text-ink">
                换个邮箱
              </button>
              <button
                type="button"
                onClick={() => void sendCode()}
                disabled={busy || waiting > 0 || !humanReady}
                data-action="resend-code"
                className="text-on-brand-soft hover:underline disabled:text-ink-faint disabled:no-underline"
              >
                {waiting > 0 ? `${waiting} 秒后可重新发送` : "重新发送"}
              </button>
            </div>
            {human}
          </>
        )}

        {error ? (
          <p role="alert" className="mt-3 text-sm text-on-drop-soft">
            {error}
          </p>
        ) : null}

        {config.passwordLogin ? (
          <button
            type="button"
            onClick={() => {
              setMode(mode === "password" ? "code" : "password");
              setError(null);
            }}
            data-action="use-password"
            className="mt-5 block w-full text-center text-xs text-ink-faint hover:text-ink-soft"
          >
            {mode === "password" ? "用邮箱验证码登录" : "收不到验证码？用密码登录（备用）"}
          </button>
        ) : null}
      </form>
    </div>
  );
}
