import {
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Tag,
  Wallet,
  BarChart3,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/transactions", label: "Transactions", icon: ReceiptText },
  { to: "/budgets", label: "Budgets", icon: Wallet },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/categories", label: "Categories", icon: Tag },
];

function BrandMark() {
  return (
    <span className="flex items-center gap-2 font-bold text-brand-700">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">
        <Wallet className="size-5" aria-hidden="true" />
      </span>
      Ledgerly
    </span>
  );
}

export function Layout() {
  const { user, logout } = useAuth();

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only rounded-md bg-brand-600 px-3 py-2 text-white focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-70"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-slate-200 bg-white px-3 py-5 lg:flex">
        <div className="px-3">
          <BrandMark />
        </div>
        <nav aria-label="Main navigation" className="mt-8 flex flex-1 flex-col gap-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end className={navClass}>
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 pt-3">
          <p className="truncate px-3 text-xs text-slate-500" title={user?.email}>
            {user?.email}
          </p>
          <button
            onClick={logout}
            className="mt-1 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top header */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <BrandMark />
        <button
          onClick={logout}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </button>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-4 py-6 pb-24 sm:px-6 lg:ml-60 lg:px-8 lg:py-8">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white lg:hidden"
      >
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                isActive ? "text-brand-600" : "text-slate-500"
              }`
            }
          >
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
