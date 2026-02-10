import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { loadWorkspaceRoute } from "./pages/workspaceRouteLoader";

const OnboardingPage = lazy(() => import("./pages/Onboarding"));
const DualPaneWorkspace = lazy(() => loadWorkspaceRoute());
const ExportPage = lazy(() => import("./pages/Export"));
const AnalyticsPage = lazy(() => import("./pages/Analytics"));

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)]">
      <div className="rounded-xl border border-subtle bg-white/80 px-4 py-3 text-[13px] text-secondary shadow-soft">
        页面加载中...
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<OnboardingPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/canvas" element={<DualPaneWorkspace />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
