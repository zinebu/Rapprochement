import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { APP_TITLE, APP_LOGO_PATH, APP_LOGIN_BG_PATH } from "@/config/app-config";

const LOGIN_TIMEOUT_MS = 12000;

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);

    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Connexion échouée");
        setLoading(false);
        return;
      }

      const meRes = await fetch("/auth/me", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      const meData = await meRes.json().catch(() => null);
      if (!meRes.ok || meData?.authenticated !== true) {
        setError("Session non établie. Réessayez.");
        setLoading(false);
        return;
      }

      navigate("/");
    } catch (err) {
      setError(err instanceof DOMException && err.name === "AbortError" ? "Connexion trop longue. Réessayez." : "Erreur réseau");
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  return (
    <div
      className="relative isolate flex min-h-screen items-center justify-center px-4 py-6"
      style={{
        backgroundImage: `linear-gradient(to bottom, rgba(15, 23, 42, 0.45), rgba(15, 23, 42, 0.55)), url(${APP_LOGIN_BG_PATH})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white/95 p-6 shadow-xl ring-1 ring-black/5 backdrop-blur-sm sm:p-7">
        <div className="mb-5 flex w-full flex-col items-center px-1 pt-2 pb-1 text-center">
          <img
            src={APP_LOGO_PATH}
            alt={`${APP_TITLE} — logo`}
            width={208}
            height={208}
            className="mb-0 block h-44 w-44 object-contain object-top sm:h-52 sm:w-52"
          />
          <p className="-mt-7 text-2xl font-bold leading-none tracking-tight text-slate-900 sm:-mt-9 sm:text-3xl">
            {APP_TITLE}
          </p>
        </div>

        <h1 className="sr-only">Connexion — {APP_TITLE}</h1>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-slate-700">Email</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none ring-offset-2 focus:ring-2 focus:ring-slate-900/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-700">Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none ring-offset-2 focus:ring-2 focus:ring-slate-900/20"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-slate-900 py-2.5 font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}
