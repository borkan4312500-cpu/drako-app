import { useState, useEffect } from "react";
import { useRouter } from "next/router";

export default function UsersPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedToken = localStorage.getItem("drako_token");
    if (!savedToken) {
      router.push("/admin");
      return;
    }
    setToken(savedToken);
    fetchUsers(savedToken);
  }, []);

  const fetchUsers = async (tok) => {
    try {
      const res = await fetch("http://localhost:4000/api/admin/stats", {
        headers: { Authorization: "Bearer " + tok },
      });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem("drako_token");
        router.push("/admin");
        return;
      }
      // للمثال سنحضر قائمة المستخدمين مباشرة (يمكن إضافة route خاص لاحقاً)
      const res2 = await fetch("http://localhost:4000/api/admin/restaurants", {
        headers: { Authorization: "Bearer " + tok },
      });
      // حالياً نعرض بيانات المطاعم والسائقين
      const drivers = await fetch("http://localhost:4000/api/admin/drivers", {
        headers: { Authorization: "Bearer " + tok },
      }).then(r => r.json());

      // دمج المستخدمين
      setUsers([
        { id: "1", name: "أدمن", phone: "01000000000", role: "ADMIN", isActive: true },
        ...drivers.map(d => ({ ...d, role: "DRIVER" })),
      ]);
    } catch (err) {
      setError("فشل الاتصال");
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>👥 إدارة المستخدمين</h1>
      <table>
        <thead>
          <tr>
            <th>الاسم</th><th>الهاتف</th><th>الدور</th><th>الحالة</th><th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.phone}</td>
              <td>{u.role}</td>
              <td>{u.isActive ? "نشط" : "موقوف"}</td>
              <td>
                <button>تفعيل/إيقاف</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <style jsx>{` 
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #eee; padding: 12px; text-align: right; }
        th { background: #FF6B00; color: white; }
      `}</style>
    </div>
  );
}
