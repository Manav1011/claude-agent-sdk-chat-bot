import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "./AuthContext";
import { Spinner } from "../components/Spinner";

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading session">
        <Spinner className="size-8 text-brand-600" />
      </div>
    );
  }
  if (status === "unauthenticated") {
    return <Navigate to="/auth/signin" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
