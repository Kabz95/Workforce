import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import WorkerRecord from './pages/WorkerRecord';
import Pathway from './pages/Pathway';
import Consents from './pages/Consents';
import EmployerReadiness from './pages/EmployerReadiness';
import Handoffs from './pages/Handoffs';
import Opportunities from './pages/Opportunities';
import Governance from './pages/Governance';
import Aggregates from './pages/Aggregates';
import AuditLog from './pages/AuditLog';
import MyGrants from './pages/MyGrants';

export default function App() {
  return (
    <AuthProvider>
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
            path="/handoffs"
            element={
              <ProtectedRoute roles={['worker', 'navigator', 'hubCoordinator', 'supervisor', 'mentor']}>
                <Handoffs />
              </ProtectedRoute>
            }
          />
          <Route
            path="/readiness"
            element={
              <ProtectedRoute roles={['employer', 'hubCoordinator']}>
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
              <ProtectedRoute roles={['analyst', 'steeringCircle', 'council']}>
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
            path="/grants"
            element={
              <ProtectedRoute>
                <MyGrants />
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
