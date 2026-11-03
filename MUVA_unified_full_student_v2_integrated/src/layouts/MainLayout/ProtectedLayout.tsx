import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuthStore } from '../../stores/authStore';

export function ProtectedLayout() {
  const signedIn = useAuthStore((state) => state.signedIn);
  const checkingSession = useAuthStore((state) => state.checkingSession);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  useEffect(() => { void restoreSession(); }, [restoreSession]);
  const location = useLocation();

  if (checkingSession) return <div role="status">正在验证登录状态…</div>;

  if (!signedIn) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
