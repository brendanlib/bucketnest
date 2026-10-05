import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, setUnauthenticatedHandler } from './api/client';
import { keys, useMe } from './api/hooks';
import { HouseholdProvider } from './lib/household';
import { Layout } from './components/Layout';
import { Loading, ErrorState } from './components/States';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './features/auth';
import { AccountsPage } from './features/AccountsPage';
import { AccountDetailPage } from './features/AccountDetailPage';
import { TransactionsPage } from './features/TransactionsPage';
import { CategoriesPage } from './features/CategoriesPage';
import { SettingsPage } from './features/SettingsPage';
import { DashboardPage } from './features/DashboardPage';
import { BudgetPage } from './features/BudgetPage';
import { BillsPage } from './features/BillsPage';
import { RecurringPage } from './features/RecurringPage';
import { ImportPage } from './features/ImportPage';
import { RulesPage } from './features/RulesPage';
import { SinkingFundsPage } from './features/SinkingFundsPage';
import { FireExtinguisherPage } from './features/FireExtinguisherPage';
import { DebtsPage, DebtDetailPage } from './features/DebtsPage';

function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Loading />;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  }
  return (
    <HouseholdProvider me={me.data}>
      <Outlet />
    </HouseholdProvider>
  );
}

export function App() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      qc.removeQueries({ queryKey: keys.me });
      if (!['/login', '/register', '/forgot-password', '/reset-password'].includes(window.location.pathname)) navigate('/login');
    });
  }, [qc, navigate]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/budget" element={<BudgetPage />} />
          <Route path="/bills" element={<BillsPage />} />
          <Route path="/recurring" element={<RecurringPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/sinking-funds" element={<SinkingFundsPage />} />
          <Route path="/fire-extinguisher" element={<FireExtinguisherPage />} />
          <Route path="/debts" element={<DebtsPage />} />
          <Route path="/debts/:id" element={<DebtDetailPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/accounts/:id" element={<AccountDetailPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<div className="empty"><h3>Page not found</h3></div>} />
        </Route>
      </Route>
    </Routes>
  );
}
