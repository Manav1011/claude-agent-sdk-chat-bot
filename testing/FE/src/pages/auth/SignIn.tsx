import { Wallet } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext";
import { SignInForm } from "../../components/forms/SignInForm";

export default function SignIn() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (status === "authenticated") return <Navigate to="/" replace />;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Wallet className="size-7" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold">Ledgerly</h1>
          <p className="text-sm text-slate-500">Sign in to your personal finance dashboard.</p>
        </div>
        <SignInForm onAuthenticated={() => navigate(from, { replace: true })} />
        <p className="mt-6 text-center text-sm text-slate-500">
          No account?{" "}
          <Link to="/auth/signup" className="font-medium text-brand-600 hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
