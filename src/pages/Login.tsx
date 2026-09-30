import { useRef, useState, type FormEvent } from "react";
import { AppMark, Spinner } from "../components/Icon";
import { api } from "../lib/api";

export function Login({ configured, onSignedIn }: { configured: boolean; onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.login(password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in.");
      setPassword("");
      inputRef.current?.focus();
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="login">
      <div className="login-inner">
        <AppMark className="login-mark" />
        <h1 className="title-1">Sietch</h1>
        <p className="muted">
          {configured ? "Enter your password to continue." : "Sign-in isn't set up yet. Set the APP_PASSWORD and SESSION_SECRET secrets, then reload."}
        </p>
        {configured && (
          <form onSubmit={(e) => void submit(e)}>
            <label className="sr-only" htmlFor="password">
              Password
            </label>
            <input
              ref={inputRef}
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "login-error" : undefined}
            />
            {error && (
              <p id="login-error" className="inline-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!password || pending}>
              {pending ? <Spinner label="Signing in" /> : "Sign In"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
