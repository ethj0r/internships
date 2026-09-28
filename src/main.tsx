import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { Loading } from "./components/common";
import { ToastProvider } from "./components/Toast";
import { api } from "./lib/api";
import { invalidate } from "./lib/hooks";
import { Activity } from "./pages/Activity";
import { ApplyKitPage } from "./pages/ApplyKit";
import { Discover } from "./pages/Discover";
import { DocumentReview } from "./pages/DocumentReview";
import { Documents } from "./pages/Documents";
import { JobPage } from "./pages/JobPage";
import { KnowledgePage } from "./pages/Knowledge";
import { Login } from "./pages/Login";
import { NotFound } from "./pages/NotFound";
import { Pipeline } from "./pages/Pipeline";
import { PrintDocument } from "./pages/PrintDocument";
import { ProfilePage } from "./pages/Profile";
import { Sources } from "./pages/Sources";
import "./styles/tokens.css";
import "./styles/app.css";

function App() {
  const [session, setSession] = useState<"loading" | "signed-in" | "signed-out">("loading");
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    api
      .session()
      .then((s) => {
        setConfigured(s.configured);
        setSession(s.authenticated ? "signed-in" : "signed-out");
      })
      .catch(() => setSession("signed-out"));
    const onAuthRequired = () => setSession("signed-out");
    window.addEventListener("auth:required", onAuthRequired);
    return () => window.removeEventListener("auth:required", onAuthRequired);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    invalidate("");
    setSession("signed-out");
  }, []);

  if (session === "loading") {
    return (
      <div style={{ height: "100dvh", display: "flex" }}>
        <Loading />
      </div>
    );
  }
  if (session === "signed-out") return <Login configured={configured} onSignedIn={() => setSession("signed-in")} />;

  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/print/:docId" element={<PrintDocument />} />
          <Route element={<AppShell onSignOut={signOut} />}>
            <Route index element={<Navigate to="/discover" replace />} />
            <Route path="discover" element={<Discover />} />
            <Route path="discover/:jobId" element={<Discover />} />
            <Route path="jobs/:jobId" element={<JobPage />} />
            <Route path="pipeline" element={<Pipeline />} />
            <Route path="applications/:appId/apply" element={<ApplyKitPage />} />
            <Route path="documents" element={<Documents />} />
            <Route path="documents/:docId" element={<DocumentReview />} />
            <Route path="knowledge" element={<KnowledgePage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="sources" element={<Sources />} />
            <Route path="activity" element={<Activity />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
