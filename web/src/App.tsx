import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { RoleProvider } from './context/RoleContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import WorkerRecord from './pages/WorkerRecord';
import Pathway from './pages/Pathway';
import Consents from './pages/Consents';
import EmployerReadiness from './pages/EmployerReadiness';
import Opportunities from './pages/Opportunities';
import Governance from './pages/Governance';
import Aggregates from './pages/Aggregates';
import AuditLog from './pages/AuditLog';
import KnowledgeBase from './pages/KnowledgeBase';
import Agreements from './pages/Agreements';

export default function App() {
  return (
    <AuthProvider>
      <RoleProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
          <Route
            path="/record"
            element={
              <ProtectedRoute roles={['worker', 'navigator', 'supervisor']}>
                <WorkerRecord />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pathway"
            element={
              <ProtectedRoute roles={['worker', 'navigator']}>
                <Pathway />
              </ProtectedRoute>
            }
          />
          <Route
            path="/consents"
            element={
              <ProtectedRoute roles={['worker']}>
                <Consents />
              </ProtectedRoute>
            }
          />
          <Route
            path="/readiness"
            element={
              <ProtectedRoute roles={['employer', 'hubAdmin']}>
                <EmployerReadiness />
              </ProtectedRoute>
            }
          />
          <Route
            path="/opportunities"
            element={
              <ProtectedRoute>
                <Opportunities />
              </ProtectedRoute>
            }
          />
          <Route
            path="/governance"
            element={
              <ProtectedRoute>
                <Governance />
              </ProtectedRoute>
            }
          />
          <Route
            path="/aggregates"
            element={
              <ProtectedRoute roles={['backboneAnalyst', 'governance']}>
                <Aggregates />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit"
            element={
              <ProtectedRoute>
                <AuditLog />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agreements"
            element={
              <ProtectedRoute>
                <Agreements />
              </ProtectedRoute>
            }
          />
          <Route
            path="/knowledge"
            element={
              <ProtectedRoute>
                <KnowledgeBase />
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
      </RoleProvider>
    </AuthProvider>
  );
}
