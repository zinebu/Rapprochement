import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

type Props = {
  children: React.ReactNode;
};

export default function ProtectedRoute({ children }: Props) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      try {
        const res = await fetch("/auth/me", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        if (!mounted) return;

        if (!res.ok) {
          setAuthenticated(false);
          return;
        }

        const data = await res.json();
        setAuthenticated(data?.authenticated === true);
      } catch (error) {
        if (mounted) {
          setAuthenticated(false);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    checkAuth();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return <div className="p-6">Chargement...</div>;
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}