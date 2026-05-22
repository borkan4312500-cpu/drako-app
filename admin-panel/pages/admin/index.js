import { useState, useEffect } from "react";
import { useRouter } from "next/router";

export default function AdminDashboard() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedToken = localStorage.getItem("drako_token");
    if (savedToken) {
      setToken(savedToken);
      checkAuth(savedToken);
    }
  }, []);

  const checkAuth = async (tok) => {
    try {
      const res = await fetch("http://localhost:4000/api/admin/stats", {
        headers: { Authorization: "Bearer " + tok },
      });
      const data = await res.json();
      if (data.error) {
        localStorage.removeItem("drako_token");
        setAuthenticated(false);
      } else {
        setAuthenticated(true);
        setStats(data);
      }
    } catch {
      setError("فشل الاتصال");
    }
  };

  const handleLogin = async () => {
    if (!token) return;
    localStorage.setItem("drako_token", token);
    checkAuth(token);
  };

  const logout = () => {
    localStorage.removeItem("drako_token");
    setAuthenticated(false);
    setToken("");
    setStats(null);
  };

  if (!authenticated) {
    return (
      <div className="login">
        <h2>🔐 دخول لوحة Drako</h2>
        <input type="text" placeholder="أدخل التوكن" value={token} onChange={(e) => setToken(e.target.value)} />
        <button onClick={handleLogin}>دخول</button>
        {error && <p className="error">{error}</p>}
        <style jsx>{`
          .login { max-width: 400px; margin: 100px auto; background: white; padding: 30px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
          h2 { color: #FF6B00; }
          input { width: 100%; padding: 12px; border: 1px solid #e5e7eb; border-radius: 12px; margin: 10px 0; font-size: 16px; }
          button { background: #FF6B00; color: white; border: none; padding: 12px 20px; border-radius: 12px; cursor: pointer; width: 100%; font-size: 16px; }
          .error { color: red; margin-top: 10px; }
        `}</style>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <h2>Drako</h2>
        <a className="active" onClick={() => router.push("/admin")}>🏠 الرئيسية</a>
        <a onClick={() => router.push("/admin/users")}>👥 المستخدمين</a>
        <a onClick={() => router.push("/admin/restaurants")}>🍽️ المطاعم</a>
        <a onClick={() => router.push("/admin/drivers")}>🛵 الطيارين</a>
      </aside>
      <main className="main">
        <header className="header">
          <h1>لوحة تحكم الأدمن</h1>
          <button onClick={logout} className="logout">تسجيل خروج</button>
        </header>
        <div className="cards">
          <div className="card"><h3>عدد المستخدمين</h3><strong>{stats?.users || 0}</strong></div>
          <div className="card"><h3>المطاعم</h3><strong>{stats?.restaurants || 0}</strong></div>
          <div className="card"><h3>السائقين</h3><strong>{stats?.drivers || 0}</strong></div>
          <div className="card"><h3>الطلبات</h3><strong>{stats?.orders || 0}</strong></div>
        </div>
      </main>
      <style jsx>{`
        .dashboard { display: flex; min-height: 100vh; }
        .sidebar { width: 240px; background: #fff; border-left: 1px solid #eee; padding: 20px; }
        .sidebar h2 { color: #FF6B00; margin-bottom: 30px; }
        .sidebar a { display: flex; gap: 10px; padding: 12px; border-radius: 12px; color: #4b5563; margin-bottom: 8px; cursor: pointer; }
        .sidebar a.active, .sidebar a:hover { background: #FF6B00; color: white; }
        .main { flex: 1; padding: 30px; background: #f9fafb; }
        .header { display: flex; justify-content: space-between; align-items: center; background: white; padding: 20px; border-radius: 16px; margin-bottom: 20px; }
        .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; }
        .card { background: white; padding: 20px; border-radius: 16px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); }
        .card h3 { color: #6b7280; font-size: 14px; }
        .card strong { font-size: 28px; color: #FF6B00; }
        .logout { background: #eee; color: #111; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
      `}</style>
    </div>
  );
}
