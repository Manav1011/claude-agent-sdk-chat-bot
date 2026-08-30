import { Wallet } from "lucide-react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext";
import { SignUpForm } from "../../components/forms/SignUpForm";

export default function SignUp() {
  const { status } = useAuth();
  const navigate = useNavigate();

  if (status === "authenticated") return <Navigate to="/" replace />;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Wallet className="size-7" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold">Create your account</h1>
          <p className="text-sm text-slate-500">Track income, expenses and budgets in one place.</p>
        </div>
        <SignUpForm onAuthenticated={() => navigate("/", { replace: true })} />
        <p className="mt-6 text-center text-sm text-slate-500">
          Already registered?{" "}
          <Link to="/auth/signin" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
