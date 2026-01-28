import { Navigate, Route, Routes } from "react-router-dom";
import OnboardingPage from "./pages/Onboarding";
import CanvasPage from "./pages/Canvas";
import ExportPage from "./pages/Export";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<OnboardingPage />} />
      <Route path="/canvas" element={<CanvasPage />} />
      <Route path="/export" element={<ExportPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
