import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { BackendStatusBanner } from './components/BackendStatusBanner';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { HowItWorksPage } from './pages/HowItWorksPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { JobsPage } from './pages/JobsPage';
import { ResultsPage } from './pages/ResultsPage';
import { PrototypePage } from './pages/PrototypePage';
import { ExperimentsPage } from './pages/ExperimentsPage';
import { SystemDesignPage } from './pages/SystemDesignPage';
import { RoadmapPage } from './pages/RoadmapPage';
import { TeamPage } from './pages/TeamPage';
import { ResourcesPage } from './pages/ResourcesPage';
import { PresentationsPage } from './pages/PresentationsPage';
import { PlanningPresentationPage } from './pages/PlanningPresentationPage';
import { DashboardPage } from './pages/DashboardPage';
import { AdminPage } from './pages/AdminPage';
import { AccountPage } from './pages/AccountPage';

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <Router basename={import.meta.env.BASE_URL}>
        <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 bg-tech-grid relative">
          <div className="absolute inset-0 bg-radial-gradient pointer-events-none" />
          <Navbar />
          <BackendStatusBanner />
          <main className="flex-grow z-10">
            <Routes>
              {/* Primary CarbonRoute Navigation Routes */}
              <Route path="/" element={<HomePage />} />
              <Route path="/project" element={<ProjectPage />} />
              <Route path="/how-it-works" element={<HowItWorksPage />} />
              <Route path="/architecture" element={<ArchitecturePage />} />
              <Route path="/prototype" element={<PrototypePage />} />
              <Route path="/jobs" element={<JobsPage />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="/experiments" element={<ExperimentsPage />} />
              <Route path="/system-design" element={<SystemDesignPage />} />
              <Route path="/roadmap" element={<RoadmapPage />} />
              <Route path="/team" element={<TeamPage />} />
              <Route path="/resources" element={<ResourcesPage />} />

              {/* Presentation Archives */}
              <Route path="/presentations" element={<PresentationsPage />} />
              <Route path="/presentations/planning/v1" element={<PlanningPresentationPage />} />
              <Route path="/presentations/:slug/:versionTag" element={<PlanningPresentationPage />} />
              <Route path="/presentation/:versionTag" element={<PlanningPresentationPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />

              {/* Admin Routes */}
              <Route path="/account" element={<AccountPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/login" element={<AdminPage />} />
              <Route path="/admin/dashboard" element={<AdminPage />} />
              <Route path="/admin/upload" element={<AdminPage />} />
              <Route path="/admin/presentations" element={<AdminPage />} />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </Router>
    </AuthProvider>
  );
};

export default App;
