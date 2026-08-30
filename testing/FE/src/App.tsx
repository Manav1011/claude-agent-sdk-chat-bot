import { Link, Navigate, Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "./auth/ProtectedRoute";
import { Layout } from "./components/Layout";
import { Button } from "./components/Button";
import Budgets from "./pages/Budgets";
import Categories from "./pages/Categories";
import Dashboard from "./pages/Dashboard";
import Analytics from "./pages/Analytics";
import SignIn from "./pages/auth/SignIn";
import SignUp from "./pages/auth/SignUp";
import Transactions from "./pages/Transactions";

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="text-5xl font-bold text-slate-300">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/">
        <Button>Back to dashboard</Button>
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
        <Route path="/auth/signin" element={<SignIn />} />
        <Route path="/auth/signup" element={<SignUp />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/budgets" element={<Budgets />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/analytics" element={<Analytics />} />
          </Route>
        </Route>
        <Route path="/404" element={<NotFound />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
